import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';

export enum UserStatus { Active = 'ACTIVE', Suspended = 'SUSPENDED', Deleted = 'DELETED' }

export enum IdentityProvider { Google = 'google', Apple = 'apple' }

/** A viewer account. Accounts are never hard-deleted (status DELETED) so payments and history stay intact. */
@Entity('users')
@Index('uq_users_phone', ['phone'], { unique: true })
@Index('uq_users_email', ['email'], { unique: true })
@Index('idx_users_status', ['status'])
export class User extends TimestampedEntity {
  @PkId() id: string;
  /** E.164, e.g. +919876543210. Set only after OTP verification. */
  @Column({ type: 'varchar', length: 20, nullable: true }) phone: string | null;
  @Dt('phone_verified_at', { nullable: true }) phoneVerifiedAt: Date | null;
  /** Lower-cased. */
  @Column({ type: 'varchar', length: 254, nullable: true }) email: string | null;
  @Dt('email_verified_at', { nullable: true }) emailVerifiedAt: Date | null;
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true }) passwordHash: string | null;
  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Active }) status: UserStatus;
  @Column({ name: 'failed_login_count', type: 'int', unsigned: true, default: 0 }) failedLoginCount: number;
  @Dt('locked_until', { nullable: true }) lockedUntil: Date | null;
  @Dt('last_login_at', { nullable: true }) lastLoginAt: Date | null;
  /** Why an admin suspended the account (shown to admins only). Cleared on restore. */
  @Column({ name: 'suspended_reason', type: 'varchar', length: 255, nullable: true }) suspendedReason: string | null;
  @Dt('suspended_at', { nullable: true }) suspendedAt: Date | null;
  /** Set when the viewer deleted their own account: phone/email/password are nulled, the row stays so payments keep a valid owner. */
  @Dt('deleted_at', { nullable: true }) deletedAt: Date | null;
}

@Entity('profiles')
@Index('uq_profiles_user', ['userId'], { unique: true })
export class Profile extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @OneToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @Column({ name: 'display_name', type: 'varchar', length: 100 }) displayName: string;
  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true }) avatarUrl: string | null;
  /** YYYY-MM-DD. Null only for accounts created before the age rule existed. */
  @Column({ name: 'date_of_birth', type: 'date', nullable: true }) dateOfBirth: string | null;
  @Column({ type: 'varchar', length: 10, default: 'hi' }) language: string;
  @Column({ name: 'notification_preferences', type: 'json' }) notificationPreferences: { marketing: boolean; newEpisodes: boolean; billing: boolean };
}

/** Link between a user and a social login. Matched on (provider, subject), never on email alone. */
@Entity('user_identities')
@Index('uq_identity_provider_subject', ['provider', 'subject'], { unique: true })
@Index('idx_identity_user', ['userId'])
export class UserIdentity extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @Column({ type: 'enum', enum: IdentityProvider }) provider: IdentityProvider;
  @Column({ type: 'varchar', length: 255 }) subject: string;
  @Column({ type: 'varchar', length: 254, nullable: true }) email: string | null;
}
