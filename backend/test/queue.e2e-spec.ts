import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue, QueueEvents } from 'bullmq';
import { appConfig, databaseConfig, redisConfig } from '../src/config/index';
import { QUEUES, SystemPingResult } from '../src/modules/queues/queue.constants';
import { QueueModule } from '../src/modules/queues/queue.module';
import { SystemProcessor } from '../src/modules/queues/system.processor';
import { SystemQueueService } from '../src/modules/queues/system-queue.service';

describe('BullMQ queue (real Redis)', () => {
  let moduleRef: TestingModule;
  let queue: Queue;
  let events: QueueEvents;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [appConfig, databaseConfig, redisConfig] }), QueueModule],
      providers: [SystemProcessor], // the worker's processor, hosted in-process for the test
    }).compile();
    await moduleRef.init();
    queue = moduleRef.get(getQueueToken(QUEUES.System));
    await queue.obliterate({ force: true });
    events = new QueueEvents(QUEUES.System, { connection: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6379), password: process.env.REDIS_PASSWORD || undefined, db: Number(process.env.REDIS_DB ?? 0) } });
    await events.waitUntilReady();
  });
  afterAll(async () => { await events.close(); await queue.obliterate({ force: true }); await moduleRef.close(); });

  it('a producer job is processed by the worker and its result is returned', async () => {
    const job = await moduleRef.get(SystemQueueService).enqueuePing();
    const result = (await job.waitUntilFinished(events, 10_000)) as SystemPingResult;
    expect(result).toMatchObject({ pong: true, requestedAt: job.data.requestedAt, workerPid: process.pid });
  });

  it('a failing job is retried, then kept in the failed set for inspection and manual retry', async () => {
    const job = await queue.add('system.unknown', { requestedAt: new Date().toISOString() }, { attempts: 2, backoff: { type: 'fixed', delay: 50 } });
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(/Unknown system job/);
    const failed = await queue.getFailed();
    const stored = failed.find((j) => j.id === job.id);
    expect(stored?.attemptsMade).toBe(2); // retried once before being parked
    expect(stored?.failedReason).toMatch(/Unknown system job/);
  });
});
