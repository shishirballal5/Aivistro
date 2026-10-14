import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES, SYSTEM_JOBS, SystemPingPayload, SystemPingResult } from './queue.constants';

/** Runs in the worker process only. */
@Processor(QUEUES.System)
export class SystemProcessor extends WorkerHost {
  async process(job: Job<SystemPingPayload, SystemPingResult>): Promise<SystemPingResult> {
    if (job.name !== SYSTEM_JOBS.Ping) throw new Error(`Unknown system job: ${job.name}`);
    return { pong: true, requestedAt: job.data.requestedAt, processedAt: new Date().toISOString(), workerPid: process.pid };
  }
}
