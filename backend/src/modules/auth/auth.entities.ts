import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { AdminUser } from '../admin/admin.entities';
import { User } from '../users/user.entities';

/** A signed-in device. Exactly one of user_id / admin_user_id is set (enforced by AuthSessionsService). */
@Entity('auth_sessions')
@Index('idx_sessions_user', ['userId'])
@Index('idx_sessions_admin', ['adminUserId'])
export class AuthSession extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id', { nullable: true }) userId: string | null;
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true }) @JoinColumn({ name: 'user_id' }) user: User | null;
  @FkId('admin_user_id', { nullable: true }) adminUserId: string | null;
  @ManyToOne(() => AdminUser, { onDelete: 'CASCADE', nullable: true }) @JoinColumn({ name: 'admin_user_id' }) adminUser: AdminUser | null;
  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true }) deviceName: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true }) userAgent: string | null;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true }) ipAddress: string | null;
  @Dt('last_seen_at') lastSeenAt: Date;
  /** Absolute lifetime: the session cannot be refreshed past this, however often it is used. */
  @Dt('expires_at') expiresAt: Date;
  @Dt('revoked_at', { nullable: true }) revokedAt: Date | null;
  @Column({ name: 'revoked_reason', type: 'varchar', length: 60, nullable: true }) revokedReason: string | null;
}

/** Refresh tokens are random, stored only as SHA-256 hashes, and single-use (rotated on every refresh). */
@Entity('refresh_tokens')
@Index('uq_refresh_token_hash', ['tokenHash'], { unique: true })
@Index('idx_refresh_session', ['sessionId'])
@Index('idx_refresh_expires', ['expiresAt'])
export class RefreshToken extends TimestampedEntity {
  @PkId() id: string;
  @FkId('session_id') sessionId: string;
  @ManyToOne(() => AuthSession, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'session_id' }) session: AuthSession;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash: string;
  @Dt('expires_at') expiresAt: Date;
  /** Set when the token is exchanged. Presenting a used token again = theft signal, the whole session is revoked. */
  @Dt('used_at', { nullable: true }) usedAt: Date | null;
}

export enum OtpPurpose { Login = 'LOGIN' }

@Entity('otp_challenges')
@Index('idx_otp_destination_created', ['destination', 'createdAt'])
@Index('idx_otp_ip_created', ['ipAddress', 'createdAt'])
@Index('idx_otp_expires', ['expiresAt'])
export class OtpChallenge extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 20 }) destination: string;
  @Column({ type: 'enum', enum: OtpPurpose, default: OtpPurpose.Login }) purpose: OtpPurpose;
  /** HMAC-SHA256(otp key, challengeId:code). The code itself is never stored. */
  @Column({ name: 'code_hash', type: 'char', length: 64 }) codeHash: string;
  @Column({ type: 'smallint', unsigned: true, default: 0 }) attempts: number;
  @Column({ name: 'max_attempts', type: 'smallint', unsigned: true, default: 5 }) maxAttempts: number;
  @Dt('expires_at') expiresAt: Date;
  @Dt('consumed_at', { nullable: true }) consumedAt: Date | null;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true }) ipAddress: string | null;
}

export enum EmailTokenPurpose { VerifyEmail = 'VERIFY_EMAIL', ResetPassword = 'RESET_PASSWORD' }

@Entity('email_tokens')
@Index('uq_email_token_hash', ['tokenHash'], { unique: true })
@Index('idx_email_token_user', ['userId', 'purpose'])
export class EmailToken extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @Column({ type: 'enum', enum: EmailTokenPurpose }) purpose: EmailTokenPurpose;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash: string;
  @Dt('expires_at') expiresAt: Date;
  @Dt('used_at', { nullable: true }) usedAt: Date | null;
}
