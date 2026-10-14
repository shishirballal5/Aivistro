import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, LessThan, Repository } from 'typeorm';
import { randomToken } from '../../common/crypto/crypto.util';
import { badRequest, conflict, DomainException } from '../../common/errors';
import { mediaConfig } from '../../config/media.config';
import { Episode, VideoAsset, VideoStatus, VideoSubtitle } from '../../database/entities/index';
import { QUEUES, VIDEO_JOBS, VideoProcessPayload } from '../queues/queue.constants';
import { StorageService } from '../storage/storage.service';
import { RequestUploadDto, SubtitleDto } from './video-assets.dto';

const UPLOAD_URL_TTL_SECONDS = 900;
const MAX_PENDING_UPLOADS_PER_EPISODE = 5;
const EXT_OF: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/webm': 'webm' };

export const assetView = (a: VideoAsset) => ({
  id: a.id, episodeId: a.episodeId, status: a.status, filename: a.sourceFilename, contentType: a.contentType, sizeBytes: a.sizeBytes ? Number(a.sizeBytes) : null,
  durationSeconds: a.durationSeconds, width: a.width, height: a.height, variants: (a.variants ?? []).map((v) => ({ name: v.name, width: v.width, height: v.height, bandwidth: v.bandwidth })),
  failureReason: a.failureReason, processingAttempts: a.processingAttempts, processedAt: a.processedAt, createdAt: a.createdAt,
});

