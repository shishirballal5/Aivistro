import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { appConfig, databaseConfig, redisConfig } from '../src/config/index';
import { DatabaseModule } from '../src/database/database.module';
import { SystemSetting } from '../src/database/entities/index';

describe('MySQL / TypeORM (real database)', () => {
  let ds: DataSource;
  const keys = ['e2e.roundtrip', 'e2e.dup', 'e2e.tx-ok', 'e2e.tx-fail'];
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, load: [appConfig, databaseConfig, redisConfig] }), DatabaseModule] }).compile();
    ds = m.get(DataSource);
  });
  beforeEach(async () => { await ds.getRepository(SystemSetting).delete(keys); });
  afterAll(async () => { await ds.getRepository(SystemSetting).delete(keys); await ds.destroy(); });

  it('has the migrations applied and nothing pending', async () => {
    const applied = await ds.query('SELECT name FROM typeorm_migrations ORDER BY id');
    expect(applied.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining([expect.stringMatching(/^InitialFoundation/)]));
    expect(await ds.showMigrations()).toBe(false); // false = no pending migrations
  });

  it('creates tables on InnoDB with utf8mb4', async () => {
    const [t] = await ds.query(
      `SELECT t.ENGINE AS engine, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t
       JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY c ON c.COLLATION_NAME = t.TABLE_COLLATION
       WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'system_settings'`,
    );
    expect(t).toEqual({ engine: 'InnoDB', charset: 'utf8mb4' });
  });

  it('round-trips JSON values, unicode and UTC timestamps', async () => {
    const repo = ds.getRepository(SystemSetting);
    await repo.save({ key: 'e2e.roundtrip', value: { freeTrialDays: 0, plans: ['₹149', 'कहानी 🎬'], on: true }, description: null });
    const row = await repo.findOneByOrFail({ key: 'e2e.roundtrip' });
    expect(row.value).toEqual({ freeTrialDays: 0, plans: ['₹149', 'कहानी 🎬'], on: true });
    const [{ tz }] = await ds.query('SELECT @@session.time_zone AS tz');
    expect(tz).toBe('+00:00');
    expect(Math.abs(Date.now() - row.createdAt.getTime())).toBeLessThan(60_000); // stored and read back as UTC, not shifted
  });

  it('enforces unique keys (surfaces ER_DUP_ENTRY)', async () => {
    const repo = ds.getRepository(SystemSetting);
    await repo.insert({ key: 'e2e.dup', value: 1 });
    await expect(repo.insert({ key: 'e2e.dup', value: 2 })).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
  });

  describe('transactions (the basis for payment + subscription activation)', () => {
    it('commits all writes together', async () => {
      await ds.transaction(async (em) => {
        await em.insert(SystemSetting, { key: 'e2e.tx-ok', value: 'a' });
        await em.update(SystemSetting, { key: 'e2e.tx-ok' }, { value: 'b' });
      });
      expect((await ds.getRepository(SystemSetting).findOneByOrFail({ key: 'e2e.tx-ok' })).value).toBe('b');
    });

    it('rolls back every write when a later step fails', async () => {
      await expect(
        ds.transaction(async (em) => {
          await em.insert(SystemSetting, { key: 'e2e.tx-fail', value: 'partial' });
          throw new Error('payment verification failed');
        }),
      ).rejects.toThrow('payment verification failed');
      expect(await ds.getRepository(SystemSetting).findOneBy({ key: 'e2e.tx-fail' })).toBeNull();
    });
  });

  it('returns BIGINT exactly (as a string), so money in paise cannot lose precision', async () => {
    const [{ big }] = await ds.query("SELECT CAST('9007199254740993' AS UNSIGNED) AS big"); // 2^53 + 1: not representable as a JS number
    expect(big).toBe('9007199254740993');
  });
});
