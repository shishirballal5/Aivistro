import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppLoggerModule } from './common/logging/logger.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { appConfig, authConfig, databaseConfig, mediaConfig, paymentsConfig, pushConfig, redisConfig, assertValidEnv } from './config/index';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit-logs/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { AccountDataModule } from './modules/account-data/account-data.module';
import { AuthCoreModule } from './modules/auth/auth-core.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { EngagementModule } from './modules/watch-history/engagement.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { PlaybackModule } from './modules/playback/playback.module';
import { StorageModule } from './modules/storage/storage.module';
import { MediaImagesModule } from './modules/media-images/media-images.module';
import { VideoAssetsModule } from './modules/video-assets/video-assets.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CryptoModule } from './common/crypto/key.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './modules/redis/redis.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { HealthModule } from './modules/health/health.module';
import { PublicConfigModule } from './modules/public-config/public-config.module';
import { QueueModule } from './modules/queues/queue.module';
import { RedisModule } from './modules/redis/redis.module';

/** The HTTP API process. Feature modules (auth, catalog, ...) are added here in later phases. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, databaseConfig, redisConfig, authConfig, paymentsConfig, mediaConfig, pushConfig],
      validate: assertValidEnv,
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'test', // tests use real env vars / .env.test only, never a developer's personal .env
    }),
    AppLoggerModule,
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY, REDIS_CLIENT],
      useFactory: (app: ConfigType<typeof appConfig>, redis: Redis) => ({ throttlers: [{ ttl: app.throttle.ttlMs, limit: app.throttle.limit }], storage: new RedisThrottlerStorage(redis) }),
    }),
    CryptoModule,
    QueueModule,
    AuditModule,
    AuthCoreModule,
    AdminModule,
    AccountDataModule,
    CatalogModule,
    StorageModule,
    EntitlementsModule,
    PaymentsModule,
    VideoAssetsModule,
    MediaImagesModule,
    PlaybackModule,
    EngagementModule,
    NotificationsModule,
    AnalyticsModule,
    MonitoringModule,
    HealthModule,
    PublicConfigModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
