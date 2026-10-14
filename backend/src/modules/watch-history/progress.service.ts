import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { badRequest, DomainException } from '../../common/errors';
import { Episode, PlaybackSession, VideoAsset, WatchProgress } from '../../database/entities/index';
import { AnalyticsService } from '../analytics/analytics.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const PENDING = 'progress:pending';
const FLUSHING = 'progress:flushing';
const THROTTLE_SECONDS = 5;

/** Completion is decided here from the SERVER-known duration: the last 8 seconds or the last 8% counts as finished. */
export const isCompleted = (positionSeconds: number, durationSeconds: number): boolean => durationSeconds > 0 && positionSeconds >= Math.max(durationSeconds - 8, Math.floor(durationSeconds * 0.92));

interface Pending { u: string; e: string; s: string; p: number; d: number; t: number }

/**
 * Watch progress without hammering the database. A player reports its position every few seconds; writing each one to MySQL
 * would be thousands of writes per minute. Instead updates land in a Redis hash (latest value wins per user+episode) and a worker
 * job upserts them in one batch every ~30 seconds. Reads flush the caller's own pending entries first, so users always see
 * their latest position.
 *
 * Nothing the client reports is trusted for anything but the position itself: the duration comes from the processed video,
 * completion is computed here, and a position can only be reported while the user holds a live playback session for that episode.
 */
@Injectable()
export class ProgressService {
  private readonly log = new Logger(ProgressService.name);
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(PlaybackSession) private readonly sessions: Repository<PlaybackSession>,
    @InjectRepository(VideoAsset) private readonly assets: Repository<VideoAsset>,
    @InjectRepository(Episode) private readonly episodes: Repository<Episode>,
    @InjectRepository(WatchProgress) private readonly progress: Repository<WatchProgress>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Client-facing: validated against a live playback session. Throttled to one accepted write per 5s per episode. */
  async record(userId: string, episodeId: string, positionSeconds: number): Promise<{ accepted: boolean; throttled: boolean }> {
    const session = await this.sessions.findOne({ where: { userId, episodeId, endedAt: IsNull(), revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }, order: { id: 'DESC' } });
    if (!session) throw new DomainException(HttpStatus.CONFLICT, 'PLAYBACK_REQUIRED', 'Progress can only be saved while the episode is playing. Start playback first.');
    const asset = await this.assets.findOneOrFail({ where: { id: session.assetId } });
    const episode = await this.episodes.findOneOrFail({ where: { id: episodeId } });
    return this.enqueue(userId, episodeId, episode.seriesId, positionSeconds, asset.durationSeconds ?? 0);
  }

  /** Internal (the session was already validated by the caller, e.g. a heartbeat). */
  async enqueue(userId: string, episodeId: string, seriesId: string, positionSeconds: number, durationSeconds: number): Promise<{ accepted: boolean; throttled: boolean }> {
    if (!Number.isInteger(positionSeconds) || positionSeconds < 0) throw badRequest('INVALID_POSITION', 'Position must be a non-negative whole number of seconds');
    if (durationSeconds > 0 && positionSeconds > durationSeconds + 5) throw badRequest('INVALID_POSITION', 'Position is beyond the end of the episode');
    const position = durationSeconds > 0 ? Math.min(positionSeconds, durationSeconds) : positionSeconds;
    try {
      const first = await this.redis.set(`progress:rl:${userId}:${episodeId}`, '1', 'EX', THROTTLE_SECONDS, 'NX');
      if (first === null) return { accepted: false, throttled: true };
      const p: Pending = { u: userId, e: episodeId, s: seriesId, p: position, d: durationSeconds, t: Date.now() };
      await this.redis.hset(PENDING, `${userId}:${episodeId}`, JSON.stringify(p));
      return { accepted: true, throttled: false };
    } catch (err) {
      // Redis down: write straight through so progress is not lost, at the cost of one DB write.
      this.log.warn({ err }, 'Redis unavailable for progress; writing directly');
      await this.persist([{ u: userId, e: episodeId, s: seriesId, p: position, d: durationSeconds, t: Date.now() }]);
      return { accepted: true, throttled: false };
    }
  }

