import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConfig } from '../../config/redis.config';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Closes the shared client on graceful shutdown. */
@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.client.status !== 'end') await this.client.quit().catch(() => this.client.disconnect());
  }
}

/**
 * A general-purpose Redis client (health checks now; caching and OTP/rate-limit state later).
 * BullMQ manages its own connections, so this client uses fail-fast settings.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (cfg: ConfigType<typeof redisConfig>) => {
        const client = new Redis({ ...cfg, maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 5000 });
        client.on('error', () => undefined); // surfaced through the readiness probe instead of crashing the process
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
