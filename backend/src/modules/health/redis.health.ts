import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly indicators: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check(key);
    try {
      const reply = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis ping timed out')), 2000).unref()),
      ]);
      return reply === 'PONG' ? indicator.up() : indicator.down({ message: `Unexpected reply: ${reply}` });
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
