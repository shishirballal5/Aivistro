import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, MoreThan, Repository } from 'typeorm';
import { DomainCode } from '../../common/constants/error-codes';
import { badRequest, conflict } from '../../common/errors';
import { formatInr, paiseToNumber } from '../../common/money';
import { addMonthsUtc, contiguousEnd } from '../../common/time';
import { Entitlement, Payment, Subscription, SubscriptionPlan, SubscriptionSource, SubscriptionStatus, User } from '../../database/entities/index';
import { loadUserBriefs } from '../users/user-brief';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';

export const planView = (p: SubscriptionPlan) => ({ id: p.id, code: p.code, name: p.name, description: p.description, durationMonths: p.durationMonths, pricePaise: paiseToNumber(p.pricePaise), priceDisplay: formatInr(p.pricePaise), currency: p.currency, active: p.active, sortOrder: p.sortOrder });
export const subscriptionView = (s: Subscription, planName?: string) => ({ id: s.id, planName: planName ?? s.plan?.name ?? null, status: s.status, source: s.source, startsAt: s.startsAt, endsAt: s.endsAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelledAt: s.cancelledAt });

export interface UpgradeCredit { creditPaise: bigint; fromSubscriptionId: string; fromPlanName: string | null; fromEndsAt: Date }

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(SubscriptionPlan) private readonly plans: Repository<SubscriptionPlan>,
    @InjectRepository(Subscription) private readonly subs: Repository<Subscription>,
    @InjectRepository(Payment) private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(Entitlement) private readonly entitlements: Repository<Entitlement>,
  ) {}

  // ── plans ──
  async listActivePlans() { return (await this.plans.find({ where: { active: true }, order: { sortOrder: 'ASC', id: 'ASC' } })).map(planView); }
  async listAllPlans() { return (await this.plans.find({ order: { sortOrder: 'ASC', id: 'ASC' } })).map(planView); }
  async createPlan(dto: CreatePlanDto) {
    if (await this.plans.exists({ where: { code: dto.code } })) throw conflict('PLAN_CODE_TAKEN', 'A plan with this code already exists');
    return planView(await this.plans.save({ code: dto.code, name: dto.name, description: dto.description ?? '', durationMonths: dto.durationMonths, pricePaise: String(dto.pricePaise), currency: 'INR', active: true, sortOrder: dto.sortOrder ?? 0 }));
  }
  /** Editing a price only affects FUTURE purchases: existing payments snapshot their own price and duration. */
  async updatePlan(id: string, dto: UpdatePlanDto) {
    const p = await this.plans.findOne({ where: { id } });
    if (!p) throw new NotFoundException();
    if (dto.name !== undefined) p.name = dto.name;
    if (dto.description !== undefined) p.description = dto.description;
    if (dto.pricePaise !== undefined) p.pricePaise = String(dto.pricePaise);
    if (dto.active !== undefined) p.active = dto.active;
    if (dto.sortOrder !== undefined) p.sortOrder = dto.sortOrder;
    return planView(await this.plans.save(p));
  }

  // ── granting access ──
  /**
   * Creates the subscription + entitlement for a captured payment. MUST be called inside a transaction in which the payment
   * row is already locked. Periods stack: a new period starts when the current one ends (never overlaps, never wastes days).
   * The user row is locked first so two payments for one user activating at the same moment are serialised.
   */
  async grantFromPayment(em: EntityManager, payment: Payment, now = new Date()): Promise<Subscription> {
    return this.createPeriod(em, { userId: payment.userId, planId: payment.planId, months: payment.durationMonths, paymentId: payment.id, source: SubscriptionSource.Purchase, replaceSubscriptionId: payment.upgradeFromSubscriptionId }, now);
  }

  async grantByAdmin(adminId: string, userId: string, planCode: string, reason: string) {
    const plan = await this.plans.findOne({ where: { code: planCode } });
    if (!plan) throw badRequest('PLAN_NOT_FOUND', 'Unknown plan');
    return this.ds.transaction(async (em) => {
      if (!(await em.getRepository(User).exists({ where: { id: userId } }))) throw new NotFoundException();
      const sub = await this.createPeriod(em, { userId, planId: plan.id, months: plan.durationMonths, paymentId: null, source: SubscriptionSource.AdminGrant, grantedByAdminId: adminId, grantReason: reason });
      return subscriptionView(sub, plan.name);
    });
  }

  /**
   * Credit for replacing the user's CURRENT paid plan with a longer one. Null (a plain extension, periods stack) unless the user has
   * exactly one running period that was bought (not granted), has not been stacked on, and the new plan is strictly longer.
   * credit = what they actually paid (net of refunds) x the unused share of the period, rounded DOWN in whole paise.
   */
  async upgradeCredit(userId: string, targetMonths: number, now = new Date()): Promise<UpgradeCredit | null> {
    const live = await this.entitlements.find({ where: { userId, revokedAt: IsNull(), endsAt: MoreThan(now) }, order: { startsAt: 'ASC' } });
    if (live.length !== 1 || live[0].startsAt > now) return null;
    const ent = live[0];
    const sub = await this.subs.findOne({ where: { id: ent.subscriptionId }, relations: { plan: true } });
    if (!sub || sub.status !== SubscriptionStatus.Active || sub.source !== SubscriptionSource.Purchase || !sub.paymentId) return null;
    const pay = await this.paymentsRepo.findOne({ where: { id: sub.paymentId } });
    if (!pay || targetMonths <= pay.durationMonths) return null;
    const paid = BigInt(pay.amountPaise) - BigInt(pay.refundedPaise);
    const total = BigInt(ent.endsAt.getTime() - ent.startsAt.getTime());
    const remaining = BigInt(ent.endsAt.getTime() - now.getTime());
    if (paid <= 0n || total <= 0n || remaining <= 0n) return null;
    return { creditPaise: (paid * remaining) / total, fromSubscriptionId: sub.id, fromPlanName: sub.plan?.name ?? null, fromEndsAt: ent.endsAt };
  }

  private async createPeriod(em: EntityManager, o: { userId: string; planId: string; months: number; paymentId: string | null; source: SubscriptionSource; grantedByAdminId?: string; grantReason?: string; replaceSubscriptionId?: string | null }, now = new Date()): Promise<Subscription> {
    await em.getRepository(User).findOne({ where: { id: o.userId }, lock: { mode: 'pessimistic_write' } });
    if (o.replaceSubscriptionId) {
      // Upgrade: end the replaced period NOW (in this same transaction) so the new one starts now instead of stacking after it.
      const old = await em.getRepository(Subscription).findOne({ where: { id: o.replaceSubscriptionId, userId: o.userId }, lock: { mode: 'pessimistic_write' } });
      if (old && old.status === SubscriptionStatus.Active && old.endsAt > now) {
        if (o.paymentId) await em.getRepository(Payment).update(o.paymentId, { upgradeReplacedEndsAt: old.endsAt });
        await em.getRepository(Subscription).update(old.id, { status: SubscriptionStatus.Expired, endsAt: now, cancelledAt: now });
        await em.getRepository(Entitlement).createQueryBuilder().update().set({ endsAt: now, revokedReason: 'UPGRADED' }).where('subscription_id = :id AND revoked_at IS NULL', { id: old.id }).execute();
      }
    }
    // LOCKING read on purpose. A plain SELECT here would use the transaction's earlier snapshot and miss a period that a concurrent
    // activation committed while we waited for the user lock, so two simultaneous payments would overlap and lose paid time.
    const live = await em.getRepository(Entitlement).createQueryBuilder('e').setLock('pessimistic_write').where('e.user_id = :u AND e.revoked_at IS NULL AND e.ends_at > :now', { u: o.userId, now }).getMany();
    const latestEnd = live.reduce<Date | null>((max, e) => (max === null || e.endsAt > max ? e.endsAt : max), null);
    const startsAt = latestEnd && latestEnd > now ? latestEnd : now;
    const endsAt = addMonthsUtc(startsAt, o.months);
    const sub = await em.getRepository(Subscription).save({ userId: o.userId, planId: o.planId, paymentId: o.paymentId, source: o.source, status: SubscriptionStatus.Active, startsAt, endsAt, cancelledAt: null, cancelAtPeriodEnd: false, grantedByAdminId: o.grantedByAdminId ?? null, grantReason: o.grantReason ?? null });
    await em.getRepository(Entitlement).insert({ userId: o.userId, subscriptionId: sub.id, startsAt, endsAt, revokedAt: null, revokedReason: null });
    return sub;
  }

  /**
   * Undoes an upgrade after its payment was fully refunded: the plan it replaced comes back with its ORIGINAL end date, if that is still
   * in the future and the plan was only ended by the upgrade (not revoked for another reason).
   */
  async restoreReplacedByUpgrade(em: EntityManager, payment: Payment, now = new Date()): Promise<boolean> {
    if (!payment.upgradeFromSubscriptionId || !payment.upgradeReplacedEndsAt || payment.upgradeReplacedEndsAt <= now) return false;
    const old = await em.getRepository(Subscription).findOne({ where: { id: payment.upgradeFromSubscriptionId, userId: payment.userId }, lock: { mode: 'pessimistic_write' } });
    if (!old || old.status !== SubscriptionStatus.Expired || !old.cancelledAt) return false;
    const restored = await em.getRepository(Entitlement).createQueryBuilder().update().set({ endsAt: payment.upgradeReplacedEndsAt, revokedReason: null })
      .where("subscription_id = :id AND revoked_at IS NULL AND revoked_reason = 'UPGRADED'", { id: old.id }).execute();
    if (!restored.affected) return false;
    await em.getRepository(Subscription).update(old.id, { status: SubscriptionStatus.Active, endsAt: payment.upgradeReplacedEndsAt, cancelledAt: null });
    return true;
  }

  /** Ends a subscription's access immediately (refund, fraud, admin action). Other periods are untouched. */
  async revoke(em: EntityManager, subscriptionId: string, status: SubscriptionStatus, reason: string): Promise<void> {
    const sub = await em.getRepository(Subscription).findOneOrFail({ where: { id: subscriptionId } });
    await em.getRepository(Subscription).update(subscriptionId, { status, cancelledAt: new Date() });
    await em.getRepository(Entitlement).createQueryBuilder().update().set({ revokedAt: new Date(), revokedReason: reason }).where('subscription_id = :subscriptionId AND revoked_at IS NULL', { subscriptionId }).execute();
    // If that was their last paid period, any video they are watching stops now rather than at the next heartbeat.
    const stillEntitled = await em.getRepository(Entitlement).createQueryBuilder('e').where('e.user_id = :u AND e.revoked_at IS NULL AND e.starts_at <= NOW(3) AND e.ends_at > NOW(3)', { u: sub.userId }).getCount();
    if (!stillEntitled) await em.createQueryBuilder().update('playback_sessions').set({ revokedAt: new Date(), revokedReason: reason }).where('user_id = :u AND revoked_at IS NULL AND ended_at IS NULL', { u: sub.userId }).execute();
  }
  async revokeByAdmin(subscriptionId: string, reason: string) {
    const sub = await this.subs.findOne({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException();
    if (sub.status !== SubscriptionStatus.Active) throw conflict(DomainCode.InvalidStateTransition, 'This subscription is not active');
    await this.ds.transaction((em) => this.revoke(em, subscriptionId, SubscriptionStatus.Cancelled, reason.slice(0, 60)));
    return { id: subscriptionId, status: SubscriptionStatus.Cancelled };
  }

  // ── viewer ──
  async forUser(userId: string) {
    const now = new Date();
    const rows = await this.subs.find({ where: { userId }, relations: { plan: true }, order: { startsAt: 'DESC' }, take: 50 });
    const live = await this.entitlements.createQueryBuilder('e').where('e.user_id = :userId AND e.revoked_at IS NULL AND e.ends_at > :now', { userId, now }).orderBy('e.starts_at', 'ASC').getMany();
    const until = contiguousEnd(live, now);
    const entitled = until ? live.find((e) => e.startsAt <= now && e.endsAt > now) ?? null : null;
    const current = entitled ? rows.find((s) => s.id === entitled.subscriptionId) ?? null : null;
    return { active: !!entitled, entitledUntil: until, current: current ? subscriptionView(current) : null, history: rows.map((s) => subscriptionView(s)) };
  }

  /** Records the customer's intent not to renew. Access continues to the end of the paid period; there is no auto-renewal to stop. */
  async cancelAtPeriodEnd(userId: string) {
    const now = new Date();
    const entitled = await this.entitlements.createQueryBuilder('e').where('e.user_id = :userId AND e.revoked_at IS NULL AND e.ends_at > :now', { userId, now }).orderBy('e.ends_at', 'DESC').getOne();
    if (!entitled) throw conflict(DomainCode.InvalidStateTransition, 'You have no active subscription');
    await this.subs.update(entitled.subscriptionId, { cancelAtPeriodEnd: true });
    return this.forUser(userId);
  }

  /** Bookkeeping only (access is time-based and needs no cron): marks elapsed ACTIVE subscriptions EXPIRED. */
  async expireDue(now = new Date()): Promise<number> {
    return (await this.subs.createQueryBuilder().update().set({ status: SubscriptionStatus.Expired }).where("status = 'ACTIVE' AND ends_at <= :now", { now }).execute()).affected ?? 0;
  }

  /** Newest first, cursor-paged on id. Each row carries a compact `user` (batched lookup, tombstone-safe). */
  async adminList(q: { userId?: string; status?: SubscriptionStatus; planCode?: string; q?: string; cursor?: number; limit?: number } = {}) {
    const limit = q.limit ?? 100;
    const qb = this.subs.createQueryBuilder('s').leftJoinAndSelect('s.plan', 'plan').orderBy('s.id', 'DESC').take(limit + 1);
    if (q.userId) qb.andWhere('s.user_id = :userId', { userId: q.userId });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.planCode) qb.andWhere('plan.code = :planCode', { planCode: q.planCode });
    if (q.cursor) qb.andWhere('s.id < :cursor', { cursor: q.cursor });
    if (q.q) qb.andWhere('s.user_id IN (SELECT u.id FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id WHERE u.email LIKE :like OR u.phone LIKE :like OR pr.display_name LIKE :like)', { like: `%${q.q.replace(/[%_\\]/g, '\\$&')}%` });
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const briefs = await loadUserBriefs(this.ds.manager, page.map((s) => s.userId));
    return { items: page.map((s) => ({ ...subscriptionView(s), userId: s.userId, user: briefs.get(s.userId) ?? null, planCode: s.plan?.code ?? null, paymentId: s.paymentId, grantReason: s.grantReason })), hasMore: rows.length > limit, lastId: page.length ? Number(page[page.length - 1].id) : null };
  }
}
