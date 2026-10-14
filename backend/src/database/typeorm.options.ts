import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { buildDatabaseSettings } from '../config/database.config';
import { entities } from './entities/index';
import { mysqlUtcDriver } from './mysql-utc-driver';

/**
 * The single source of TypeORM options for the API, the worker and the CLI.
 *
 * Schema changes are made ONLY through migrations. `synchronize` is hard-coded to false
 * (no environment variable can enable it) and migrations never run automatically on boot.
 */
export function buildTypeOrmOptions(raw: Record<string, unknown> = process.env): DataSourceOptions {
  const db = buildDatabaseSettings(raw);
  return {
    type: 'mysql',
    connectorPackage: 'mysql2',
    driver: mysqlUtcDriver, // forces the session time zone to UTC on every connection
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    charset: 'utf8mb4',
    timezone: 'Z', // store and read every DATETIME as UTC
    supportBigNumbers: true,
    bigNumberStrings: true, // BIGINT (e.g. paise) is returned as a string to avoid precision loss
    ssl: db.ssl ? { rejectUnauthorized: true } : undefined,
    extra: { connectionLimit: db.poolSize },
    logging: db.logging ? ['error', 'warn', 'migration', 'query'] : ['error', 'warn', 'migration'],
    namingStrategy: new SnakeNamingStrategy(),
    entities,
    migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
  };
}
