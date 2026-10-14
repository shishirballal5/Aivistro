import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

const toBool = ({ value }: { value: unknown }) => (typeof value === 'string' ? ['true', '1', 'yes'].includes(value.toLowerCase()) : value);

/**
 * Every environment variable the backend reads. Validated once at start-up:
 * a missing or malformed value stops the process instead of failing later at runtime.
 */
export class EnvironmentVariables {
  @IsIn(Object.values(NodeEnv))
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  PORT = 3000;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';

  /** Comma-separated list of allowed browser origins. Never "*" in production. */
  @IsString()
  CORS_ORIGINS = 'http://localhost:5173,http://localhost:8443';

  /** Number of reverse-proxy hops to trust for client IPs (0 = none). */
  @Type(() => Number) @IsInt() @Min(0) @Max(10)
  TRUST_PROXY_HOPS = 0;

  /** Defaults to on outside production, off in production (see validateEnv). */
  @IsOptional() @Transform(toBool) @IsBoolean()
  SWAGGER_ENABLED?: boolean;

  @Type(() => Number) @IsInt() @Min(1000)
  THROTTLE_TTL_MS = 60000;

  @Type(() => Number) @IsInt() @Min(1)
  THROTTLE_LIMIT = 120;


  // ── Secrets and auth ──
  /** Master secret (>= 32 chars). Every signing/encryption key is derived from it with HKDF. Generate: `openssl rand -hex 32`. */
  @IsOptional() @IsString() @MinLength(32)
  APP_SECRET?: string;

  @Type(() => Number) @IsInt() @Min(60) @Max(3600)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  @Type(() => Number) @IsInt() @Min(1) @Max(90)
  REFRESH_TOKEN_TTL_DAYS = 30;

  @IsString() @IsNotEmpty()
  TOTP_ISSUER = 'AIVISTRO';

  /** "dev" prints/captures OTP and emails (never allowed in production). "http" posts JSON to SMS_HTTP_URL. "none" disables. */
  @IsIn(['dev', 'http', 'none'])
  SMS_PROVIDER = 'dev';
  /** DEVELOPMENT ONLY. When set, every phone OTP is this code. Refused in production and with any real SMS provider. */
  @IsOptional() @Matches(/^\d{6}$/, { message: 'DEV_FIXED_OTP must be exactly 6 digits' })
  DEV_FIXED_OTP?: string;
  @IsOptional() @IsString() SMS_HTTP_URL?: string;
  @IsOptional() @IsString() SMS_HTTP_AUTHORIZATION?: string;

  @IsIn(['dev', 'http', 'none'])
  EMAIL_PROVIDER = 'dev';
  @IsOptional() @IsString() EMAIL_HTTP_URL?: string;
  @IsOptional() @IsString() EMAIL_HTTP_AUTHORIZATION?: string;

  /** Comma-separated OAuth client IDs. A provider is enabled only when its IDs are set. */
  @IsOptional() @IsString() GOOGLE_CLIENT_IDS?: string;
  @IsOptional() @IsString() APPLE_CLIENT_IDS?: string;

  /** Base URL of the viewer web app, used in emailed links (verify email, reset password). */
  @IsString() @IsNotEmpty()
  WEB_APP_URL = 'http://localhost:5173';

  /** Public base URL for non-protected images (posters, thumbnails), e.g. a CDN path. */
  @IsOptional() @IsString() MEDIA_PUBLIC_BASE_URL?: string;

  // ── Payments ──
  /** "razorpay" = real Razorpay. "dev" = in-memory simulator (never allowed in production). "none" disables purchases. */
  @IsIn(['razorpay', 'dev', 'none'])
  PAYMENT_GATEWAY = 'dev';
  @IsOptional() @IsString() RAZORPAY_KEY_ID?: string;
  @IsOptional() @IsString() RAZORPAY_KEY_SECRET?: string;
  @IsOptional() @IsString() RAZORPAY_WEBHOOK_SECRET?: string;

