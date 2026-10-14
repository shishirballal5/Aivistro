import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUES, VIDEO_JOBS, VideoProcessPayload } from '../queues/queue.constants';
import { VideoAssetsService } from './video-assets.service';
import { PermanentVideoError, VideoProcessingService } from './video-processing.service';

/**
 * Worker side. Failure policy:
 *  - a problem with the video itself (bad container, too long, no video stream) fails immediately, no retries;
 *  - an infrastructure problem (storage hiccup, FFmpeg crash) is retried 3 times with exponential backoff;
 *  - when the last attempt fails the asset is marked FAILED with a reason, and the BullMQ job is KEPT for 7 days (the dead-letter
 *    record) so an operator can inspect it and re-run it with "reprocess".
 */
@Processor(QUEUES.VideoProcessing, { concurrency: 1 })
export class VideoProcessor extends WorkerHost {
  private readonly log = new Logger(VideoProcessor.name);
  constructor(private readonly processing: VideoProcessingService, private readonly assets: VideoAssetsService) { super(); }

  async process(job: Job<VideoProcessPayload>): Promise<unknown> {
    if (job.name === VIDEO_JOBS.CleanupAbandoned) return { removed: await this.assets.cleanupAbandoned() };
    if (job.name !== VIDEO_JOBS.Process) throw new Error(`Unknown video job: ${job.name}`);
    return this.processing.process(job.data.assetId);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<VideoProcessPayload> | undefined, err: Error): Promise<void> {
    if (!job || job.name !== VIDEO_JOBS.Process) return;
    const exhausted = err instanceof PermanentVideoError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.log.warn({ assetId: job.data.assetId, attempt: job.attemptsMade, exhausted, err: err.message }, 'Video processing attempt failed');
    if (exhausted) await this.processing.markFailed(job.data.assetId, err.message);
  }
}

@Injectable()
export class VideoScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.VideoProcessing) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler('video-cleanup-abandoned', { every: 3600_000 }, { name: VIDEO_JOBS.CleanupAbandoned, data: {}, opts: { removeOnComplete: 5, removeOnFail: 20 } });
  }
}
