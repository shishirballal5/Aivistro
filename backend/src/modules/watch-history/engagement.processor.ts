import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AnalyticsService } from '../analytics/analytics.service';
import { ENGAGEMENT_JOBS, QUEUES } from '../queues/queue.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { ProgressService } from './progress.service';

/** Worker side of engagement: batch-persist watch progress and apply analytics retention. */
@Processor(QUEUES.Engagement)
export class EngagementProcessor extends WorkerHost {
  private readonly log = new Logger(EngagementProcessor.name);
  constructor(private readonly progress: ProgressService, private readonly analytics: AnalyticsService, private readonly notifications: NotificationsService) { super(); }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case ENGAGEMENT_JOBS.FlushProgress: return this.progress.flush();
      case ENGAGEMENT_JOBS.PruneAnalytics: { const removed = await this.analytics.prune(); if (removed) this.log.log(`Pruned ${removed} old analytics events`); return { removed }; }
      case ENGAGEMENT_JOBS.DispatchNotifications: return { started: await this.notifications.dispatchDue() };
      case ENGAGEMENT_JOBS.SendCampaign: return this.notifications.deliver(String(job.data.campaignId));
      default: throw new Error(`Unknown engagement job: ${job.name}`);
    }
  }
}

@Injectable()
export class EngagementScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.Engagement) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    const opts = { removeOnComplete: 5, removeOnFail: 20 };
    await this.queue.upsertJobScheduler('progress-flush', { every: 30_000 }, { name: ENGAGEMENT_JOBS.FlushProgress, data: {}, opts });
    await this.queue.upsertJobScheduler('notifications-dispatch', { every: 60_000 }, { name: ENGAGEMENT_JOBS.DispatchNotifications, data: {}, opts });
    await this.queue.upsertJobScheduler('analytics-prune', { every: 24 * 3600_000 }, { name: ENGAGEMENT_JOBS.PruneAnalytics, data: {}, opts });
  }
}
