import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUES, SYSTEM_JOBS, SystemPingPayload, SystemPingResult } from './queue.constants';

@Injectable()
export class SystemQueueService {
  constructor(@InjectQueue(QUEUES.System) private readonly queue: Queue<SystemPingPayload, SystemPingResult>) {}

  enqueuePing(): Promise<Job<SystemPingPayload, SystemPingResult>> {
    return this.queue.add(SYSTEM_JOBS.Ping, { requestedAt: new Date().toISOString() });
  }
}
