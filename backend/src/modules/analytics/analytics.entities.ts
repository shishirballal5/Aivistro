import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PkId } from '../../database/entities/columns';

/** Append-only. No foreign keys on purpose: analytics must never block, or be blocked by, anything else. */
@Entity('analytics_events')
@Index('idx_events_type_time', ['eventType', 'occurredAt'])
@Index('idx_events_user_time', ['userId', 'occurredAt'])
@Index('idx_events_time', ['occurredAt'])
export class AnalyticsEvent {
  @PkId() id: string;
  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true }) userId: string | null;
  @Column({ name: 'event_type', type: 'varchar', length: 60 }) eventType: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 40, nullable: true }) entityType: string | null;
  @Column({ name: 'entity_id', type: 'varchar', length: 64, nullable: true }) entityId: string | null;
  @Column({ type: 'json', nullable: true }) properties: Record<string, string | number | boolean> | null;
  @Column({ name: 'occurred_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) occurredAt: Date;
}
