import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerModule } from './common/logging/logger.module';
import { appConfig, authConfig, databaseConfig, mediaConfig, paymentsConfig, pushConfig, redisConfig, assertValidEnv } from './config/index';
import { DatabaseModule } from './database/database.module';
import { CatalogCoreModule } from './modules/catalog/catalog-core.module';
import { CatalogProcessor, CatalogScheduler } from './modules/catalog/catalog.processor';
import { AuditModule } from './modules/audit-logs/audit.module';
import { PaymentsCoreModule } from './modules/payments/payments-core.module';
import { PaymentsProcessor, PaymentsScheduler } from './modules/payments/payments.processor';
import { StorageModule } from './modules/storage/storage.module';
import { VideoAssetsCoreModule } from './modules/video-assets/video-assets-core.module';
import { VideoProcessor, VideoScheduler } from './modules/video-assets/video.processor';
import { CryptoModule } from './common/crypto/key.service';
import { EngagementCoreModule } from './modules/watch-history/engagement-core.module';
import { EngagementProcessor, EngagementScheduler } from './modules/watch-history/engagement.processor';
import { NotificationsCoreModule } from './modules/notifications/notifications-core.module';
import { RedisModule } from './modules/redis/redis.module';
import { QueueModule } from './modules/queues/queue.module';
import { SystemProcessor } from './modules/queues/system.processor';

/** The background-worker process: same shared modules as the API, plus the queue processors. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [appConfig, databaseConfig, redisConfig, authConfig, paymentsConfig, mediaConfig, pushConfig], validate: assertValidEnv, envFilePath: ['.env'] }),
    AppLoggerModule,
    DatabaseModule,
    QueueModule,
    AuditModule,
    CatalogCoreModule,
    PaymentsCoreModule,
    CryptoModule,
    StorageModule,
    VideoAssetsCoreModule,
    RedisModule,
    EngagementCoreModule,
    NotificationsCoreModule,
  ],
  providers: [SystemProcessor, CatalogProcessor, CatalogScheduler, PaymentsProcessor, PaymentsScheduler, VideoProcessor, VideoScheduler, EngagementProcessor, EngagementScheduler],
})
export class WorkerModule {}
