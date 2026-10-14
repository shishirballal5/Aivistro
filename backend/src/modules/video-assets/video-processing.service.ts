import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { encryptString } from '../../common/crypto/crypto.util';
import { KeyService } from '../../common/crypto/key.service';
import { mediaConfig } from '../../config/media.config';
import { Episode, VideoAsset, VideoStatus, VideoVariant } from '../../database/entities/index';
import { StorageService } from '../storage/storage.service';
import { checkMediaPlaylist, chooseLadder, isAllowedContainer, parseProbe, run, thumbnailArgs, transcodeArgs } from '../../util/thirdparty/ffmpeg/ffmpeg.util';

/** A problem with the VIDEO itself: retrying cannot help, so the job fails immediately and permanently. */
export class PermanentVideoError extends UnrecoverableError {}

/**
 * Turns an uploaded original into protected HLS:
 *   download -> validate (container, streams, duration) -> encrypt+segment each rendition -> thumbnail
 *   -> verify the output (playlists complete, segments exist, key really decrypts) -> upload -> switch the episode over atomically.
 * The previous rendition keeps serving until the new one is fully verified and uploaded.
 */
@Injectable()
export class VideoProcessingService {
  private readonly log = new Logger(VideoProcessingService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(VideoAsset) private readonly assets: Repository<VideoAsset>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    private readonly storage: StorageService,
    private readonly keys: KeyService,
    @Inject(mediaConfig.KEY) private readonly cfg: ConfigType<typeof mediaConfig>,
  ) {}

  async process(assetId: string): Promise<{ variants: number; durationSeconds: number }> {
    const asset = await this.assets.findOne({ where: { id: assetId } });
    if (!asset) throw new PermanentVideoError(`Asset ${assetId} no longer exists`);
    if (asset.status !== VideoStatus.Uploaded && asset.status !== VideoStatus.Processing) throw new PermanentVideoError(`Asset is ${asset.status}; nothing to process`);
    await this.assets.update(asset.id, { status: VideoStatus.Processing, processingStartedAt: new Date(), processingAttempts: () => 'processing_attempts + 1' } as never);

    const work = await mkdtemp(join(tmpdir(), `aivistro-video-${asset.id}-`));
    try {
      return await this.run(asset, work);
    } finally {
      await rm(work, { recursive: true, force: true }); // never leave originals or keys on the worker's disk
    }
  }

  private async run(asset: VideoAsset, work: string) {
    const ext = asset.sourceKey.split('.').pop();
    const input = join(work, `source.${ext}`);
    await this.storage.downloadTo(asset.sourceKey, input);
    const size = (await stat(input)).size;
    if (String(size) !== asset.declaredSizeBytes) throw new PermanentVideoError('The stored file does not match the declared size');

    // 1. validate what the file REALLY is (the extension and Content-Type were only claims)
    const probeOut = await run(this.cfg.ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', input], { timeoutMs: 60_000 }).catch((err: Error) => {
      // ffprobe not being installed (or timing out) is OUR problem and worth retrying. ffprobe rejecting the file means the file is not media.
      if (/FFMPEG_NOT_FOUND|timed out/.test(err.message)) throw err;
      throw new PermanentVideoError('The file could not be read as a video. Upload a valid MP4, MOV, MKV or WebM file.');
    });
    const probe = parseProbe(JSON.parse(probeOut.stdout));
    if ('error' in probe) throw new PermanentVideoError(probe.error);
    if (!isAllowedContainer(probe.formatName)) throw new PermanentVideoError(`Unsupported container "${probe.formatName.slice(0, 40)}". Upload an MP4, MOV, MKV or WebM video.`);
    if (probe.durationSeconds > this.cfg.maxVideoSeconds) throw new PermanentVideoError(`The video is ${Math.round(probe.durationSeconds)}s long; the limit is ${this.cfg.maxVideoSeconds}s`);
    const checksum = await sha256File(input);

    // 2. one AES-128 key per asset; segments are useless without it, and the key is only served through an authorised session
    const key = randomBytes(16);
    await writeFile(join(work, 'enc.key'), key);
    await writeFile(join(work, 'key.info'), `../enc.key\n${join(work, 'enc.key')}\n`);

