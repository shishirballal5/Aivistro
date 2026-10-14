import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, MoreThan, Repository } from 'typeorm';
import { randomToken, sha256Hex } from '../../common/crypto/crypto.util';
import { badRequest, conflict, DomainException, unavailable } from '../../common/errors';
import { formatInr, paiseToNumber } from '../../common/money';
import { ActorType, NotificationCategory, Payment, PaymentStatus, PaymentWebhookEvent, Refund, RefundStatus, Subscription, SubscriptionPlan, SubscriptionStatus, WebhookStatus } from '../../database/entities/index';
import { loadUserBriefs } from '../users/user-brief';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { GatewayError, GatewayPayment, PaymentGateway } from './gateway/payment-gateway';
import { toGatewayPayment } from '../../util/thirdparty/razorpay/razorpay.gateway';

const CHECKOUT_REUSE_MINUTES = 30;
const WEBHOOK_MAX_ATTEMPTS = 5;
type EventResult = { status: WebhookStatus; note?: string };

export const paymentView = (p: Payment) => ({
  id: p.id, planCode: p.planCode, durationMonths: p.durationMonths, amountPaise: paiseToNumber(p.amountPaise), amountDisplay: formatInr(p.amountPaise), currency: p.currency, status: p.status,
  method: p.method, failureReason: p.failureReason, createdAt: p.createdAt, capturedAt: p.capturedAt, refundedPaise: paiseToNumber(p.refundedPaise),
  creditPaise: paiseToNumber(p.creditPaise), upgrade: !!p.upgradeFromSubscriptionId,
});