  // ── Video storage, processing and playback ──
  /** "s3" = Amazon S3 or Cloudflare R2 (S3 API). "local" = a folder on disk for development only (never allowed in production). */
  @IsIn(['s3', 'local'])
  STORAGE_DRIVER = 'local';
  @IsOptional() @IsString() S3_BUCKET?: string;
  @IsOptional() @IsString() S3_REGION?: string;
  /** Leave empty for AWS S3. For Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com (region "auto"). */
  @IsOptional() @IsString() S3_ENDPOINT?: string;
  @IsOptional() @IsString() S3_ACCESS_KEY_ID?: string;
  @IsOptional() @IsString() S3_SECRET_ACCESS_KEY?: string;
  @Transform(toBool) @IsBoolean()
  S3_FORCE_PATH_STYLE = false;
  @IsString() @IsNotEmpty()
  STORAGE_LOCAL_DIR = './storage';
  @IsString() @IsNotEmpty()
  FFMPEG_PATH = 'ffmpeg';
  @IsString() @IsNotEmpty()
  FFPROBE_PATH = 'ffprobe';
  @Type(() => Number) @IsInt() @Min(1024)
  MAX_UPLOAD_BYTES = 2_147_483_648;
  @Type(() => Number) @IsInt() @Min(5) @Max(7200)
  MAX_VIDEO_SECONDS = 1800;
  /** Concurrent streams per account. A new stream beyond the limit ends the oldest one. */
  @Type(() => Number) @IsInt() @Min(1) @Max(10)
  MAX_CONCURRENT_STREAMS = 2;
  /** A playback token stays valid this long without a heartbeat. The player must heartbeat to keep it alive. */
  @Type(() => Number) @IsInt() @Min(30) @Max(3600)
  PLAYBACK_SESSION_TTL_SECONDS = 300;
  @Type(() => Number) @IsInt() @Min(1) @Max(24)
  PLAYBACK_SESSION_MAX_HOURS = 6;
  /** Base delay of the exponential backoff between video-processing retries. */
  @Type(() => Number) @IsInt() @Min(10) @Max(600000)
  VIDEO_RETRY_DELAY_MS = 15000;

  // ── Push notifications ──
  /** "fcm" = Firebase Cloud Messaging (needs the two values below). "dev" only logs (never allowed in production). "none" disables push; in-app notifications still work. */
  @IsIn(['fcm', 'dev', 'none'])
  PUSH_PROVIDER = 'dev';
  @IsOptional() @IsString() FCM_PROJECT_ID?: string;
  /** The service-account JSON (the whole document as a single-line string). */
  @IsOptional() @IsString() FCM_SERVICE_ACCOUNT_JSON?: string;

  // ── Monitoring ──
  /** Optional Sentry DSN. When set, 5xx errors are reported (install the optional package: npm i @sentry/node). */
  @IsOptional() @IsString() SENTRY_DSN?: string;
  /** Enables GET /api/v1/metrics (Prometheus format) for callers presenting this bearer token. Unset = the endpoint does not exist. */
  @IsOptional() @IsString() @MinLength(16) METRICS_TOKEN?: string;

  /** Multiplies per-route auth rate limits. Leave unset (1) in production; tests raise it. */
  @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  AUTH_RATE_LIMIT_SCALE = 1;

  // ── MySQL ──
  @IsString() @IsNotEmpty()
  DB_HOST = 'localhost';

  @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  DB_PORT = 3306;

  @IsString() @IsNotEmpty()
  DB_USERNAME = 'aivistro';

  /** Required (non-empty) in production; enforced in validateEnv below. */
  @IsString()
  DB_PASSWORD = '';

  @IsString() @IsNotEmpty()
  DB_NAME = 'aivistro_dev';

  @Type(() => Number) @IsInt() @Min(1) @Max(200)
  DB_POOL_SIZE = 10;

  /** How many times to retry the first connection (containers often start before MySQL is ready). */
  @Type(() => Number) @IsInt() @Min(0) @Max(100)
  DB_CONNECT_RETRIES = 10;

  @Type(() => Number) @IsInt() @Min(0) @Max(60000)
  DB_CONNECT_RETRY_DELAY_MS = 3000;

