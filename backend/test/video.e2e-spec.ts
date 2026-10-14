import { getQueueToken } from '@nestjs/bullmq';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createDecipheriv } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue } from 'bullmq';
import { VideoAsset, VideoStatus } from '../src/database/entities/index';
import { QUEUES } from '../src/modules/queues/queue.constants';
import { StorageService } from '../src/modules/storage/storage.service';
import { VideoAssetsCoreModule } from '../src/modules/video-assets/video-assets-core.module';
import { VideoAssetsService } from '../src/modules/video-assets/video-assets.service';
import { VideoProcessor } from '../src/modules/video-assets/video.processor';
import { KeyService } from '../src/common/crypto/key.service';
import { decryptToBuffer } from '../src/common/crypto/crypto.util';
import { createApp } from './helpers';
import { adminToken, bearer, dsOf, getBinary, http, resetData, subscribedViewer } from './factories';

const FFMPEG = process.env.FFMPEG_PATH;
const FFPROBE = process.env.FFPROBE_PATH;
if (!FFMPEG || !FFPROBE) console.warn('video.e2e: FFMPEG_PATH / FFPROBE_PATH not set, so the real-FFmpeg tests are SKIPPED');
const maybe = FFMPEG && FFPROBE ? describe : describe.skip;

maybe('video upload, FFmpeg processing and protected delivery (REAL FFmpeg, MySQL, Redis)', () => {
  let app: NestExpressApplication;
  let work: string; let storageDir: string;
  let editor: string; let admin: string;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'aiv-vid-test-'));
    storageDir = join(work, 'storage');
    app = await createApp(
      { STORAGE_LOCAL_DIR: storageDir, FFMPEG_PATH: FFMPEG!, FFPROBE_PATH: FFPROBE!, MAX_UPLOAD_BYTES: '5000000', MAX_VIDEO_SECONDS: '10', VIDEO_RETRY_DELAY_MS: '50', MEDIA_PUBLIC_BASE_URL: 'https://cdn.aivistro.test' },
      undefined, { imports: [VideoAssetsCoreModule], providers: [VideoProcessor] },
    );
  });
  afterAll(async () => { await app.close(); await rm(work, { recursive: true, force: true }); });
  beforeEach(async () => { await resetData(app); admin = await adminToken(app, ['SUPER_ADMIN']); editor = await adminToken(app, ['EDITOR']); });

  const api = (p: string) => `/api/v1${p}`;
  const storage = () => app.get(StorageService);
  let n = 0; const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;

  function ffmpegRun(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => { const c = spawn(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-y', ...args]); let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err)))); });
  }
  async function makeVideo(name: string, o: { size?: string; seconds?: number; audio?: boolean } = {}): Promise<string> {
    const file = join(work, name);
    await ffmpegRun(['-f', 'lavfi', '-i', `testsrc=size=${o.size ?? '360x640'}:rate=25`, ...(o.audio === false ? [] : ['-f', 'lavfi', '-i', 'sine=frequency=440']), '-t', String(o.seconds ?? 6), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(o.audio === false ? [] : ['-c:a', 'aac', '-shortest']), file]);
    return file;
  }

  async function episode() {
    const g = (await http(app).post(api('/admin/genres')).set(bearer(admin)).send({ name: uniq('G') }).expect(201)).body;
    const s = (await http(app).post(api('/admin/series')).set(bearer(editor)).send({ title: uniq('Show'), synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body;
    const e = (await http(app).post(api(`/admin/series/${s.id}/episodes`)).set(bearer(editor)).send({ title: 'Pilot' }).expect(201)).body;
    return { series: s as { id: string; slug: string }, ep: e as { id: string } };
  }
  async function waitFor(assetId: string, statuses: VideoStatus[], ms = 90_000): Promise<VideoAsset> {
    const end = Date.now() + ms;
    for (;;) {
      const a = await dsOf(app).getRepository(VideoAsset).findOneByOrFail({ id: assetId });
      if (statuses.includes(a.status)) return a;
      if (Date.now() > end) throw new Error(`asset ${assetId} stuck in ${a.status} (${a.failureReason})`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  /** The real admin flow: request URL -> PUT the bytes -> complete. */
  async function upload(episodeId: string, file: string, o: { contentType?: string; filename?: string; token?: string } = {}) {
    const bytes = await readFile(file);
    const req = await http(app).post(api(`/admin/episodes/${episodeId}/video-assets`)).set(bearer(o.token ?? editor)).send({ filename: o.filename ?? 'clip.mp4', contentType: o.contentType ?? 'video/mp4', sizeBytes: bytes.length }).expect(201);
    await http(app).put(req.body.upload.url).set('Content-Type', o.contentType ?? 'video/mp4').send(bytes).expect(200);
    const done = await http(app).post(api(`/admin/video-assets/${req.body.assetId}/complete`)).set(bearer(o.token ?? editor)).expect(200);
    return { assetId: req.body.assetId as string, complete: done.body };
  }

  it('end to end: upload -> FFmpeg -> encrypted HLS -> publish -> a subscriber streams and DECRYPTS a segment', async () => {
    const { series, ep } = await episode();
    const file = await makeVideo('good.mp4', { size: '360x640', seconds: 6 });
    const { assetId, complete } = await upload(ep.id, file);
    expect(['UPLOADED', 'PROCESSING', 'READY']).toContain(complete.status);
    const asset = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
    expect(asset.status).toBe(VideoStatus.Ready);
    expect(asset).toMatchObject({ width: 360, height: 640, generation: 1 });
    expect(asset.durationSeconds).toBeGreaterThanOrEqual(5);
    expect(asset.variants!.map((v) => v.name)).toEqual(['360p']);
    expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.encryptionKeyEnc).toMatch(/^v1\./);

    // the episode now points at it, with the REAL duration, and got a thumbnail
    const e = (await http(app).get(api(`/admin/episodes/${ep.id}`)).set(bearer(editor)).expect(200)).body;
    expect(e).toMatchObject({ hasVideo: true });
    expect(e.durationSeconds).toBe(asset.durationSeconds);
    expect(e.thumbnailKey).toBe(`images/thumbs/ep-${ep.id}-${assetId}.jpg`);
    expect(await storage().stat(e.thumbnailKey)).not.toBeNull();

    // output exists in PRIVATE storage and the segments really are encrypted (not plain MPEG-TS)
    const idx = await storage().get(`${asset.hlsPrefix}360p/index.m3u8`);
    const playlist = (await streamText(idx!.stream));
    expect(playlist).toMatch(/#EXT-X-KEY:METHOD=AES-128,URI="\.\.\/enc\.key"/);
    expect(playlist).toContain('#EXT-X-ENDLIST');
    const seg = (await streamBuf((await storage().get(`${asset.hlsPrefix}360p/seg_0000.ts`))!.stream));
    expect([seg[0], seg[188], seg[376]].every((b) => b === 0x47)).toBe(false);

    // publishing is now allowed
    await http(app).post(api(`/admin/episodes/${ep.id}/publish`)).set(bearer(editor)).expect(200);
    await http(app).post(api(`/admin/series/${series.id}/publish`)).set(bearer(editor)).expect(200);

    // a subscriber requests playback and pulls the whole chain through the token-protected endpoints
    const sub = await subscribedViewer(app);
    const sess = (await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(201)).body;
    expect(sess.manifestUrl).toMatch(/^\/api\/v1\/media\/hls\/[\w-]{40,}\/master\.m3u8$/);
    const base = sess.manifestUrl.replace('master.m3u8', '');
    const master = (await http(app).get(sess.manifestUrl).expect(200)).text;
    expect(master).toContain('RESOLUTION=360x640');
    const variant = (await http(app).get(`${base}360p/index.m3u8`).expect(200)).text;
    expect(variant).toContain('seg_0000.ts');
    const key = (await getBinary(app, `${base}enc.key`).expect(200)).body as Buffer;
    expect(key).toHaveLength(16);
    expect(key.equals(decryptToBuffer(app.get(KeyService).mediaEncryption, asset.encryptionKeyEnc!))).toBe(true);
    const encrypted = (await getBinary(app, `${base}360p/seg_0000.ts`).expect(200)).body as Buffer;
    const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16));
    const plain = Buffer.concat([d.update(encrypted), d.final()]);
    for (let o = 0; o < plain.length; o += 188) expect(plain[o]).toBe(0x47); // a valid MPEG-TS stream, but ONLY with the key
    for (const h of ['/master.m3u8']) expect((await http(app).get(`${base.slice(0, -1)}${h}`)).headers['cache-control']).toBe('no-store');
  });

  it('builds a multi-rendition ladder for a larger video, all variants playable', async () => {
    const { ep } = await episode();
    const { assetId } = await upload(ep.id, await makeVideo('big.mp4', { size: '720x1280', seconds: 3 }));
    const a = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
    expect(a.status).toBe(VideoStatus.Ready);
    expect(a.variants!.map((v) => `${v.name}:${v.width}x${v.height}`)).toEqual(['720p:720x1280', '480p:480x854', '360p:360x640']);
    for (const v of a.variants!) expect(await storage().stat(`${a.hlsPrefix}${v.name}/seg_0000.ts`)).not.toBeNull();
  });

  it('handles a video with no audio track', async () => {
    const { ep } = await episode();
    const { assetId } = await upload(ep.id, await makeVideo('silent.mp4', { audio: false, seconds: 4 }));
    expect((await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed])).status).toBe(VideoStatus.Ready);
  });

  describe('upload authorisation and validation', () => {
    it('only users with video.manage can upload; the URL is short-lived and single-purpose', async () => {
      const { ep } = await episode();
      const body = { filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 100000 };
      await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).send(body).expect(401);
      const support = await adminToken(app, ['SUPPORT']);
      await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(support)).send(body).expect(403);
      const ok = await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send(body).expect(201);
      expect(ok.body.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'video/mp4' } });
      expect(new Date(ok.body.upload.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 901_000);
      const [row] = await dsOf(app).query('SELECT source_key FROM video_assets WHERE id = ?', [ok.body.assetId]);
      expect(row.source_key).toMatch(/^private\/source\/\d+\/\d+-[\w-]{16,}\.mp4$/); // unguessable, under private/
      await http(app).post(api('/admin/episodes/999999/video-assets')).set(bearer(editor)).send(body).expect(404);
    });

    it.each([
      ['a non-video content type', { filename: 'a.mp4', contentType: 'application/pdf', sizeBytes: 100000 }],
      ['an executable disguised as video', { filename: 'a.exe', contentType: 'video/mp4', sizeBytes: 100000 }],
      ['a path in the filename', { filename: '../../a.php', contentType: 'video/mp4', sizeBytes: 100000 }],
      ['a size over the limit', { filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 6_000_000 }],
      ['a zero size', { filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 0 }],
      ['a fractional size', { filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 100.5 }],
      ['unknown fields', { filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 100000, sourceKey: 'private/x' }],
    ])('rejects %s', async (_l, body) => {
      const { ep } = await episode();
      await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send(body).expect(400);
    });

    it('the upload endpoint rejects a tampered token, wrong Content-Type, wrong or excess length, and expired links', async () => {
      const { ep } = await episode();
      const req = (await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 2048 }).expect(201)).body;
      const url: string = req.upload.url;
      const data = Buffer.alloc(2048, 1);
      await http(app).put(`${url}x`).set('Content-Type', 'video/mp4').send(data).expect(403);
      await http(app).put(url).set('Content-Type', 'application/octet-stream').send(data).expect(400);
      await http(app).put(url).set('Content-Type', 'video/mp4').send(Buffer.alloc(2049, 1)).expect(400);
      await http(app).put(url).set('Content-Type', 'video/mp4').send(Buffer.alloc(2047, 1)).expect(400);
      await http(app).put('/api/v1/storage/local/not-a-token').set('Content-Type', 'video/mp4').send(data).expect(403);
      await http(app).put(url).set('Content-Type', 'video/mp4').send(data).expect(200);
    });

    it('completing before uploading, twice, or with a different size than declared is refused (and the bad file removed)', async () => {
      const { ep } = await episode();
      const mk = async (size: number) => (await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: size }).expect(201)).body;
      const early = await mk(2048);
      expect((await http(app).post(api(`/admin/video-assets/${early.assetId}/complete`)).set(bearer(editor)).expect(409)).body.code).toBe('UPLOAD_NOT_FOUND');

      // declared 5000, actually uploaded 3000: only possible by streaming directly to storage, so write straight in
      const liar = await mk(5000);
      const [{ source_key }] = await dsOf(app).query('SELECT source_key FROM video_assets WHERE id = ?', [liar.assetId]);
      await storage().put(source_key, Buffer.alloc(3000, 7), 'video/mp4');
      const r = await http(app).post(api(`/admin/video-assets/${liar.assetId}/complete`)).set(bearer(editor)).expect(400);
      expect(r.body.code).toBe('UPLOAD_SIZE_MISMATCH');
      expect(await storage().stat(source_key)).toBeNull();
      expect((await dsOf(app).getRepository(VideoAsset).findOneByOrFail({ id: liar.assetId })).status).toBe(VideoStatus.Failed);
      await http(app).post(api(`/admin/video-assets/${liar.assetId}/complete`)).set(bearer(editor)).expect(409);
    });

    it('caps the number of pending uploads per episode', async () => {
      const { ep } = await episode();
      for (let i = 0; i < 5; i++) await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 2048 }).expect(201);
      expect((await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 2048 }).expect(429)).body.code).toBe('TOO_MANY_PENDING_UPLOADS');
    });

    it('housekeeping removes uploads that were never completed', async () => {
      const { ep } = await episode();
      const req = (await http(app).post(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 2048 }).expect(201)).body;
      await http(app).put(req.upload.url).set('Content-Type', 'video/mp4').send(Buffer.alloc(2048, 1)).expect(200);
      await dsOf(app).query('UPDATE video_assets SET created_at = NOW(3) - INTERVAL 25 HOUR WHERE id = ?', [req.assetId]);
      expect(await app.get(VideoAssetsService).cleanupAbandoned()).toBe(1);
      expect((await dsOf(app).getRepository(VideoAsset).findOneByOrFail({ id: req.assetId })).failureReason).toMatch(/never completed/);
    });
  });

  describe('bad input to the processor: fails safely, with a readable reason, never reaches viewers', () => {
    async function expectFailed(file: string, reason: RegExp, o: { ct?: string; filename?: string } = {}) {
      const { ep } = await episode();
      const { assetId } = await upload(ep.id, file, { contentType: o.ct, filename: o.filename });
      const a = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      expect(a.status).toBe(VideoStatus.Failed);
      expect(a.failureReason).toMatch(reason);
      expect(a.processingAttempts).toBe(1); // a problem with the file is permanent: not retried
      expect((await http(app).get(api(`/admin/episodes/${ep.id}`)).set(bearer(editor)).expect(200)).body.hasVideo).toBe(false);
      await http(app).post(api(`/admin/episodes/${ep.id}/publish`)).set(bearer(editor)).expect(422);
    }
    it('a text file renamed to .mp4', async () => { const f = join(work, 'fake.mp4'); await writeFile(f, 'this is not a video at all'.repeat(100)); await expectFailed(f, /./); });
    it('an HLS playlist uploaded as a "video" is refused (cannot be used to read local files or fetch URLs)', async () => {
      const f = join(work, 'evil.mp4');
      await writeFile(f, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile:///etc/passwd\n#EXTINF:10,\nhttp://169.254.169.254/latest/meta-data/\n#EXT-X-ENDLIST\n' + '# padding\n'.repeat(200));
      await expectFailed(f, /./);
    });
    it('an ffconcat script is refused', async () => { const f = join(work, 'concat.mp4'); await writeFile(f, "ffconcat version 1.0\nfile '/etc/passwd'\n" + '# padding\n'.repeat(200)); await expectFailed(f, /./); });
    it('an audio-only file', async () => {
      const f = join(work, 'audio.mp4'); await ffmpegRun(['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:a', 'aac', '-f', 'mp4', f]);
      await expectFailed(f, /no video/i);
    });
    it('a video longer than the limit', async () => { await expectFailed(await makeVideo('long.mp4', { seconds: 12 }), /limit is 10s/); });
  });

  describe('reprocessing and failure recovery', () => {
    it('reprocessing pauses playback with VIDEO_PROCESSING, then restores it, replacing the old rendition', async () => {
      const { series, ep } = await episode();
      const { assetId } = await upload(ep.id, await makeVideo('r.mp4', { seconds: 4 }));
      const first = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      await http(app).post(api(`/admin/episodes/${ep.id}/publish`)).set(bearer(editor)).expect(200);
      await http(app).post(api(`/admin/series/${series.id}/publish`)).set(bearer(editor)).expect(200);
      const sub = await subscribedViewer(app);
      await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(201);

      const queue = app.get<Queue>(getQueueToken(QUEUES.VideoProcessing));
      await queue.pause();
      try {
        await http(app).post(api(`/admin/video-assets/${assetId}/reprocess`)).set(bearer(editor)).expect(200);
        const denied = await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(409);
        expect(denied.body.code).toBe('VIDEO_PROCESSING');
        expect((await http(app).get(api(`/episodes/${ep.id}/access`)).set(bearer(sub.token)).expect(200)).body.code).toBe('VIDEO_PROCESSING');
      } finally { await queue.resume(); }
      const second = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      expect(second.status).toBe(VideoStatus.Ready);
      expect(second.generation).toBe(2);
      expect(second.hlsPrefix).not.toBe(first.hlsPrefix);
      expect(await storage().stat(`${first.hlsPrefix}360p/index.m3u8`)).toBeNull(); // the old rendition was cleaned up
      await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(201);
    });

    it('a FAILED reprocess keeps the previous working rendition playable', async () => {
      const { series, ep } = await episode();
      const { assetId } = await upload(ep.id, await makeVideo('keep.mp4', { seconds: 4 }));
      const first = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      await http(app).post(api(`/admin/episodes/${ep.id}/publish`)).set(bearer(editor)).expect(200);
      await http(app).post(api(`/admin/series/${series.id}/publish`)).set(bearer(editor)).expect(200);
      await storage().put(first.sourceKey, Buffer.from('corrupted original'.repeat(500)), 'video/mp4'); // the original is damaged
      await dsOf(app).query('UPDATE video_assets SET declared_size_bytes = ? WHERE id = ?', [String('corrupted original'.length * 500), assetId]);
      await http(app).post(api(`/admin/video-assets/${assetId}/reprocess`)).set(bearer(editor)).expect(200);
      await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      await new Promise((r) => setTimeout(r, 300));
      const after = await dsOf(app).getRepository(VideoAsset).findOneByOrFail({ id: assetId });
      expect(after.status).toBe(VideoStatus.Ready); // fell back to the last good rendition
      expect(after.failureReason).toBeTruthy();
      expect(after.hlsPrefix).toBe(first.hlsPrefix);
      const sub = await subscribedViewer(app);
      await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(201);
    });

    it('an infrastructure error is retried automatically and succeeds', async () => {
      const { ep } = await episode();
      const spy = jest.spyOn(storage(), 'downloadTo').mockRejectedValueOnce(new Error('storage temporarily unavailable'));
      const { assetId } = await upload(ep.id, await makeVideo('retry.mp4', { seconds: 3 }));
      const a = await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      spy.mockRestore();
      expect(a.status).toBe(VideoStatus.Ready);
      expect(a.processingAttempts).toBe(2);
    });

    it('after the retries are exhausted the asset is FAILED with the reason, and the job stays in the failed set for an operator', async () => {
      const { ep } = await episode();
      const spy = jest.spyOn(storage(), 'downloadTo').mockRejectedValue(new Error('storage is down'));
      const { assetId } = await upload(ep.id, await makeVideo('dead.mp4', { seconds: 3 }));
      const a = await waitFor(assetId, [VideoStatus.Failed, VideoStatus.Ready]);
      spy.mockRestore();
      expect(a.status).toBe(VideoStatus.Failed);
      expect(a.failureReason).toMatch(/storage is down/);
      expect(a.processingAttempts).toBe(3);
      const queue = app.get<Queue>(getQueueToken(QUEUES.VideoProcessing));
      expect((await queue.getFailed()).some((j) => j.data.assetId === assetId)).toBe(true);
      // and an operator can re-run it once the problem is fixed
      await http(app).post(api(`/admin/video-assets/${assetId}/reprocess`)).set(bearer(editor)).expect(200);
      expect((await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed])).status).toBe(VideoStatus.Ready);
    });
  });

  describe('subtitles', () => {
    it('are served only through an authorised session, and listed in the master playlist', async () => {
      const { series, ep } = await episode();
      const { assetId } = await upload(ep.id, await makeVideo('s.mp4', { seconds: 3 }));
      await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
      await http(app).post(api(`/admin/video-assets/${assetId}/subtitles`)).set(bearer(editor)).send({ language: 'hi', label: 'हिन्दी', vtt: 'not a vtt file at all' }).expect(400);
      await http(app).post(api(`/admin/video-assets/${assetId}/subtitles`)).set(bearer(editor)).send({ language: 'HINDI!', label: 'x', vtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nनमस्ते' }).expect(400);
      await http(app).post(api(`/admin/video-assets/${assetId}/subtitles`)).set(bearer(editor)).send({ language: 'hi', label: 'हिन्दी', vtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nनमस्ते' }).expect(200);
      await http(app).post(api(`/admin/episodes/${ep.id}/publish`)).set(bearer(editor)).expect(200);
      await http(app).post(api(`/admin/series/${series.id}/publish`)).set(bearer(editor)).expect(200);
      const sub = await subscribedViewer(app);
      const s = (await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(201)).body;
      const base = s.manifestUrl.replace('master.m3u8', '');
      const master = (await http(app).get(s.manifestUrl).expect(200)).text;
      expect(master).toContain('URI="subs/hi.m3u8"');
      expect((await http(app).get(`${base}subs/hi.m3u8`).expect(200)).text).toContain('hi.vtt');
      expect((await http(app).get(`${base}subs/hi.vtt`).expect(200)).text).toContain('नमस्ते');
      await http(app).get(`${base}subs/fr.vtt`).expect(404);
      await http(app).get(`${base}subs/..%2Fx.vtt`).expect(404);
      await http(app).delete(api(`/admin/video-assets/${assetId}/subtitles/hi`)).set(bearer(editor)).expect(204);
      await http(app).get(`${base}subs/hi.vtt`).expect(404);
    });
  });

  it('no API response ever contains a storage key, source path or the encryption key', async () => {
    const { series, ep } = await episode();
    const { assetId } = await upload(ep.id, await makeVideo('leak.mp4', { seconds: 3 }));
    await waitFor(assetId, [VideoStatus.Ready, VideoStatus.Failed]);
    await http(app).post(api(`/admin/episodes/${ep.id}/publish`)).set(bearer(editor)).expect(200);
    await http(app).post(api(`/admin/series/${series.id}/publish`)).set(bearer(editor)).expect(200);
    const sub = await subscribedViewer(app);
    const sess = (await http(app).post(api(`/episodes/${ep.id}/playback-session`)).set(bearer(sub.token)).expect(201)).body;
    const bodies = [
      sess,
      (await http(app).get(api(`/admin/video-assets/${assetId}`)).set(bearer(editor)).expect(200)).body,
      (await http(app).get(api(`/admin/episodes/${ep.id}/video-assets`)).set(bearer(editor)).expect(200)).body,
      (await http(app).get(api(`/series/${series.id}/episodes`)).set(bearer(sub.token)).expect(200)).body,
      (await http(app).get(api(`/series/${series.id}`)).expect(200)).body,
    ];
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(/private\/|sourceKey|source_key|hlsPrefix|hls_prefix|encryptionKey|encryption_key|seg_\d{4}|g1\//);
    expect(JSON.stringify(sess)).toMatch(/"manifestUrl":"\/api\/v1\/media\/hls\/[\w-]+\/master\.m3u8"/); // the ONLY media reference is the tokenised manifest URL
    const [row] = await dsOf(app).query('SELECT token_hash FROM playback_sessions WHERE id = ?', [sess.sessionId]);
    expect(sess.manifestUrl).not.toContain(row.token_hash); // only a hash is stored
  });
});

async function streamBuf(s: NodeJS.ReadableStream): Promise<Buffer> { const c: Buffer[] = []; for await (const x of s) c.push(Buffer.from(x as Buffer)); return Buffer.concat(c); }
async function streamText(s: NodeJS.ReadableStream): Promise<string> { return (await streamBuf(s)).toString('utf8'); }