/**
 * Payment lifecycle. Core guarantees:
 *  - Access is granted ONLY from a payment state read from the gateway or from a signature-verified webhook, never from a client claim.
 *  - Amount, currency and order id are checked against what WE created before anything is activated.
 *  - Activation is one transaction under row locks, and `subscriptions.payment_id` is UNIQUE, so the checkout callback,
 *    the webhook, retries and reconciliation can all report the same payment and it still extends access exactly once.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(SubscriptionPlan) private readonly plans: Repository<SubscriptionPlan>,
    @InjectRepository(PaymentWebhookEvent) private readonly events: Repository<PaymentWebhookEvent>,
    @InjectRepository(Refund) private readonly refunds: Repository<Refund>,
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    private readonly gateway: PaymentGateway,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── 1. quote + checkout ──
  /** The gateway cannot take less than this per order (Razorpay: INR 1). */
  private static readonly MIN_CHARGE_PAISE = 100n;

  /**
   * What buying `planCode` would cost THIS user right now. Normally the list price. When it replaces a shorter running plan
   * (an upgrade) the unused value of that plan is deducted and the new period starts now instead of stacking after it.
   */
  async quote(userId: string, planCode: string) {
    const plan = await this.plans.findOne({ where: { code: planCode, active: true } });
    if (!plan) throw new DomainException(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'This plan is not available');
    const credit = await this.subscriptions.upgradeCredit(userId, plan.durationMonths);
    const list = BigInt(plan.pricePaise);
    let creditPaise = credit?.creditPaise ?? 0n;
    if (creditPaise > list - PaymentsService.MIN_CHARGE_PAISE) creditPaise = list - PaymentsService.MIN_CHARGE_PAISE; // never below the gateway minimum
    if (creditPaise < 0n) creditPaise = 0n;
    return { plan, list, creditPaise, amount: list - creditPaise, credit: creditPaise > 0n ? credit : null };
  }

  async quoteView(userId: string, planCode: string) {
    const q = await this.quote(userId, planCode);
    return {
      planCode: q.plan.code, planName: q.plan.name, durationMonths: q.plan.durationMonths,
      listPricePaise: paiseToNumber(String(q.list)), listPriceDisplay: formatInr(String(q.list)), creditPaise: paiseToNumber(String(q.creditPaise)), creditDisplay: formatInr(String(q.creditPaise)),
      amountPaise: paiseToNumber(String(q.amount)), amountDisplay: formatInr(String(q.amount)),
      upgrade: !!q.credit, replaces: q.credit ? { planName: q.credit.fromPlanName, endsAt: q.credit.fromEndsAt } : null,
    };
  }

  async createCheckout(userId: string, planCode: string) {
    if (!this.gateway.enabled) throw unavailable('PAYMENTS_NOT_CONFIGURED', 'Payments are not available right now');
    const { plan, creditPaise, amount, credit } = await this.quote(userId, planCode);

    // Re-use a fresh unpaid order for the same plan and the same PRICE (credit shrinks over time, so a stale discounted order is not reused).
    const reusable = await this.payments.findOne({ where: { userId, planId: plan.id, status: PaymentStatus.Created, amountPaise: String(amount), createdAt: MoreThan(new Date(Date.now() - CHECKOUT_REUSE_MINUTES * 60_000)) }, order: { id: 'DESC' } });
    if (reusable && !reusable.providerOrderId.startsWith('pending_')) return this.checkoutView(reusable, plan);

    const receipt = `rcpt_${randomToken(12)}`;
    const payment = await this.payments.save({
      userId, planId: plan.id, planCode: plan.code, durationMonths: plan.durationMonths, provider: this.gateway.name, providerOrderId: `pending_${receipt}`, providerPaymentId: null, receipt,
      amountPaise: String(amount), currency: plan.currency, status: PaymentStatus.Created, method: null, failureCode: null, failureReason: null, capturedAt: null, refundedPaise: '0',
      creditPaise: String(creditPaise), upgradeFromSubscriptionId: credit?.fromSubscriptionId ?? null,
    });
    try {
      const { orderId } = await this.gateway.createOrder({ amountPaise: paiseToNumber(String(amount)), currency: plan.currency, receipt, notes: { paymentId: payment.id, userId, planCode: plan.code } });
      await this.payments.update(payment.id, { providerOrderId: orderId });
      payment.providerOrderId = orderId;
    } catch (err) {
      await this.payments.update(payment.id, { status: PaymentStatus.Failed, failureCode: 'GATEWAY_ERROR', failureReason: 'Could not create the order' });
      this.log.error({ err, paymentId: payment.id }, 'Gateway order creation failed');
      throw new DomainException(HttpStatus.BAD_GATEWAY, 'PAYMENT_GATEWAY_ERROR', 'We could not start the payment. Please try again.');
    }
    await this.audit.record({ actorType: ActorType.User, actorId: userId, action: 'payment.checkout_created', entityType: 'payment', entityId: payment.id, metadata: { planCode: plan.code, amountPaise: String(amount), creditPaise: String(creditPaise), upgradeFrom: credit?.fromSubscriptionId ?? null } });
    return this.checkoutView(payment, plan);
  }

  private checkoutView(p: Payment, plan: SubscriptionPlan) {
    return { paymentId: p.id, orderId: p.providerOrderId, keyId: this.gateway.publicKeyId, amountPaise: paiseToNumber(p.amountPaise), amountDisplay: formatInr(p.amountPaise), currency: p.currency, planCode: plan.code, planName: plan.name, durationMonths: plan.durationMonths, creditPaise: paiseToNumber(p.creditPaise), creditDisplay: formatInr(p.creditPaise), listPriceDisplay: formatInr(plan.pricePaise), upgrade: !!p.upgradeFromSubscriptionId };
  }

  // ── 2. the client says "I paid": verify, never trust ──
  async verifyClientPayment(userId: string, orderId: string, providerPaymentId: string, signature: string) {
    const payment = await this.payments.findOne({ where: { providerOrderId: orderId, userId } }); // ownership: you can only verify YOUR order
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' });
    if (!this.gateway.verifyCheckoutSignature(orderId, providerPaymentId, signature)) {
      await this.audit.record({ actorType: ActorType.User, actorId: userId, action: 'payment.invalid_signature', entityType: 'payment', entityId: payment.id });
      throw badRequest('INVALID_SIGNATURE', 'Payment could not be verified');
    }
    // The signature only proves the checkout widget returned these ids. Access still depends on the gateway's own record.
    const state = await this.reconcileOne(payment.id, providerPaymentId);
    const fresh = await this.payments.findOneByOrFail({ id: payment.id });
    return { status: state, payment: paymentView(fresh), subscription: await this.subscriptions.forUser(userId) };
  }

  /**
   * Looks at the gateway's truth for one payment and acts on it. Returns the resulting state.
   * Used by the client callback, by reconciliation, and by the admin "re-check" action.
   */
  async reconcileOne(paymentId: string, providerPaymentId?: string): Promise<'ACTIVE' | 'PENDING' | 'FAILED'> {
    const payment = await this.payments.findOneByOrFail({ id: paymentId });
    if (payment.status === PaymentStatus.Captured || payment.status === PaymentStatus.Refunded || payment.status === PaymentStatus.PartiallyRefunded) return 'ACTIVE';

    let gp: GatewayPayment | null;
    try {
      gp = providerPaymentId ? await this.gateway.fetchPayment(providerPaymentId) : this.best(await this.gateway.fetchOrderPayments(payment.providerOrderId));
    } catch (err) {
      if (err instanceof GatewayError) throw new DomainException(HttpStatus.BAD_GATEWAY, 'PAYMENT_GATEWAY_ERROR', 'Could not confirm the payment yet. We will keep checking.');
      throw err;
    }
    if (!gp) return 'PENDING';
    if (gp.orderId !== payment.providerOrderId) throw badRequest('ORDER_MISMATCH', 'This payment belongs to a different order'); // a payment id from someone else's order
    if (!this.matchesOrder(payment, gp)) {
      await this.audit.record({ actorType: ActorType.System, action: 'payment.amount_mismatch', entityType: 'payment', entityId: payment.id, metadata: { expected: payment.amountPaise, got: gp.amountPaise, currency: gp.currency } });
      this.log.error({ paymentId: payment.id, expected: payment.amountPaise, got: gp.amountPaise }, 'Payment amount/currency mismatch: NOT activating');
      throw new DomainException(HttpStatus.CONFLICT, 'AMOUNT_MISMATCH', 'The paid amount does not match the order');
    }
    if (gp.status === 'authorized') gp = await this.gateway.capturePayment(gp.id, gp.amountPaise, gp.currency);
    if (gp.status === 'captured') { await this.applyCapture(payment.id, gp); return 'ACTIVE'; }
    if (gp.status === 'failed') { await this.markFailed(payment.id, gp); return 'FAILED'; }
    return 'PENDING';
  }

  private best(list: GatewayPayment[]): GatewayPayment | null {
    return list.find((p) => p.status === 'captured') ?? list.find((p) => p.status === 'authorized') ?? list.sort((a, b) => b.id.localeCompare(a.id))[0] ?? null;
  }
  private matchesOrder(p: Payment, g: GatewayPayment): boolean { return String(g.amountPaise) === String(p.amountPaise) && g.currency === p.currency; }

  // ── 3. the atomic core ──
  /**
   * Marks the payment CAPTURED and creates the subscription + entitlement, in ONE transaction.
   * Idempotent: if the payment is already captured the existing subscription is returned and nothing is extended.
   */
  async applyCapture(paymentId: string, gp: GatewayPayment): Promise<{ subscription: Subscription; newlyActivated: boolean }> {
    const run = () => this.ds.transaction(async (em) => {
      const payment = await em.getRepository(Payment).findOne({ where: { id: paymentId }, lock: { mode: 'pessimistic_write' } });
      if (!payment) throw new NotFoundException();
      const existing = await em.getRepository(Subscription).findOne({ where: { paymentId } });
      if (existing) return { subscription: existing, newlyActivated: false };
      if (payment.status === PaymentStatus.Refunded) throw conflict('PAYMENT_REFUNDED', 'This payment was refunded');
      if (!this.matchesOrder(payment, gp) || gp.orderId !== payment.providerOrderId) throw new DomainException(HttpStatus.CONFLICT, 'AMOUNT_MISMATCH', 'The paid amount does not match the order');

      await em.getRepository(Payment).update(paymentId, { status: PaymentStatus.Captured, providerPaymentId: gp.id, method: gp.method, capturedAt: new Date(), failureCode: null, failureReason: null });
      const subscription = await this.subscriptions.grantFromPayment(em, payment);
      // Upgrade bookkeeping: was the replaced period actually ended? If it had already lapsed or been revoked, the new period simply starts
      // now and the discount was not needed: flag it so an operator can see it.
      let upgrade: Record<string, unknown> = {};
      if (payment.upgradeFromSubscriptionId) {
        const old = await em.getRepository(Subscription).findOne({ where: { id: payment.upgradeFromSubscriptionId } });
        upgrade = { upgradedFrom: payment.upgradeFromSubscriptionId, creditPaise: payment.creditPaise, upgradeApplied: !!old && old.status === SubscriptionStatus.Expired && old.endsAt <= subscription.startsAt && !!old.cancelledAt };
      }
      await this.audit.record({ actorType: ActorType.System, action: 'subscription.activated', entityType: 'subscription', entityId: subscription.id, metadata: { paymentId, userId: payment.userId, planCode: payment.planCode, endsAt: subscription.endsAt, ...upgrade } }, em);
      return { subscription, newlyActivated: true };
    });
    try {
      const result = await run();
      if (result.newlyActivated) void this.notifications.notifyUser(result.subscription.userId, { title: 'Your Premium is active', body: `Thank you! You can watch every episode until ${result.subscription.endsAt.toISOString().slice(0, 10)}.`, category: NotificationCategory.Billing, data: { type: 'subscription_activated' } });
      return result;
    } catch (err) {
      // Two processes raced past the lock check and one hit a unique key: the other one already did the work.
      if ((err as { driverError?: { code?: string } })?.driverError?.code === 'ER_DUP_ENTRY') {
        const existing = await this.subs.findOneBy({ paymentId });
        if (existing) return { subscription: existing, newlyActivated: false };
      }
      throw err;
    }
  }

  /** CREATED -> FAILED only. A CAPTURED payment is never downgraded by a late or out-of-order failure event. */
  private async markFailed(paymentId: string, gp: GatewayPayment): Promise<void> {
    await this.payments.update({ id: paymentId, status: In([PaymentStatus.Created, PaymentStatus.Failed]) }, { status: PaymentStatus.Failed, method: gp.method, failureCode: gp.errorCode?.slice(0, 60) ?? 'PAYMENT_FAILED', failureReason: gp.errorDescription?.slice(0, 255) ?? 'The payment was not completed' });
  }

  // ── 4. webhooks ──
  /**
   * Entry point for provider webhooks. Order of operations is deliberate:
   * verify the signature on the RAW body -> store the event (unique id = idempotency) -> process.
   * Returns normally (HTTP 200) for new, duplicate and ignored events; throws (so the provider retries) only on our own failures.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined): Promise<{ received: true; duplicate: boolean }> {
    if (!this.gateway.enabled) throw unavailable('PAYMENTS_NOT_CONFIGURED', 'Payments are not configured');
    if (!rawBody || !signature || !this.gateway.verifyWebhookSignature(rawBody, signature)) {
      await this.audit.record({ actorType: ActorType.System, action: 'payment.webhook_bad_signature' });
      throw badRequest('INVALID_SIGNATURE', 'Invalid webhook signature');
    }
    let body: { event?: unknown; payload?: Record<string, { entity?: Record<string, unknown> }> };
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw badRequest('INVALID_PAYLOAD', 'Malformed webhook body'); }
    if (typeof body.event !== 'string' || !body.payload || typeof body.payload !== 'object') throw badRequest('INVALID_PAYLOAD', 'Malformed webhook body');

    const hash = sha256Hex(rawBody);
    const eventId = eventIdHeader && /^[\w.-]{6,100}$/.test(eventIdHeader) ? eventIdHeader : `body_${hash.slice(0, 40)}`;
    let row: PaymentWebhookEvent;
    try {
      row = await this.events.save({ provider: this.gateway.name, providerEventId: eventId, eventType: body.event.slice(0, 60), payloadHash: hash, payload: body as Record<string, unknown>, status: WebhookStatus.Received, attempts: 1, note: null, processedAt: null });
    } catch (err) {
      if ((err as { driverError?: { code?: string } })?.driverError?.code !== 'ER_DUP_ENTRY') throw err;
      row = await this.events.findOneByOrFail({ provider: this.gateway.name, providerEventId: eventId });
      if (row.status === WebhookStatus.Processed || row.status === WebhookStatus.Ignored) return { received: true, duplicate: true }; // redelivery of something we already handled
      await this.events.increment({ id: row.id }, 'attempts', 1); // an earlier attempt failed or is in flight: process again (all steps are idempotent)
    }
    await this.processStored(row.id, body as { event: string; payload: Record<string, { entity?: Record<string, unknown> }> });
    return { received: true, duplicate: false };
  }

  private async processStored(eventRowId: string, body: { event: string; payload: Record<string, { entity?: Record<string, unknown> }> }): Promise<void> {
    try {
      const result = await this.processEvent(body);
      await this.events.update(eventRowId, { status: result.status, note: result.note?.slice(0, 500) ?? null, processedAt: new Date() });
    } catch (err) {
      await this.events.update(eventRowId, { status: WebhookStatus.Failed, note: String((err as Error).message).slice(0, 500) });
      throw err; // 5xx -> the provider redelivers
    }
  }

  private async processEvent(body: { event: string; payload: Record<string, { entity?: Record<string, unknown> }> }): Promise<EventResult> {
    const pay = body.payload.payment?.entity;
    switch (body.event) {
      case 'payment.authorized':
      case 'payment.captured':
      case 'order.paid': {
        if (!pay) return { status: WebhookStatus.Ignored, note: 'no payment entity' };
        const payment = await this.payments.findOne({ where: { providerOrderId: String(pay.order_id) } });
        if (!payment) return { status: WebhookStatus.Ignored, note: 'unknown order' };
        let gp = toGatewayPayment(pay as never);
        if (gp.orderId !== payment.providerOrderId || !this.matchesOrder(payment, gp)) {
          await this.audit.record({ actorType: ActorType.System, action: 'payment.amount_mismatch', entityType: 'payment', entityId: payment.id, metadata: { source: 'webhook', expected: payment.amountPaise, got: gp.amountPaise } });
          return { status: WebhookStatus.Failed, note: 'AMOUNT_MISMATCH: not activated' }; // acknowledged (a retry cannot fix it) but flagged for admins
        }
        if (gp.status === 'authorized') gp = await this.gateway.capturePayment(gp.id, gp.amountPaise, gp.currency);
        if (gp.status !== 'captured') return { status: WebhookStatus.Ignored, note: `status ${gp.status}` };
        const r = await this.applyCapture(payment.id, gp);
        return { status: WebhookStatus.Processed, note: r.newlyActivated ? 'activated' : 'already active' };
      }
      case 'payment.failed': {
        if (!pay) return { status: WebhookStatus.Ignored, note: 'no payment entity' };
        const payment = await this.payments.findOne({ where: { providerOrderId: String(pay.order_id) } });
        if (!payment) return { status: WebhookStatus.Ignored, note: 'unknown order' };
        if (payment.status !== PaymentStatus.Created && payment.status !== PaymentStatus.Failed) return { status: WebhookStatus.Ignored, note: `late failure ignored, payment is ${payment.status}` };
        await this.markFailed(payment.id, toGatewayPayment(pay as never));
        return { status: WebhookStatus.Processed };
      }
      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed': {
        const refund = body.payload.refund?.entity as { id?: string; payment_id?: string; amount?: number; status?: string } | undefined;
        if (!refund?.id || !refund.payment_id || typeof refund.amount !== 'number') return { status: WebhookStatus.Ignored, note: 'no refund entity' };
        return this.applyRefundEvent(body.event, refund as { id: string; payment_id: string; amount: number; status?: string });
      }
      default:
        return { status: WebhookStatus.Ignored, note: 'unhandled event type' };
    }
  }

  // ── 5. refunds ──
  async refundPayment(adminId: string, paymentId: string, amountPaise: number | undefined, reason: string) {
    if (!this.gateway.enabled) throw unavailable('PAYMENTS_NOT_CONFIGURED', 'Payments are not available right now');
    // Reserve the amount inside a locked transaction so two admins cannot over-refund the same payment.
    const { refund, payment } = await this.ds.transaction(async (em) => {
      const p = await em.getRepository(Payment).findOne({ where: { id: paymentId }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw new NotFoundException();
      if (p.status !== PaymentStatus.Captured && p.status !== PaymentStatus.PartiallyRefunded) throw conflict('NOT_REFUNDABLE', 'Only captured payments can be refunded');
      if (!p.providerPaymentId) throw conflict('NOT_REFUNDABLE', 'This payment has no provider payment id');
      const reserved = await em.getRepository(Refund).createQueryBuilder('r').select('COALESCE(SUM(r.amount_paise), 0)', 's').where("r.payment_id = :id AND r.status IN ('PENDING', 'PROCESSED')", { id: paymentId }).getRawOne<{ s: string }>();
      const remaining = BigInt(p.amountPaise) - BigInt(reserved?.s ?? 0);
      const wanted = amountPaise !== undefined ? BigInt(amountPaise) : remaining;
      if (wanted <= 0n || wanted > remaining) throw badRequest('INVALID_REFUND_AMOUNT', `Refund must be between 1 and ${remaining} paise`);
      const r = await em.getRepository(Refund).save({ paymentId, providerRefundId: null, amountPaise: wanted.toString(), reason, status: RefundStatus.Pending, requestedByAdminId: adminId, failureReason: null, processedAt: null });
      return { refund: r, payment: p };
    });
    try {
      const g = await this.gateway.refund(payment.providerPaymentId!, paiseToNumber(refund.amountPaise), { receipt: `rfnd_${refund.id}`, reason });
      await this.refunds.update(refund.id, { providerRefundId: g.refundId });
      if (g.status === 'processed') await this.ds.transaction((em) => this.applyRefundProcessed(em, refund.id));
      else if (g.status === 'failed') await this.refunds.update(refund.id, { status: RefundStatus.Failed, failureReason: 'Rejected by the provider' });
    } catch (err) {
      await this.refunds.update(refund.id, { status: RefundStatus.Failed, failureReason: String((err as Error).message).slice(0, 255) });
      throw new DomainException(HttpStatus.BAD_GATEWAY, 'REFUND_FAILED', 'The refund could not be completed');
    }
    const done = await this.refunds.findOneByOrFail({ id: refund.id });
    if (done.status === RefundStatus.Processed) void this.notifications.notifyUser(payment.userId, { title: 'Refund processed', body: `Your refund of ${formatInr(done.amountPaise)} has been issued.`, category: NotificationCategory.Billing, data: { type: 'refund_processed' } });
    return this.refundView(done, await this.payments.findOneByOrFail({ id: paymentId }));
  }

  private async applyRefundEvent(event: string, r: { id: string; payment_id: string; amount: number; status?: string }): Promise<EventResult> {
    let refund = await this.refunds.findOne({ where: { providerRefundId: r.id } });
    if (!refund) {
      const payment = await this.payments.findOne({ where: { providerPaymentId: r.payment_id } });
      if (!payment) return { status: WebhookStatus.Ignored, note: 'unknown payment' };
      // A refund started in the provider dashboard (not by us): record it so our books match.
      refund = await this.refunds.save({ paymentId: payment.id, providerRefundId: r.id, amountPaise: String(r.amount), reason: 'Created in the payment provider dashboard', status: RefundStatus.Pending, requestedByAdminId: null, failureReason: null, processedAt: null });
    }
    if (event === 'refund.failed') { if (refund.status === RefundStatus.Pending) await this.refunds.update(refund.id, { status: RefundStatus.Failed, failureReason: 'Failed at the provider' }); return { status: WebhookStatus.Processed }; }
    if (event === 'refund.processed') await this.ds.transaction((em) => this.applyRefundProcessed(em, refund!.id));
    return { status: WebhookStatus.Processed };
  }

  /** Idempotent: a refund is applied to the payment totals once. A FULL refund also ends the access that payment bought. */
  private async applyRefundProcessed(em: EntityManager, refundId: string): Promise<void> {
    const refund = await em.getRepository(Refund).findOne({ where: { id: refundId }, lock: { mode: 'pessimistic_write' } });
    if (!refund || refund.status === RefundStatus.Processed) return;
    const payment = await em.getRepository(Payment).findOneOrFail({ where: { id: refund.paymentId }, lock: { mode: 'pessimistic_write' } });
    const total = BigInt(payment.refundedPaise) + BigInt(refund.amountPaise);
    const full = total >= BigInt(payment.amountPaise);
    await em.getRepository(Refund).update(refund.id, { status: RefundStatus.Processed, processedAt: new Date() });
    await em.getRepository(Payment).update(payment.id, { refundedPaise: total.toString(), status: full ? PaymentStatus.Refunded : PaymentStatus.PartiallyRefunded });
    if (full) {
      const sub = await em.getRepository(Subscription).findOne({ where: { paymentId: payment.id } });
      if (sub && sub.status !== SubscriptionStatus.Refunded) await this.subscriptions.revoke(em, sub.id, SubscriptionStatus.Refunded, 'refunded');
      // Refunding an UPGRADE in full puts the plan it replaced back (otherwise the user would lose time they had already paid for).
      await this.subscriptions.restoreReplacedByUpgrade(em, payment);
    }
    await this.audit.record({ actorType: refund.requestedByAdminId ? ActorType.Admin : ActorType.System, actorId: refund.requestedByAdminId, action: 'payment.refunded', entityType: 'payment', entityId: payment.id, metadata: { refundId: refund.id, amountPaise: refund.amountPaise, full } }, em);
  }

  // ── 6. reconciliation: catch anything a lost webhook or closed browser tab left behind ──
  async reconcilePending(opts: { olderThanMinutes?: number; maxAgeDays?: number; limit?: number } = {}): Promise<{ checked: number; activated: number; errors: number }> {
    const now = Date.now();
    const rows = await this.payments.find({
      where: { status: In([PaymentStatus.Created, PaymentStatus.Failed]), createdAt: Between(new Date(now - (opts.maxAgeDays ?? 7) * 86400_000), new Date(now - (opts.olderThanMinutes ?? 10) * 60_000)) },
      order: { id: 'ASC' }, take: opts.limit ?? 100,
    });
    let activated = 0, errors = 0;
    for (const p of rows) {
      if (p.providerOrderId.startsWith('pending_')) continue; // the order was never created at the provider
      try { if ((await this.reconcileOne(p.id)) === 'ACTIVE') activated++; } catch (err) { errors++; this.log.warn({ err, paymentId: p.id }, 'Reconciliation failed for payment'); }
    }
    return { checked: rows.length, activated, errors };
  }

  /** Re-runs webhook events that failed on our side (e.g. a database blip) and still have retries left. */
  async retryFailedEvents(limit = 50): Promise<{ retried: number; recovered: number }> {
    const rows = await this.events.find({ where: { status: WebhookStatus.Failed, attempts: Between(0, WEBHOOK_MAX_ATTEMPTS - 1) }, order: { id: 'ASC' }, take: limit });
    let recovered = 0;
    for (const row of rows) {
      if ((row.note ?? '').startsWith('AMOUNT_MISMATCH')) continue; // needs a human, not a retry
      await this.events.increment({ id: row.id }, 'attempts', 1);
      try { await this.processStored(row.id, row.payload as never); recovered++; } catch { /* stays FAILED; counted by attempts */ }
    }
    return { retried: rows.length, recovered };
  }

  // ── reads ──
  async historyForUser(userId: string) { return (await this.payments.find({ where: { userId }, order: { id: 'DESC' }, take: 50 })).map(paymentView); }

  async adminList(q: { status?: PaymentStatus; userId?: string; cursor?: number; limit: number }) {
    const qb = this.payments.createQueryBuilder('p').orderBy('p.id', 'DESC').take(q.limit + 1);
    if (q.cursor) qb.andWhere('p.id < :c', { c: q.cursor });
    if (q.status) qb.andWhere('p.status = :s', { s: q.status });
    if (q.userId) qb.andWhere('p.user_id = :u', { u: q.userId });
    const rows = await qb.getMany();
    const page = rows.slice(0, q.limit);
    const briefs = await loadUserBriefs(this.ds.manager, page.map((p) => p.userId)); // one batched lookup for the whole page
    return { items: page.map((p) => ({ ...paymentView(p), userId: p.userId, user: briefs.get(p.userId) ?? null, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, provider: p.provider })), hasMore: rows.length > q.limit, lastId: page.length ? Number(page[page.length - 1].id) : null };
  }

  async adminGet(id: string) {
    const p = await this.payments.findOne({ where: { id }, relations: { user: false } });
    if (!p) throw new NotFoundException();
    const refunds = await this.refunds.find({ where: { paymentId: id }, order: { id: 'ASC' } });
    const subscription = await this.subs.findOne({ where: { paymentId: id } });
    const webhooks = await this.events.createQueryBuilder('w').select(['w.id', 'w.eventType', 'w.status', 'w.note', 'w.attempts', 'w.createdAt']).where("JSON_UNQUOTE(JSON_EXTRACT(w.payload, '$.payload.payment.entity.order_id')) = :o", { o: p.providerOrderId }).orderBy('w.id', 'ASC').getMany();
    const user = (await loadUserBriefs(this.ds.manager, [p.userId])).get(p.userId) ?? null;
    return { ...paymentView(p), userId: p.userId, user, provider: p.provider, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, refunds: refunds.map((r) => this.refundView(r, p)), subscriptionId: subscription?.id ?? null, webhookEvents: webhooks };
  }

  /** Newest first, filterable, cursor-paged on id. Raw payloads are never selected. */
  async listWebhookEvents(q: { status?: WebhookStatus; eventType?: string; cursor?: number; limit?: number } = {}) {
    const limit = q.limit ?? 100;
    const qb = this.events.createQueryBuilder('w').select(['w.id', 'w.provider', 'w.providerEventId', 'w.eventType', 'w.status', 'w.attempts', 'w.note', 'w.createdAt', 'w.processedAt']).orderBy('w.id', 'DESC').take(limit + 1);
    if (q.status) qb.andWhere('w.status = :st', { st: q.status });
    if (q.eventType) qb.andWhere('w.event_type = :et', { et: q.eventType });
    if (q.cursor) qb.andWhere('w.id < :c', { c: q.cursor });
    const rows = await qb.getMany();
    const items = rows.slice(0, limit);
    return { items, hasMore: rows.length > limit, lastId: items.length ? Number(items[items.length - 1].id) : null };
  }

  private refundView(r: Refund, p: Payment) { return { id: r.id, paymentId: r.paymentId, providerRefundId: r.providerRefundId, amountPaise: paiseToNumber(r.amountPaise), amountDisplay: formatInr(r.amountPaise), reason: r.reason, status: r.status, failureReason: r.failureReason, processedAt: r.processedAt, paymentStatus: p.status }; }
}
