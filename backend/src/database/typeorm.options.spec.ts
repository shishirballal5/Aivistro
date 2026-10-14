import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { SystemSetting } from './entities/index';
import { buildTypeOrmOptions } from './typeorm.options';

describe('buildTypeOrmOptions', () => {
  const build = (env: Record<string, string> = {}) => buildTypeOrmOptions(env) as MysqlConnectionOptions;

  it('uses MySQL with utf8mb4 and UTC', () => {
    const o = build();
    expect(o.type).toBe('mysql');
    expect(o.charset).toBe('utf8mb4');
    expect(o.timezone).toBe('Z');
  });

  it('NEVER enables synchronize or auto-run migrations, in any environment or via any variable', () => {
    const cases: Record<string, string>[] = [
      {},
      { NODE_ENV: 'production', DB_PASSWORD: 'x', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none', PAYMENT_GATEWAY: 'none', PUSH_PROVIDER: 'none', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', CORS_ORIGINS: 'https://a.example' },
      { NODE_ENV: 'test' },
      { DB_SYNCHRONIZE: 'true', TYPEORM_SYNCHRONIZE: 'true', SYNCHRONIZE: 'true' },
    ];
    for (const env of cases) {
      const o = build(env);
      expect(o.synchronize).toBe(false);
      expect(o.migrationsRun).toBe(false);
      expect(o.dropSchema).toBe(false);
    }
  });

  it('forces the MySQL session time zone to UTC on every pooled connection', () => {
    const o = build() as MysqlConnectionOptions & { driver: { createPool: unknown } };
    expect(typeof o.driver.createPool).toBe('function');
    const { mysqlUtcDriver } = jest.requireActual('./mysql-utc-driver');
    const handlers: Record<string, (c: { query: jest.Mock }) => void> = {};
    const fake = { createPool: () => ({ on: (e: string, h: (c: { query: jest.Mock }) => void) => { handlers[e] = h; } }) };
    jest.spyOn(require('mysql2'), 'createPool').mockImplementation(fake.createPool as never);
    mysqlUtcDriver.createPool({});
    const conn = { query: jest.fn() };
    handlers.connection(conn);
    expect(conn.query).toHaveBeenCalledWith("SET time_zone = '+00:00'");
    jest.restoreAllMocks();
  });

  it('returns BIGINT as strings so money in paise never loses precision', () => {
    const o = build();
    expect(o.supportBigNumbers).toBe(true);
    expect(o.bigNumberStrings).toBe(true);
  });

  it('registers entities explicitly and reads connection settings from the environment', () => {
    const o = build({ DB_HOST: 'db.internal', DB_PORT: '3307', DB_USERNAME: 'u', DB_PASSWORD: 'p', DB_NAME: 'n', DB_POOL_SIZE: '25' });
    expect(o.entities).toContain(SystemSetting);
    expect([o.host, o.port, o.username, o.password, o.database]).toEqual(['db.internal', 3307, 'u', 'p', 'n']);
    expect(o.extra).toEqual({ connectionLimit: 25 });
  });

  it('enables TLS certificate verification when DB_SSL is on', () => {
    expect(build({ DB_SSL: 'true' }).ssl).toEqual({ rejectUnauthorized: true });
    expect(build().ssl).toBeUndefined();
  });
});
