import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../modules/redis/redis.module';

interface Record { totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number }

/**
 * Rate-limit counters in Redis, shared by every API instance (the in-memory default is per process, so N instances
 * would allow N times the limit). Atomic: INCR + set expiry on first hit. If Redis is unreachable we fail OPEN
 * (allow the request) rather than turning a Redis outage into a full API outage; the readiness probe reports the outage.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<Record> {
    const k = `throttle:${throttlerName}:${key}`;
    const blockKey = `${k}:blocked`;
    try {
      const blockedMs = await this.redis.pttl(blockKey);
      if (blockedMs > 0) return { totalHits: limit + 1, timeToExpire: Math.ceil(blockedMs / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockedMs / 1000) };
      const [hits, pttl] = (await this.redis.multi().incr(k).pttl(k).exec())!.map((r) => r[1]) as [number, number];
      let ttlMs = pttl;
      if (hits === 1 || pttl < 0) { await this.redis.pexpire(k, ttl); ttlMs = ttl; }
      if (hits > limit && blockDuration > 0) await this.redis.set(blockKey, '1', 'PX', blockDuration);
      const over = hits > limit;
      return { totalHits: hits, timeToExpire: Math.ceil(ttlMs / 1000), isBlocked: over, timeToBlockExpire: over ? Math.ceil((blockDuration || ttlMs) / 1000) : 0 };
    } catch {
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