  @Transform(toBool) @IsBoolean()
  DB_SSL = false;

  @Transform(toBool) @IsBoolean()
  DB_LOGGING = false;

  // ── Redis ──
  @IsString() @IsNotEmpty()
  REDIS_HOST = 'localhost';

  @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  REDIS_PORT = 6379;

  @IsString() @IsOptional()
  REDIS_PASSWORD = '';

  @Type(() => Number) @IsInt() @Min(0) @Max(15)
  REDIS_DB = 0;

  @Transform(toBool) @IsBoolean()
  REDIS_TLS = false;
}

export function validateEnv(raw: Record<string, unknown>, opts: { requireSecret?: boolean } = {}): EnvironmentVariables {
  const requireSecret = opts.requireSecret ?? true;
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true, enableImplicitConversion: false });
  const errors = validateSync(env, { skipMissingProperties: false, whitelist: false });
  if (errors.length) {
    const lines = errors.map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const production = env.NODE_ENV === NodeEnv.Production;
  if (requireSecret && !env.APP_SECRET) throw new Error('Invalid environment configuration:\n  - APP_SECRET: must be set (>= 32 characters). Generate one with: openssl rand -hex 32');
  if (production) {
    const problems: string[] = [];
    if (/change-?me/i.test(env.APP_SECRET ?? '')) problems.push('APP_SECRET must not be a placeholder value');
    if (env.SMS_PROVIDER === 'dev') problems.push('SMS_PROVIDER=dev is not allowed in production');
    if (env.DEV_FIXED_OTP) problems.push('DEV_FIXED_OTP is not allowed in production');
    if (env.EMAIL_PROVIDER === 'dev') problems.push('EMAIL_PROVIDER=dev is not allowed in production');
    if (env.PAYMENT_GATEWAY === 'dev') problems.push('PAYMENT_GATEWAY=dev is not allowed in production');
    if (env.PUSH_PROVIDER === 'dev') problems.push('PUSH_PROVIDER=dev is not allowed in production (use fcm or none)');
    if (env.STORAGE_DRIVER === 'local') problems.push('STORAGE_DRIVER=local is not allowed in production (use s3)');
    if (!env.DB_PASSWORD) problems.push('DB_PASSWORD must be set in production');
    if (env.CORS_ORIGINS.split(',').some((o) => o.trim() === '*')) problems.push('CORS_ORIGINS must not contain "*" in production');
    if (problems.length) throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  if (env.DEV_FIXED_OTP && env.SMS_PROVIDER !== 'dev') throw new Error('Invalid environment configuration:\n  - DEV_FIXED_OTP requires SMS_PROVIDER=dev (a known code with a real SMS provider would let anyone sign in as anyone)');
  if (env.PAYMENT_GATEWAY === 'razorpay' && !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)) {
    throw new Error('Invalid environment configuration:\n  - PAYMENT_GATEWAY=razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET');
  }
  if (env.STORAGE_DRIVER === 's3' && !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
    throw new Error('Invalid environment configuration:\n  - STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  }
  if (env.PUSH_PROVIDER === 'fcm') {
    let ok = !!env.FCM_PROJECT_ID && !!env.FCM_SERVICE_ACCOUNT_JSON;
    try { const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON ?? ''); ok = ok && !!sa.client_email && !!sa.private_key; } catch { ok = false; }
    if (!ok) throw new Error('Invalid environment configuration:\n  - PUSH_PROVIDER=fcm requires FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON (a service-account JSON with client_email and private_key)');
  }
  // Swagger is on by default everywhere except production.
  if (env.SWAGGER_ENABLED === undefined) env.SWAGGER_ENABLED = !production;
  return env;
}

/**
 * For ConfigModule's `validate` hook. Checks the raw environment and returns it UNCHANGED, so Nest does not
 * write computed defaults back into process.env (that would let one default leak into another environment).
 * The typed config factories apply defaults themselves via validateEnv().
 */
export function assertValidEnv(raw: Record<string, unknown>): Record<string, unknown> {
  validateEnv(raw);
  return raw;
}
