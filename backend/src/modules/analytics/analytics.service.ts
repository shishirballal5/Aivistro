import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AnalyticsEvent } from '../../database/entities/index';

export type EventProps = Record<string, string | number | boolean>;
export interface TrackInput { userId?: string | null; type: string; entityType?: string; entityId?: string | number; properties?: EventProps; at?: Date }

/** Events the CLIENT may report. Server-side events (payments, playback, ...) are recorded by the backend itself and cannot be forged. */
export const CLIENT_EVENT_TYPES = ['app_open', 'screen_view', 'search', 'episode_impression', 'share', 'banner_click'] as const;

/** Keeps only flat, short, primitive properties. Analytics must never become a way to smuggle in secrets or huge payloads. */
export function cleanProperties(input: unknown): EventProps | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: EventProps = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 10)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 100);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);
  constructor(@InjectRepository(AnalyticsEvent) private readonly repo: Repository<AnalyticsEvent>) {}

  /** Fire-and-forget by design: a failure to record analytics must never affect the request that caused it. */
  track(e: TrackInput): void {
    void this.repo.insert({ userId: e.userId ?? null, eventType: e.type.slice(0, 60), entityType: e.entityType?.slice(0, 40) ?? null, entityId: e.entityId !== undefined ? String(e.entityId).slice(0, 64) : null, properties: cleanProperties(e.properties) as never, occurredAt: e.at ?? new Date() })
      .catch((err) => this.log.warn({ err, type: e.type }, 'analytics insert failed'));
  }

  /** Awaited variant for batch ingestion and tests. */
  async trackMany(events: TrackInput[]): Promise<void> {
    if (!events.length) return;
    await this.repo.insert(events.map((e) => ({ userId: e.userId ?? null, eventType: e.type.slice(0, 60), entityType: e.entityType?.slice(0, 40) ?? null, entityId: e.entityId !== undefined ? String(e.entityId).slice(0, 64) : null, properties: cleanProperties(e.properties) as never, occurredAt: e.at ?? new Date() })));
  }

  /** Retention: raw events older than ~13 months are dropped (aggregates live in the dashboard queries, not here). */
  async prune(olderThanDays = 400): Promise<number> {
    return (await this.repo.delete({ occurredAt: LessThan(new Date(Date.now() - olderThanDays * 86400_000)) })).affected ?? 0;
  }
}
