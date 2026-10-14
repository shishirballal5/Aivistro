/**
 * Queue contracts shared by the API (producers) and the worker (consumers).
 * Keep names and payload types here so both sides stay in sync.
 */
export const QUEUES = {
  /** Operational queue: used to prove the worker is alive and wired to Redis. */
  System: 'system',
  /** Scheduled catalog maintenance (publishing content whose time has come). */
  Catalog: 'catalog',
  /** Payment safety nets: reconciliation, webhook retries, subscription bookkeeping. */
  Payments: 'payments',
  /** CPU-heavy FFmpeg work. Scale by running more worker processes. */
  VideoProcessing: 'video-processing',
  /** Engagement housekeeping: progress flushing, notification dispatch, analytics retention. */
  Engagement: 'engagement',
  // Phase 4 adds: VideoProcessing: 'video-processing'
} as const;

export const SYSTEM_JOBS = {
  Ping: 'system.ping',
} as const;

export const PAYMENT_JOBS = { Reconcile: 'payments.reconcile', RetryWebhooks: 'payments.retry-webhooks', ExpireSubscriptions: 'subscriptions.expire' } as const;
export const ENGAGEMENT_JOBS = { FlushProgress: 'progress.flush', DispatchNotifications: 'notifications.dispatch-due', SendCampaign: 'notifications.send-campaign', PruneAnalytics: 'analytics.prune' } as const;
export const VIDEO_JOBS = { Process: 'video.process', CleanupAbandoned: 'video.cleanup-abandoned' } as const;
export interface VideoProcessPayload { assetId: string }
export const CATALOG_JOBS = { PublishDue: 'catalog.publish-due' } as const;

export interface SystemPingPayload {
  requestedAt: string;
}
export interface SystemPingResult {
  pong: true;
  requestedAt: string;
  processedAt: string;
  workerPid: number;
}

/** Retries with exponential backoff; failed jobs are kept for 7 days for inspection and manual retry. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
