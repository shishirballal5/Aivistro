import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { Episode } from '../catalog/catalog.entities';
import { User } from '../users/user.entities';
import { VideoAsset } from '../video-assets/video-assets.entities';

/**
 * One authorised viewing. The URL token is random, shown to the client once, and stored ONLY as a SHA-256 hash.
 * It expires on its own unless the player heartbeats, and can be revoked at any moment (suspension, refund, too many devices).
 */
@Entity('playback_sessions')
@Index('uq_playback_token_hash', ['tokenHash'], { unique: true })
@Index('idx_playback_user_active', ['userId', 'endedAt', 'revokedAt', 'expiresAt'])
@Index('idx_playback_episode', ['episodeId'])
export class PlaybackSession extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('episode_id') episodeId: string;
  @ManyToOne(() => Episode, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'episode_id' }) episode: Episode;
  @FkId('asset_id') assetId: string;
  @ManyToOne(() => VideoAsset, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'asset_id' }) asset: VideoAsset;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash: string;
  @Dt('expires_at') expiresAt: Date;
  /** Absolute cap: heartbeats can never extend a session beyond this. */
  @Dt('hard_expires_at') hardExpiresAt: Date;
  @Dt('last_heartbeat_at') lastHeartbeatAt: Date;
  @Column({ name: 'position_seconds', type: 'int', unsigned: true, default: 0 }) positionSeconds: number;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true }) ipAddress: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true }) userAgent: string | null;
  @Dt('ended_at', { nullable: true }) endedAt: Date | null;
  @Dt('revoked_at', { nullable: true }) revokedAt: Date | null;
  @Column({ name: 'revoked_reason', type: 'varchar', length: 60, nullable: true }) revokedReason: string | null;
}
