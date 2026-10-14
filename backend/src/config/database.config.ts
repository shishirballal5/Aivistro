import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

/** Connection settings shared by the running app and the TypeORM CLI. */
export function buildDatabaseSettings(raw: Record<string, unknown> = process.env) {
  const env = validateEnv(raw, { requireSecret: false });
  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    poolSize: env.DB_POOL_SIZE,
    ssl: env.DB_SSL,
    connectRetries: env.DB_CONNECT_RETRIES,
    connectRetryDelayMs: env.DB_CONNECT_RETRY_DELAY_MS,
    logging: env.DB_LOGGING,
  };
}

export const databaseConfig = registerAs('database', () => buildDatabaseSettings());