  /** Worker job: move everything pending into MySQL. Crash-safe: a half-processed batch is finished before a new one starts. */
  async flush(): Promise<{ written: number }> {
    if (!(await this.redis.exists(FLUSHING))) {
      try { await this.redis.rename(PENDING, FLUSHING); } catch { return { written: 0 }; } // nothing pending
    }
    const all = await this.redis.hgetall(FLUSHING);
    const entries = Object.values(all).map((v) => JSON.parse(v) as Pending);
    await this.persist(entries);
    await this.redis.del(FLUSHING);
    return { written: entries.length };
  }

  /** Read-your-writes: persist just this user's pending entries before answering a read. */
  async flushUser(userId: string): Promise<void> {
    try {
      const stream = this.redis.hscanStream(PENDING, { match: `${userId}:*`, count: 100 });
      const entries: Pending[] = [];
      for await (const chunk of stream as AsyncIterable<string[]>) {
        for (let i = 0; i < chunk.length; i += 2) { entries.push(JSON.parse(chunk[i + 1])); await this.redis.hdel(PENDING, chunk[i]); }
      }
      if (entries.length) await this.persist(entries);
    } catch (err) { this.log.warn({ err }, 'flushUser failed'); }
  }

  /** Idempotent batch upsert. Older data never overwrites newer, and "completed" is sticky. */
  async persist(entriesIn: Pending[]): Promise<void> {
    const latest = new Map<string, Pending>();
    for (const e of entriesIn) { const k = `${e.u}:${e.e}`; if (!latest.has(k) || latest.get(k)!.t < e.t) latest.set(k, e); }
    const entries = [...latest.values()];
    if (!entries.length) return;

    const params: Record<string, string> = {};
    entries.forEach((e, i) => { params[`u${i}`] = e.u; params[`e${i}`] = e.e; });
    const before = await this.progress.createQueryBuilder('p').where(entries.map((_, i) => `(p.user_id = :u${i} AND p.episode_id = :e${i})`).join(' OR '), params).getMany();
    const wasDone = new Set(before.filter((b) => b.completed).map((b) => `${b.userId}:${b.episodeId}`));
    const numbers = new Map((await this.episodes.createQueryBuilder('e').select(['e.id', 'e.number']).where('e.id IN (:...ids)', { ids: entries.map((e) => e.e) }).getMany()).map((e) => [e.id, e.number]));

    await this.ds.transaction(async (em) => {
      for (const e of entries) {
        const done = isCompleted(e.p, e.d);
        const at = new Date(e.t);
        await em.query(
          `INSERT INTO watch_progress (user_id, episode_id, series_id, position_seconds, duration_seconds, completed, last_watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             position_seconds = IF(VALUES(last_watched_at) >= last_watched_at, VALUES(position_seconds), position_seconds),
             duration_seconds = VALUES(duration_seconds),
             completed = completed OR VALUES(completed),
             last_watched_at = GREATEST(last_watched_at, VALUES(last_watched_at))`,
          [e.u, e.e, e.s, e.p, e.d, done ? 1 : 0, at],
        );
        await em.query(
          `INSERT INTO watch_history (user_id, series_id, last_episode_id, last_episode_number, last_position_seconds, last_completed, episodes_completed, last_watched_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON DUPLICATE KEY UPDATE
             last_episode_id = IF(VALUES(last_watched_at) >= last_watched_at, VALUES(last_episode_id), last_episode_id),
             last_episode_number = IF(VALUES(last_watched_at) >= last_watched_at, VALUES(last_episode_number), last_episode_number),
             last_position_seconds = IF(VALUES(last_watched_at) >= last_watched_at, VALUES(last_position_seconds), last_position_seconds),
             last_completed = IF(VALUES(last_watched_at) >= last_watched_at, VALUES(last_completed), last_completed),
             last_watched_at = GREATEST(last_watched_at, VALUES(last_watched_at))`,
          [e.u, e.s, e.e, numbers.get(e.e) ?? 0, e.p, done ? 1 : 0, at],
        );
        await em.query(`UPDATE watch_history h SET episodes_completed = (SELECT COUNT(*) FROM watch_progress p WHERE p.user_id = h.user_id AND p.series_id = h.series_id AND p.completed = 1) WHERE h.user_id = ? AND h.series_id = ?`, [e.u, e.s]);
      }
    });
    for (const e of entries) if (isCompleted(e.p, e.d) && !wasDone.has(`${e.u}:${e.e}`)) this.analytics.track({ userId: e.u, type: 'episode_completed', entityType: 'episode', entityId: e.e, properties: { series_id: e.s } });
  }
}
