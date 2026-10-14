import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';
import { Dt, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';

export enum AdminStatus { Active = 'ACTIVE', Disabled = 'DISABLED' }

@Entity('permissions')
@Index('uq_permissions_code', ['code'], { unique: true })
export class Permission extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 60 }) code: string;
  @Column({ type: 'varchar', length: 255 }) description: string;
}

@Entity('roles')
@Index('uq_roles_name', ['name'], { unique: true })
export class Role extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 60 }) name: string;
  @Column({ type: 'varchar', length: 255 }) description: string;
  /** System roles cannot be deleted or renamed. */
  @Column({ name: 'is_system', type: 'boolean', default: false }) isSystem: boolean;
  @ManyToMany(() => Permission)
  @JoinTable({ name: 'role_permissions', joinColumn: { name: 'role_id', referencedColumnName: 'id' }, inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' } })
  permissions: Permission[];
}

@Entity('admin_users')
@Index('uq_admin_users_email', ['email'], { unique: true })
export class AdminUser extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 254 }) email: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ name: 'password_hash', type: 'varchar', length: 255 }) passwordHash: string;
  @Column({ type: 'enum', enum: AdminStatus, default: AdminStatus.Active }) status: AdminStatus;
  @Column({ name: 'failed_login_count', type: 'int', unsigned: true, default: 0 }) failedLoginCount: number;
  @Dt('locked_until', { nullable: true }) lockedUntil: Date | null;
  @Dt('last_login_at', { nullable: true }) lastLoginAt: Date | null;
  /** AES-256-GCM encrypted TOTP secret (active). */
  @Column({ name: 'mfa_secret_enc', type: 'varchar', length: 255, nullable: true }) mfaSecretEnc: string | null;
  /** Secret generated during enrollment, promoted to mfa_secret_enc once the first code is confirmed. */
  @Column({ name: 'mfa_pending_secret_enc', type: 'varchar', length: 255, nullable: true }) mfaPendingSecretEnc: string | null;
  @Dt('mfa_enabled_at', { nullable: true }) mfaEnabledAt: Date | null;
  /** Last accepted TOTP time-step; a code is rejected unless its step is newer (replay protection). */
  @Column({ name: 'mfa_last_used_step', type: 'bigint', unsigned: true, nullable: true }) mfaLastUsedStep: string | null;
  /** SHA-256 hashes of unused single-use recovery codes. */
  @Column({ name: 'mfa_recovery_hashes', type: 'json', nullable: true }) mfaRecoveryHashes: string[] | null;
  @ManyToMany(() => Role)
  @JoinTable({ name: 'admin_user_roles', joinColumn: { name: 'admin_user_id', referencedColumnName: 'id' }, inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' } })
  roles: Role[];
}
