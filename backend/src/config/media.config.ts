import { resolve } from 'node:path';
import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

export const mediaConfig = registerAs('media', () => {
  const env = validateEnv(process.env);
  return {
    driver: env.STORAGE_DRIVER as 's3' | 'local',
    isProduction: env.NODE_ENV === 'production',
    s3: { bucket: env.S3_BUCKET ?? '', region: env.S3_REGION ?? 'auto', endpoint: env.S3_ENDPOINT || undefined, accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '', forcePathStyle: env.S3_FORCE_PATH_STYLE },
    localDir: resolve(env.STORAGE_LOCAL_DIR),
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxVideoSeconds: env.MAX_VIDEO_SECONDS,
    maxConcurrentStreams: env.MAX_CONCURRENT_STREAMS,
    sessionTtlSeconds: env.PLAYBACK_SESSION_TTL_SECONDS,
    sessionMaxHours: env.PLAYBACK_SESSION_MAX_HOURS,
    videoRetryDelayMs: env.VIDEO_RETRY_DELAY_MS,
  };
});

export const pushConfig = registerAs('push', () => {
  const env = validateEnv(process.env);
  return { provider: env.PUSH_PROVIDER as 'fcm' | 'dev' | 'none', projectId: env.FCM_PROJECT_ID ?? '', serviceAccountJson: env.FCM_SERVICE_ACCOUNT_JSON ?? '' };
});
