import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { CATALOG_JOBS, QUEUES } from '../queues/queue.constants';
import { CatalogAdminService } from './catalog-admin.service';

/** Worker-side: flips SCHEDULED series/episodes to PUBLISHED when their time arrives. */
@Processor(QUEUES.Catalog)
export class CatalogProcessor extends WorkerHost {
  private readonly log = new Logger(CatalogProcessor.name);
  constructor(private readonly admin: CatalogAdminService) { super(); }

  async process(job: Job): Promise<unknown> {
    if (job.name !== CATALOG_JOBS.PublishDue) throw new Error(`Unknown catalog job: ${job.name}`);
    const r = await this.admin.publishDue();
    if (r.series || r.episodes) this.log.log(`Published scheduled content: ${r.series} series, ${r.episodes} episodes`);
    return r;
  }
}

/** Registers the every-minute schedule (idempotent: running several workers does not create duplicates). */
@Injectable()
export class CatalogScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.Catalog) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler('catalog-publish-due', { every: 60_000 }, { name: CATALOG_JOBS.PublishDue, data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } });
  }
}
