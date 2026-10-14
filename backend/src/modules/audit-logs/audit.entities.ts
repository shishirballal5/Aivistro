import { Column, CreateDateColumn, Entity, Index } from 'typeorm';
import { PkId } from '../../database/entities/columns';
import { User } from '../users/user.entities';

export enum ActorType { Admin = 'ADMIN', User = 'USER', System = 'SYSTEM' }

/**
 * Append-only history of sensitive actions. Deliberately has NO foreign keys: audit rows must survive
 * the deletion or anonymisation of whatever they refer to, and are never updated or cascaded.
 */
@Entity('audit_logs')
@Index('idx_audit_entity', ['entityType', 'entityId'])
@Index('idx_audit_actor', ['actorType', 'actorId'])
@Index('idx_audit_created', ['createdAt'])
export class AuditLog {
  @PkId() id: string;
  @Column({ name: 'actor_type', type: 'enum', enum: ActorType }) actorType: ActorType;
  @Column({ name: 'actor_id', type: 'bigint', unsigned: true, nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', length: 100 }) action: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 60, nullable: true }) entityType: string | null;
  @Column({ name: 'entity_id', type: 'varchar', length: 64, nullable: true }) entityId: string | null;
  /** Sanitised: passwords, tokens, OTPs, secrets and keys are redacted before storage. */
  @Column({ type: 'json', nullable: true }) metadata: Record<string, unknown> | null;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true }) ipAddress: string | null;
  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true }) requestId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}
