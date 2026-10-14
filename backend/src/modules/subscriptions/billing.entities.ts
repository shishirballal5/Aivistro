import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Dt, FkId, PkId } from '../../database/entities/columns';
import { TimestampedEntity } from '../../database/entities/timestamped.entity';
import { User } from '../users/user.entities';

/**
 * MONEY RULE: every amount is an integer number of PAISE in an unsigned BIGINT. Never a float, never rupees.
 * The driver returns BIGINT as a string, so even very large values are exact.
 */
@Entity('subscription_plans')
@Index('uq_plans_code', ['code'], { unique: true })
export class SubscriptionPlan extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 30 }) code: string;
  @Column({ type: 'varchar', length: 80 }) name: string;
  @Column({ type: 'varchar', length: 255, default: '' }) description: string;
  @Column({ name: 'duration_months', type: 'smallint', unsigned: true }) durationMonths: number;
  @Column({ name: 'price_paise', type: 'bigint', unsigned: true }) pricePaise: string;
  @Column({ type: 'char', length: 3, default: 'INR' }) currency: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder: number;
}

export enum PaymentStatus { Created = 'CREATED', Captured = 'CAPTURED', Failed = 'FAILED', Refunded = 'REFUNDED', PartiallyRefunded = 'PARTIALLY_REFUNDED' }

/** One purchase attempt. Plan name, price and duration are SNAPSHOTTED so later plan edits never rewrite history. */
@Entity('payments')
@Index('uq_payments_order', ['providerOrderId'], { unique: true })
@Index('uq_payments_provider_payment', ['providerPaymentId'], { unique: true })
@Index('uq_payments_receipt', ['receipt'], { unique: true })
@Index('idx_payments_user_created', ['userId', 'createdAt'])
@Index('idx_payments_status_created', ['status', 'createdAt'])
export class Payment extends TimestampedEntity {
  @PkId() id: string;
  /** RESTRICT: a user with payments can never be hard-deleted. */
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('plan_id') planId: string;
  @ManyToOne(() => SubscriptionPlan, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'plan_id' }) plan: SubscriptionPlan;
  @Column({ name: 'plan_code', type: 'varchar', length: 30 }) planCode: string;
  @Column({ name: 'duration_months', type: 'smallint', unsigned: true }) durationMonths: number;
  @Column({ type: 'varchar', length: 20 }) provider: string;
  @Column({ name: 'provider_order_id', type: 'varchar', length: 64 }) providerOrderId: string;
  @Column({ name: 'provider_payment_id', type: 'varchar', length: 64, nullable: true }) providerPaymentId: string | null;
  @Column({ type: 'varchar', length: 40 }) receipt: string;
  @Column({ name: 'amount_paise', type: 'bigint', unsigned: true }) amountPaise: string;
  @Column({ type: 'char', length: 3 }) currency: string;
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.Created }) status: PaymentStatus;
  @Column({ type: 'varchar', length: 30, nullable: true }) method: string | null;
  @Column({ name: 'failure_code', type: 'varchar', length: 60, nullable: true }) failureCode: string | null;
  @Column({ name: 'failure_reason', type: 'varchar', length: 255, nullable: true }) failureReason: string | null;
  @Dt('captured_at', { nullable: true }) capturedAt: Date | null;
  @Column({ name: 'refunded_paise', type: 'bigint', unsigned: true, default: 0 }) refundedPaise: string;
  /** Unused value of the replaced plan that was deducted from the list price (0 for normal purchases). amountPaise is what was charged. */
  @Column({ name: 'credit_paise', type: 'bigint', unsigned: true, default: 0 }) creditPaise: string;
  /** The active purchase this payment replaces (an upgrade). Null for a normal purchase or extension. */
  @Column({ name: 'upgrade_from_subscription_id', type: 'bigint', unsigned: true, nullable: true }) upgradeFromSubscriptionId: string | null;
  /** When the replaced plan would have ended. Lets a FULL refund of this upgrade restore it. */
  @Dt('upgrade_replaced_ends_at', { nullable: true }) upgradeReplacedEndsAt: Date | null;
}

export enum SubscriptionStatus { Active = 'ACTIVE', Expired = 'EXPIRED', Cancelled = 'CANCELLED', Refunded = 'REFUNDED' }

export enum SubscriptionSource { Purchase = 'PURCHASE', AdminGrant = 'ADMIN_GRANT' }

/**
 * One paid (or granted) period. `payment_id` is UNIQUE: a payment can create at most one subscription,
 * which is the database-level guarantee that a repeated callback/webhook can never extend access twice.
 */