    const ladder = chooseLadder(probe.width, probe.height);
    const budget = Math.min(30 * 60_000, Math.max(120_000, probe.durationSeconds * 10_000));
    const variants: VideoVariant[] = [];
    for (const r of ladder) {
      const outDir = join(work, 'out', r.name);
      await mkdir(outDir, { recursive: true });
      await run(this.cfg.ffmpegPath, transcodeArgs({ input, outDir, rendition: r, fps: probe.fps, hasAudio: probe.hasAudio, keyInfoFile: join(work, 'key.info') }), { timeoutMs: budget });
      await this.verifyRendition(outDir, key);
      variants.push({ name: r.name, width: r.width, height: r.height, bandwidth: (r.maxrateKbps + (probe.hasAudio ? r.audioKbps : 0)) * 1000 });
    }
    const thumb = join(work, 'thumb.jpg');
    await run(this.cfg.ffmpegPath, thumbnailArgs(input, thumb, Math.min(1.5, probe.durationSeconds * 0.1)), { timeoutMs: 60_000 });

    // 3. upload everything under a NEW generation prefix; the old one keeps serving until the switch below
    const generation = asset.generation + 1;
    const prefix = `private/hls/${asset.id}/g${generation}/`;
    await this.uploadTree(join(work, 'out'), prefix);
    const thumbKey = `images/thumbs/ep-${asset.episodeId}-${asset.id}.jpg`;
    await this.storage.uploadFile(thumbKey, thumb, 'image/jpeg');

    // 4. atomic switch: asset READY + episode points at it + episode duration comes from the REAL media, never from a client
    const previousPrefix = asset.hlsPrefix;
    await this.ds.transaction(async (em) => {
      await em.getRepository(VideoAsset).update(asset.id, { status: VideoStatus.Ready, hlsPrefix: prefix, variants, durationSeconds: Math.round(probe.durationSeconds), width: probe.width, height: probe.height, sizeBytes: String(size), checksumSha256: checksum, thumbnailKey: thumbKey, encryptionKeyEnc: encryptString(this.keys.mediaEncryption, key), generation, failureReason: null, processedAt: new Date() });
      const ep = await em.getRepository(Episode).findOneOrFail({ where: { id: asset.episodeId }, lock: { mode: 'pessimistic_write' } });
      await em.getRepository(Episode).update(ep.id, { currentAssetId: asset.id, durationSeconds: Math.round(probe.durationSeconds), ...(ep.thumbnailKey ? {} : { thumbnailKey: thumbKey }) });
    });
    if (previousPrefix) await this.storage.deletePrefix(previousPrefix).catch((err) => this.log.warn({ err, previousPrefix }, 'Could not delete the previous rendition'));
    this.log.log(`Asset ${asset.id} ready: ${variants.map((v) => v.name).join(', ')} (${Math.round(probe.durationSeconds)}s)`);
    return { variants: variants.length, durationSeconds: Math.round(probe.durationSeconds) };
  }

  /** The output is only accepted if it is complete, encrypted, every segment exists, and the key genuinely decrypts the first one. */
  private async verifyRendition(dir: string, key: Buffer): Promise<void> {
    const check = checkMediaPlaylist(await readFile(join(dir, 'index.m3u8'), 'utf8'));
    if (!check.ok) throw new Error(`Rendition output invalid: ${check.problems.join('; ')}`);
    const files = new Set(await readdir(dir));
    for (const s of check.segments) {
      if (!files.has(s) || (await stat(join(dir, s))).size === 0) throw new Error(`Rendition output invalid: segment ${s} is missing or empty`);
    }
    const first = await readFile(join(dir, check.segments[0]));
    if (first.length < 752) return; // tiny final segment; the structural checks above already passed
    const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16)); // first segment: IV = media sequence 0
    d.setAutoPadding(false);
    const plain = Buffer.concat([d.update(first.subarray(0, 752)), d.final()]);
    if (![0, 188, 376, 564].every((o) => plain[o] === 0x47)) throw new Error('Rendition output invalid: the encryption key does not decrypt the segments');
  }

  private async uploadTree(root: string, prefix: string): Promise<void> {
    const jobs: { key: string; file: string; type: string }[] = [];
    for (const variant of await readdir(root)) for (const f of await readdir(join(root, variant))) {
      jobs.push({ key: `${prefix}${variant}/${f}`, file: join(root, variant, f), type: f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' });
    }
    for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => this.storage.uploadFile(j.key, j.file, j.type)));
  }

  /**
   * Called when a job has finished failing. A permanent problem (or exhausted retries) marks the asset FAILED with a readable
   * reason. If this was a REprocess of a working asset, the previous rendition is still intact, so it goes back to READY.
   */
  async markFailed(assetId: string, reason: string): Promise<void> {
    const a = await this.assets.findOne({ where: { id: assetId } });
    if (!a) return;
    const hadWorking = !!a.hlsPrefix && !!a.variants?.length && !!a.encryptionKeyEnc;
    await this.assets.update(a.id, { status: hadWorking ? VideoStatus.Ready : VideoStatus.Failed, failureReason: reason.slice(0, 500) });
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => { const h = createHash('sha256'); createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
}
