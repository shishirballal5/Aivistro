import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ActorType, AuditLog } from '../../database/entities/index';

const SENSITIVE = /pass(word)?|secret|token|otp|code|authorization|cookie|signature|private|credential|apikey|api_key|mfa|recovery|hash|key$/i;

/** Deep-redacts anything that looks like a credential so audit rows can never leak secrets. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : sanitize(v, depth + 1)]));
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /** Never throws: a failure to write the audit row must not break (or be used to break) the action itself. */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    try {
      const repo = manager ? manager.getRepository(AuditLog) : this.repo;
      await repo.insert({
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId != null ? String(entry.entityId) : null,
        metadata: (entry.metadata ? sanitize(entry.metadata) : null) as never,
        ipAddress: entry.ip ?? null,
        requestId: entry.requestId ?? null,
      });
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}
