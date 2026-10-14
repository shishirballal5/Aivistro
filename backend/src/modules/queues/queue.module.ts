import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { redisConfig } from '../../config/redis.config';
import { DEFAULT_JOB_OPTIONS, QUEUES } from './queue.constants';
import { SystemQueueService } from './system-queue.service';

/** Shared by the API (producers) and the worker (which adds the processors). */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (cfg: ConfigType<typeof redisConfig>) => ({
        connection: { host: cfg.host, port: cfg.port, password: cfg.password, db: cfg.db, tls: cfg.tls },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.System }, { name: QUEUES.Catalog }, { name: QUEUES.Payments }, { name: QUEUES.VideoProcessing }, { name: QUEUES.Engagement }),
  ],
  providers: [SystemQueueService],
  exports: [BullModule, SystemQueueService],
})
export class QueueModule {}
