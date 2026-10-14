import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PAYMENT_JOBS, QUEUES } from '../queues/queue.constants';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentsService } from './payments.service';

/**
 * Worker-side safety nets. A webhook can be lost and a customer can close the tab right after paying: these jobs make sure
 * a paid order still ends up activated, and that webhook events which failed on our side are retried.
 */
@Processor(QUEUES.Payments)
export class PaymentsProcessor extends WorkerHost {
  private readonly log = new Logger(PaymentsProcessor.name);
  constructor(private readonly payments: PaymentsService, private readonly subs: SubscriptionsService) { super(); }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case PAYMENT_JOBS.Reconcile: {
        const r = await this.payments.reconcilePending();
        if (r.activated || r.errors) this.log.log(`Reconciliation: ${JSON.stringify(r)}`);
        return r;
      }
      case PAYMENT_JOBS.RetryWebhooks: return this.payments.retryFailedEvents();
      case PAYMENT_JOBS.ExpireSubscriptions: return { expired: await this.subs.expireDue() };
      default: throw new Error(`Unknown payments job: ${job.name}`);
    }
  }
}

@Injectable()
export class PaymentsScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.Payments) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    const opts = { removeOnComplete: 10, removeOnFail: 50 };
    await this.queue.upsertJobScheduler('payments-reconcile', { every: 5 * 60_000 }, { name: PAYMENT_JOBS.Reconcile, data: {}, opts });
    await this.queue.upsertJobScheduler('payments-retry-webhooks', { every: 5 * 60_000 }, { name: PAYMENT_JOBS.RetryWebhooks, data: {}, opts });
    await this.queue.upsertJobScheduler('subscriptions-expire', { every: 60 * 60_000 }, { name: PAYMENT_JOBS.ExpireSubscriptions, data: {}, opts });
  }
}