@Injectable()
export class VideoAssetsService {
  private readonly log = new Logger(VideoAssetsService.name);
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(VideoAsset) private readonly assets: Repository<VideoAsset>,
    @InjectRepository(VideoSubtitle) private readonly subtitles: Repository<VideoSubtitle>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    @InjectQueue(QUEUES.VideoProcessing) private readonly queue: Queue<VideoProcessPayload>,
    private readonly storage: StorageService,
    @Inject(mediaConfig.KEY) private readonly cfg: ConfigType<typeof mediaConfig>,
  ) {}

  /** Step 1: reserve an asset and hand the uploader a short-lived, single-object, write-only URL. The server picks the key. */
  async requestUpload(adminId: string, episodeId: string, dto: RequestUploadDto) {
    if (!(await this.episodes.exists({ where: { id: episodeId } }))) throw new NotFoundException();
    if (dto.sizeBytes > this.cfg.maxUploadBytes) throw badRequest('FILE_TOO_LARGE', `Videos can be at most ${this.cfg.maxUploadBytes} bytes`);
    const pending = await this.assets.count({ where: { episodeId, status: VideoStatus.Uploading } });
    if (pending >= MAX_PENDING_UPLOADS_PER_EPISODE) throw new DomainException(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_PENDING_UPLOADS', 'Finish or wait for the pending uploads of this episode first');

    const asset = await this.assets.save({ episodeId, status: VideoStatus.Uploading, sourceKey: 'pending', sourceFilename: dto.filename.slice(0, 255), contentType: dto.contentType, declaredSizeBytes: String(dto.sizeBytes), sizeBytes: null, checksumSha256: null, hlsPrefix: null, variants: null, durationSeconds: null, width: null, height: null, thumbnailKey: null, encryptionKeyEnc: null, processingAttempts: 0, generation: 0, failureReason: null, processingStartedAt: null, processedAt: null, createdByAdminId: adminId });
    const sourceKey = `private/source/${episodeId}/${asset.id}-${randomToken(12)}.${EXT_OF[dto.contentType]}`; // unguessable and never returned to viewers
    await this.assets.update(asset.id, { sourceKey });
    const upload = await this.storage.createUploadAuthorization(sourceKey, dto.contentType, dto.sizeBytes, UPLOAD_URL_TTL_SECONDS);
    return { assetId: asset.id, upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt }, maxBytes: this.cfg.maxUploadBytes };
  }

  /** Step 2: the uploader says "done". We do not believe it: we look at what actually arrived in storage. */
  async complete(assetId: string) {
    const asset = await this.requireAsset(assetId);
    if (asset.status !== VideoStatus.Uploading) throw conflict('INVALID_STATE', `This upload is already ${asset.status}`);
    const stat = await this.storage.stat(asset.sourceKey);
    if (!stat) throw conflict('UPLOAD_NOT_FOUND', 'No file has been uploaded yet');
    if (stat.size > this.cfg.maxUploadBytes || String(stat.size) !== asset.declaredSizeBytes) {
      await this.storage.delete(asset.sourceKey);
      await this.assets.update(asset.id, { status: VideoStatus.Failed, failureReason: `The uploaded file size (${stat.size}) does not match the declared size (${asset.declaredSizeBytes}) or the limit` });
      throw badRequest('UPLOAD_SIZE_MISMATCH', 'The uploaded file does not match what was declared. Start a new upload.');
    }
    await this.assets.update(asset.id, { status: VideoStatus.Uploaded, sizeBytes: String(stat.size) });
    await this.enqueue(asset.id, asset.generation + 1);
    return assetView(await this.assets.findOneByOrFail({ id: asset.id }));
  }

  /** Re-run processing (e.g. after a pipeline change). The current rendition is marked PROCESSING, so playback pauses with VIDEO_PROCESSING. */
  async reprocess(assetId: string) {
    const asset = await this.requireAsset(assetId);
    if (asset.status !== VideoStatus.Ready && asset.status !== VideoStatus.Failed) throw conflict('INVALID_STATE', `Cannot reprocess an asset that is ${asset.status}`);
    if (!(await this.storage.stat(asset.sourceKey))) throw conflict('SOURCE_MISSING', 'The original file is no longer in storage');
    await this.assets.update(asset.id, { status: VideoStatus.Processing, failureReason: null });
    await this.enqueue(asset.id, asset.generation + 1);
    return assetView(await this.assets.findOneByOrFail({ id: asset.id }));
  }

  /** No fixed job id: double-enqueueing is already prevented by the status checks above (UPLOADING->UPLOADED, READY/FAILED->PROCESSING). */
  private enqueue(assetId: string, _generation: number) {
    return this.queue.add(VIDEO_JOBS.Process, { assetId }, { attempts: 3, backoff: { type: 'exponential', delay: this.cfg.videoRetryDelayMs }, removeOnComplete: { age: 86_400 }, removeOnFail: { age: 7 * 86_400 } });
  }

  async list(episodeId: string) {
    if (!(await this.episodes.exists({ where: { id: episodeId } }))) throw new NotFoundException();
    const ep = await this.episodes.findOneByOrFail({ id: episodeId });
    return (await this.assets.find({ where: { episodeId }, order: { id: 'DESC' }, take: 50 })).map((a) => ({ ...assetView(a), current: a.id === ep.currentAssetId }));
  }
  async get(assetId: string) {
    const a = await this.requireAsset(assetId);
    const subs = await this.subtitles.find({ where: { assetId } });
    return { ...assetView(a), subtitles: subs.map((s) => ({ language: s.language, label: s.label })) };
  }

  // ── subtitles ──
  async addSubtitle(assetId: string, dto: SubtitleDto) {
    await this.requireAsset(assetId);
    if (!dto.vtt.trimStart().startsWith('WEBVTT')) throw badRequest('INVALID_SUBTITLE', 'Subtitles must be a WebVTT file (starting with WEBVTT)');
    const key = `private/subs/${assetId}/${dto.language}.vtt`;
    await this.storage.put(key, Buffer.from(dto.vtt, 'utf8'), 'text/vtt');
    const existing = await this.subtitles.findOne({ where: { assetId, language: dto.language } });
    await this.subtitles.save({ ...(existing ?? {}), assetId, language: dto.language, label: dto.label, storageKey: key });
    return { assetId, language: dto.language, label: dto.label };
  }
  async removeSubtitle(assetId: string, language: string) {
    const s = await this.subtitles.findOne({ where: { assetId, language } });
    if (!s) throw new NotFoundException();
    await this.storage.delete(s.storageKey);
    await this.subtitles.delete({ id: s.id });
  }

  /** Housekeeping: an upload that was started and never completed within a day is removed so it cannot linger. */
  async cleanupAbandoned(now = new Date()): Promise<number> {
    const stale = await this.assets.find({ where: { status: VideoStatus.Uploading, createdAt: LessThan(new Date(now.getTime() - 24 * 3600_000)) }, take: 100 });
    for (const a of stale) {
      await this.storage.delete(a.sourceKey).catch((err) => this.log.warn({ err }, 'cleanup delete failed'));
      await this.assets.update(a.id, { status: VideoStatus.Failed, failureReason: 'Upload was never completed' });
    }
    return stale.length;
  }

  private async requireAsset(id: string): Promise<VideoAsset> {
    if (!/^\d+$/.test(id)) throw new NotFoundException();
    const a = await this.assets.findOne({ where: { id } });
    if (!a) throw new NotFoundException();
    return a;
  }
}
