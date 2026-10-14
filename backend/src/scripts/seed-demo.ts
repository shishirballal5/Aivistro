import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AdminUser, ContentStatus, Episode, Series, VideoAsset, VideoStatus } from '../database/entities/index';
import { StorageService } from '../modules/storage/storage.service';
import { VideoAssetsService } from '../modules/video-assets/video-assets.service';

/**
 * DEVELOPMENT ONLY. Gives the seeded sample series real, playable content by driving the REAL pipeline:
 * it generates a short test clip with FFmpeg, "uploads" it into storage, calls the same complete() the admin API uses,
 * and waits for the WORKER (run `npm run start:worker:dev` first) to transcode it to encrypted HLS. Only then is the
 * episode, and its series, published. Posters are the sample images in backend/seed-assets/images/, uploaded into storage.
 *
 *   npm run seed:dev && npm run start:worker:dev   # (worker in another terminal)
 *   MEDIA_PUBLIC_BASE_URL=/api/v1/media npm run seed:demo
 *
 * The clips are synthetic colour-bar test patterns, not real drama content.
 */
// Keys follow the same `images/...` rule the admin API enforces. The sample files live in backend/seed-assets/images/ and are uploaded
// into the configured storage by this script; the API serves them at /api/v1/media/images/* (set MEDIA_PUBLIC_BASE_URL=/api/v1/media).
const POSTERS: Record<string, string> = {
  'What She Left Behind': 'images/what-she-left-behind.jpg',
  'The Last Alibi': 'images/last-alibi.jpg',
  'The Heiress Code': 'images/heiress-code.jpg',
  'Love, Rewritten': 'images/couple.jpg',
  'After Midnight': 'images/the-wolfs-promise.jpg',
  'Borrowed Vows': 'images/borrowed-vows.jpg',
  'Silent Witness': 'images/silent-witness.jpg',
  'Moonlit Contract': 'images/moonlit-contract.jpg',
  'Crown of Ashes': 'images/silent-witness.jpg',
  "The Wolf's Promise": 'images/the-wolfs-promise.jpg',
  'Vengeance in Silk': 'images/borrowed-vows.jpg',
  'Midnight Tenant': 'images/last-alibi.jpg',
};
const EPISODES_PER_SERIES = Number(process.env.DEMO_EPISODES ?? 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeClip(dir: string, hue: number, n: number): string {
  const out = join(dir, `clip-${hue}-${n}.mp4`);
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=540x960:rate=24:duration=${6 + n},hue=h=${hue}`, '-f', 'lavfi', '-i', `sine=frequency=${300 + n * 80}:duration=${6 + n}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
  return out;
}

async function main() {
  config({ path: process.env.ENV_FILE ?? '.env' });
  if (process.env.NODE_ENV === 'production') throw new Error('seed:demo refuses to run in production');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dir = mkdtempSync(join(tmpdir(), 'aivistro-demo-'));
  try {
    const ds = app.get(DataSource);
    const storage = app.get(StorageService);
    const videos = app.get(VideoAssetsService);
    // Upload the sample posters through the real storage layer (idempotent), so the API's image route can serve them.
    for (const key of new Set(Object.values(POSTERS))) await storage.put(key, readFileSync(join(__dirname, '../../seed-assets', key)), 'image/jpeg');
    const admin = await ds.getRepository(AdminUser).findOne({ where: { email: 'dev-admin@aivistro.local' } });
    if (!admin) throw new Error('Run `npm run seed:dev` first (it creates the dev admin and the sample series).');
    let hue = 0;
    for (const [title, poster] of Object.entries(POSTERS)) {
      const series = await ds.getRepository(Series).findOne({ where: { title } });
      if (!series) { console.log(`Skipping "${title}" (not seeded)`); continue; }
      hue += 110;
      const episodes = await ds.getRepository(Episode).find({ where: { seriesId: series.id }, order: { number: 'ASC' }, take: EPISODES_PER_SERIES });
      for (const ep of episodes) {
        if (ep.status === ContentStatus.Published && ep.currentAssetId) continue;
        const file = makeClip(dir, hue, ep.number);
        const body = readFileSync(file);
        const req = await videos.requestUpload(admin.id, ep.id, { filename: `episode-${ep.number}.mp4`, contentType: 'video/mp4', sizeBytes: body.length });
        const asset = await ds.getRepository(VideoAsset).findOneByOrFail({ id: req.assetId });
        await storage.put(asset.sourceKey, body, 'video/mp4');
        await videos.complete(asset.id);
        process.stdout.write(`  ${title} ep ${ep.number}: processing`);
        for (let i = 0; i < 120; i++) {
          const a = await ds.getRepository(VideoAsset).findOneByOrFail({ id: asset.id });
          if (a.status === VideoStatus.Ready) break;
          if (a.status === VideoStatus.Failed) throw new Error(`processing failed: ${a.failureReason}`);
          if (i === 119) throw new Error('timed out waiting for the worker. Is `npm run start:worker:dev` running?');
          process.stdout.write('.'); await sleep(1000);
        }
        // Only now, with a READY rendition, does the episode go live (same rule the admin publish API enforces).
        await ds.getRepository(Episode).update(ep.id, { status: ContentStatus.Published, publishedAt: new Date(), title: ep.title === `Episode ${ep.number}` ? `Episode ${ep.number}` : ep.title });
        console.log(' ready');
      }
      await ds.getRepository(Series).update(series.id, { posterKey: poster, bannerKey: poster, isFeatured: ['What She Left Behind', 'The Last Alibi', 'The Heiress Code'].includes(title), status: ContentStatus.Published, publishedAt: new Date() });
      console.log(`Published "${title}" with ${episodes.length} playable episodes`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); await app.close(); }
}
main().catch((e) => { console.error(`seed:demo failed: ${e.message}`); process.exit(1); });
