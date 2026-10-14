import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { User } from '../users/user.entities';

export enum NotificationAudience { All = 'ALL', Subscribers = 'SUBSCRIBERS', NonSubscribers = 'NON_SUBSCRIBERS' }

export enum NotificationCategory { Marketing = 'MARKETING', NewEpisodes = 'NEW_EPISODES', Billing = 'BILLING' }

export enum CampaignStatus { Draft = 'DRAFT', Scheduled = 'SCHEDULED', Sending = 'SENDING', Sent = 'SENT', Cancelled = 'CANCELLED' }

/** An admin-created campaign. Delivery fans out to `user_notifications` (in-app) and, if configured, push. */
@Entity('notifications')
@Index('idx_campaign_status_sched', ['status', 'scheduledAt'])
export class Notification extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'varchar', length: 500 }) body: string;
  @Column({ type: 'enum', enum: NotificationAudience, default: NotificationAudience.All }) audience: NotificationAudience;
  @Column({ type: 'enum', enum: NotificationCategory, default: NotificationCategory.Marketing }) category: NotificationCategory;
  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.Draft }) status: CampaignStatus;
  @Column({ type: 'json', nullable: true }) data: Record<string, string> | null;
  @Dt('scheduled_at', { nullable: true }) scheduledAt: Date | null;
  @Dt('sent_at', { nullable: true }) sentAt: Date | null;
  @Column({ name: 'recipient_count', type: 'int', unsigned: true, default: 0 }) recipientCount: number;
  /** Delivery is resumable: the last user id fully handled, so a retry continues instead of starting over. */
  @Column({ name: 'progress_cursor', type: 'bigint', unsigned: true, default: 0 }) progressCursor: string;
  @FkId('created_by_admin_id', { nullable: true }) createdByAdminId: string | null;
}

@Entity('user_notifications')
@Index('uq_user_notification_campaign', ['notificationId', 'userId'], { unique: true })
@Index('idx_usernotif_user_created', ['userId', 'id'])
@Index('idx_usernotif_unread', ['userId', 'readAt'])
export class UserNotification {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('notification_id', { nullable: true }) notificationId: string | null;
  @ManyToOne(() => Notification, { onDelete: 'RESTRICT', nullable: true }) @JoinColumn({ name: 'notification_id' }) notification: Notification | null;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'varchar', length: 500 }) body: string;
  @Column({ type: 'enum', enum: NotificationCategory, default: NotificationCategory.Marketing }) category: NotificationCategory;
  @Column({ type: 'json', nullable: true }) data: Record<string, string> | null;
  @Dt('read_at', { nullable: true }) readAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }) createdAt: Date;
}

export enum DevicePlatform { Android = 'android', Ios = 'ios', Web = 'web' }

@Entity('device_tokens')
@Index('uq_device_token', ['token'], { unique: true })
@Index('idx_device_user', ['userId'])
export class DeviceToken extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
  @Column({ type: 'varchar', length: 255 }) token: string;
  @Column({ type: 'enum', enum: DevicePlatform }) platform: DevicePlatform;
  @Dt('last_seen_at') lastSeenAt: Date;
  @Dt('revoked_at', { nullable: true }) revokedAt: Date | null;
}