@Entity('subscriptions')
@Index('uq_subscriptions_payment', ['paymentId'], { unique: true })
@Index('idx_subscriptions_user', ['userId', 'endsAt'])
@Index('idx_subscriptions_status_ends', ['status', 'endsAt'])
export class Subscription extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('plan_id') planId: string;
  @ManyToOne(() => SubscriptionPlan, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'plan_id' }) plan: SubscriptionPlan;
  @FkId('payment_id', { nullable: true }) paymentId: string | null;
  @ManyToOne(() => Payment, { onDelete: 'RESTRICT', nullable: true }) @JoinColumn({ name: 'payment_id' }) payment: Payment | null;
  @Column({ type: 'enum', enum: SubscriptionSource, default: SubscriptionSource.Purchase }) source: SubscriptionSource;
  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.Active }) status: SubscriptionStatus;
  @Dt('starts_at') startsAt: Date;
  @Dt('ends_at') endsAt: Date;
  @Dt('cancelled_at', { nullable: true }) cancelledAt: Date | null;
  /** Purchases are prepaid one-time periods (no auto-renewal is offered), so this only records the customer's intent not to buy again. */
  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false }) cancelAtPeriodEnd: boolean;
  @FkId('granted_by_admin_id', { nullable: true }) grantedByAdminId: string | null;
  @Column({ name: 'grant_reason', type: 'varchar', length: 255, nullable: true }) grantReason: string | null;
}

/** What playback checks. Time-based (starts/ends) so expiry needs no cron to take effect. */
@Entity('entitlements')
@Index('uq_entitlements_subscription', ['subscriptionId'], { unique: true })
@Index('idx_entitlements_user_window', ['userId', 'startsAt', 'endsAt'])
export class Entitlement extends TimestampedEntity {
  @PkId() id: string;
  @FkId('user_id') userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'user_id' }) user: User;
  @FkId('subscription_id') subscriptionId: string;
  @ManyToOne(() => Subscription, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'subscription_id' }) subscription: Subscription;
  @Dt('starts_at') startsAt: Date;
  @Dt('ends_at') endsAt: Date;
  @Dt('revoked_at', { nullable: true }) revokedAt: Date | null;
  @Column({ name: 'revoked_reason', type: 'varchar', length: 60, nullable: true }) revokedReason: string | null;
}

export enum WebhookStatus { Received = 'RECEIVED', Processed = 'PROCESSED', Ignored = 'IGNORED', Failed = 'FAILED' }

/** Every verified webhook is stored first. UNIQUE (provider, event id) makes redelivery idempotent. */
@Entity('payment_webhook_events')
@Index('uq_webhook_provider_event', ['provider', 'providerEventId'], { unique: true })
@Index('idx_webhook_status', ['status', 'createdAt'])
export class PaymentWebhookEvent extends TimestampedEntity {
  @PkId() id: string;
  @Column({ type: 'varchar', length: 20 }) provider: string;
  @Column({ name: 'provider_event_id', type: 'varchar', length: 100 }) providerEventId: string;
  @Column({ name: 'event_type', type: 'varchar', length: 60 }) eventType: string;
  @Column({ name: 'payload_hash', type: 'char', length: 64 }) payloadHash: string;
  @Column({ type: 'json' }) payload: Record<string, unknown>;
  @Column({ type: 'enum', enum: WebhookStatus, default: WebhookStatus.Received }) status: WebhookStatus;
  @Column({ type: 'int', unsigned: true, default: 0 }) attempts: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) note: string | null;
  @Dt('processed_at', { nullable: true }) processedAt: Date | null;
}

export enum RefundStatus { Pending = 'PENDING', Processed = 'PROCESSED', Failed = 'FAILED' }

@Entity('refunds')
@Index('uq_refunds_provider', ['providerRefundId'], { unique: true })
@Index('idx_refunds_payment', ['paymentId'])
export class Refund extends TimestampedEntity {
  @PkId() id: string;
  @FkId('payment_id') paymentId: string;
  @ManyToOne(() => Payment, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'payment_id' }) payment: Payment;
  @Column({ name: 'provider_refund_id', type: 'varchar', length: 64, nullable: true }) providerRefundId: string | null;
  @Column({ name: 'amount_paise', type: 'bigint', unsigned: true }) amountPaise: string;
  @Column({ type: 'varchar', length: 255 }) reason: string;
  @Column({ type: 'enum', enum: RefundStatus, default: RefundStatus.Pending }) status: RefundStatus;
  @FkId('requested_by_admin_id', { nullable: true }) requestedByAdminId: string | null;
  @Column({ name: 'failure_reason', type: 'varchar', length: 255, nullable: true }) failureReason: string | null;
  @Dt('processed_at', { nullable: true }) processedAt: Date | null;
}
