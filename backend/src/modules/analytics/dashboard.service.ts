import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { formatInr } from '../../common/money';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_SECONDS = 60;
const n = (v: unknown) => Number(v ?? 0);

/** All figures are computed from the system of record in SQL (UTC). Money is integer paise. Cached for a minute. */
@Injectable()
export class DashboardService {
  private readonly log = new Logger(DashboardService.name);
  constructor(@InjectDataSource() private readonly ds: DataSource, @Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async metrics(days: number) {
    const key = `dashboard:v1:${days}`;
    try { const hit = await this.redis.get(key); if (hit) return { ...JSON.parse(hit), cached: true }; } catch { /* cache is optional */ }
    const result = await this.compute(days);
    try { await this.redis.set(key, JSON.stringify(result), 'EX', CACHE_SECONDS); } catch (err) { this.log.warn({ err }, 'dashboard cache write failed'); }
    return { ...result, cached: false };
  }

  private async compute(days: number) {
    const since = new Date(Date.now() - days * 86400_000);
    const q = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => this.ds.query(sql, p) as Promise<T[]>;
    const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0] ?? {};

    const [users, newUsers, subs, revenue, newSubs, failed, playback, watch] = await Promise.all([
      one('SELECT COUNT(*) AS c FROM users'),
      one('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [since]),
      one('SELECT COUNT(DISTINCT user_id) AS c FROM entitlements WHERE revoked_at IS NULL AND starts_at <= NOW(3) AND ends_at > NOW(3)'),
      one("SELECT COALESCE(SUM(amount_paise), 0) AS gross, COALESCE(SUM(refunded_paise), 0) AS refunded, COUNT(*) AS payments FROM payments WHERE status IN ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED') AND captured_at >= ?", [since]),
      one("SELECT COUNT(*) AS c FROM subscriptions WHERE source = 'PURCHASE' AND created_at >= ?", [since]),
      one("SELECT COUNT(*) AS c FROM payments WHERE status = 'FAILED' AND created_at >= ?", [since]),
      one('SELECT COUNT(*) AS starts, COUNT(DISTINCT user_id) AS viewers FROM playback_sessions WHERE created_at >= ?', [since]),
      one('SELECT COALESCE(SUM(position_seconds), 0) AS seconds FROM watch_progress WHERE last_watched_at >= ?', [since]),
    ]);
    const top = await q("SELECT s.id AS id, s.title AS title, COUNT(*) AS starts, COUNT(DISTINCT ps.user_id) AS viewers FROM playback_sessions ps JOIN episodes e ON e.id = ps.episode_id JOIN series s ON s.id = e.series_id WHERE ps.created_at >= ? GROUP BY s.id, s.title ORDER BY starts DESC, s.id LIMIT 10", [since]);
    const [revDaily, userDaily, playDaily] = await Promise.all([
      q<{ d: Date | string; v: unknown }>("SELECT DATE(captured_at) AS d, SUM(amount_paise) AS v FROM payments WHERE status IN ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED') AND captured_at >= ? GROUP BY DATE(captured_at)", [since]),
      q<{ d: Date | string; v: unknown }>('SELECT DATE(created_at) AS d, COUNT(*) AS v FROM users WHERE created_at >= ? GROUP BY DATE(created_at)', [since]),
      q<{ d: Date | string; v: unknown }>('SELECT DATE(created_at) AS d, COUNT(*) AS v FROM playback_sessions WHERE created_at >= ? GROUP BY DATE(created_at)', [since]),
    ]);

    type Day = { d: Date | string; v: unknown };
    const fill = (rows: Day[]) => {
      const by = new Map(rows.map((r) => [new Date(r.d).toISOString().slice(0, 10), n(r.v)]));
      return Array.from({ length: days }, (_, i) => { const day = new Date(Date.now() - (days - 1 - i) * 86400_000).toISOString().slice(0, 10); return { date: day, value: by.get(day) ?? 0 }; });
    };
    const gross = n(revenue.gross), refunded = n(revenue.refunded);
    return {
      rangeDays: days, generatedAt: new Date().toISOString(),
      totals: {
        users: n(users.c), newUsers: n(newUsers.c), activeSubscribers: n(subs.c), newSubscriptions: n(newSubs.c), failedPayments: n(failed.c),
        revenue: { grossPaise: gross, refundedPaise: refunded, netPaise: gross - refunded, netDisplay: formatInr(gross - refunded), payments: n(revenue.payments) },
        playbackStarts: n(playback.starts), uniqueViewers: n(playback.viewers), watchHours: Math.round((n(watch.seconds) / 3600) * 10) / 10,
      },
      topSeries: top.map((t) => ({ id: String(t.id), title: String(t.title), playbackStarts: n(t.starts), uniqueViewers: n(t.viewers) })),
      daily: { revenuePaise: fill(revDaily), newUsers: fill(userDaily), playbackStarts: fill(playDaily) },
    };
  }
}
