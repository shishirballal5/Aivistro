import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { UserContext } from '../../common/auth/auth.types';
import { ClientInfo } from '../../common/decorators/params';
import { conflict, forbidden } from '../../common/errors';
import { formatInr, paiseToNumber } from '../../common/money';
import {
  ActorType, AnalyticsEvent, AuthSession, DeviceToken, EmailToken, OtpChallenge, Payment, PlaybackSession, Profile, RefreshToken, Refund, Series, Subscription,
  SubscriptionSource, SubscriptionStatus, User, UserIdentity, UserNotification, UserStatus, WatchHistory, WatchProgress, Watchlist, WatchlistItem,
} from '../../database/entities/index';
import { AuditService } from '../audit-logs/audit.service';
import { PasswordsService } from '../auth/passwords.service';
import { revokePlaybackSessions } from '../playback/playback.service';
import { paymentView } from '../payments/payments.service';
import { DeleteAccountDto } from './account-data.dto';

/** Accounts without a password must have signed in within this window to delete themselves (see `assertRecentSignIn`). */
export const RECENT_SIGN_IN_MINUTES = 10;
/** Safety cap per list in the export (a viewer will never realistically reach it). */
const EXPORT_CAP = 5000;

@Injectable()
export class AccountDataService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly passwords: PasswordsService, private readonly audit: AuditService) {}

  // ── export ──
  /** Only this user's rows, only fields the user could already see in the app. Token hashes, password hash, social subjects, device tokens and gateway order ids are never selected. */
  async exportFor(userId: string) {
    const em = this.ds.manager;
    const user = await em.getRepository(User).findOneByOrFail({ id: userId });
    const profile = await em.getRepository(Profile).findOneBy({ userId });
    const take = EXPORT_CAP;
    const [identities, sessions, subs, payments, history, progress, watchlist, inbox, devices] = await Promise.all([
      em.getRepository(UserIdentity).find({ where: { userId }, select: ['provider', 'createdAt'] }),
      em.getRepository(AuthSession).find({ where: { userId }, order: { id: 'DESC' }, take, select: ['id', 'deviceName', 'userAgent', 'createdAt', 'lastSeenAt', 'revokedAt', 'expiresAt'] }),
      em.getRepository(Subscription).find({ where: { userId }, relations: { plan: true }, order: { id: 'DESC' }, take }),
      em.getRepository(Payment).find({ where: { userId }, order: { id: 'DESC' }, take }),
      em.getRepository(WatchHistory).find({ where: { userId }, order: { lastWatchedAt: 'DESC' }, take }),
      em.getRepository(WatchProgress).find({ where: { userId }, order: { lastWatchedAt: 'DESC' }, take }),
      em.getRepository(WatchlistItem).createQueryBuilder('i').innerJoin(Watchlist, 'w', 'w.id = i.watchlist_id').where('w.user_id = :userId', { userId }).orderBy('i.id', 'DESC').take(take).getMany(),
      em.getRepository(UserNotification).find({ where: { userId }, order: { id: 'DESC' }, take }),
      em.getRepository(DeviceToken).find({ where: { userId }, select: ['platform', 'createdAt', 'lastSeenAt', 'revokedAt'] }),
    ]);
    const refunds = payments.length ? await em.getRepository(Refund).find({ where: { paymentId: In(payments.map((p) => p.id)) }, order: { id: 'ASC' } }) : [];
    const seriesIds = [...new Set([...history.map((h) => h.seriesId), ...progress.map((p) => p.seriesId), ...watchlist.map((w) => w.seriesId)])];
    const titles = new Map((seriesIds.length ? await em.getRepository(Series).find({ where: { id: In(seriesIds) }, select: ['id', 'title'] }) : []).map((s) => [s.id, s.title]));
    const now = new Date();
    return {
      generatedAt: now.toISOString(),
      profile: {
        id: user.id, displayName: profile?.displayName ?? null, email: user.email, emailVerified: !!user.emailVerifiedAt, phone: user.phone, phoneVerified: !!user.phoneVerifiedAt,
        dateOfBirth: profile?.dateOfBirth ?? null, language: profile?.language ?? null, avatarUrl: profile?.avatarUrl ?? null, notificationPreferences: profile?.notificationPreferences ?? null,
        hasPassword: !!user.passwordHash, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
      },
      identities: identities.map((i) => ({ provider: i.provider, linkedAt: i.createdAt })),
      sessions: sessions.map((s) => ({ deviceName: s.deviceName, userAgent: s.userAgent, createdAt: s.createdAt, lastUsedAt: s.lastSeenAt, active: !s.revokedAt && s.expiresAt > now })),
      subscriptions: subs.map((s) => ({ id: s.id, planName: s.plan?.name ?? null, status: s.status, source: s.source, startsAt: s.startsAt, endsAt: s.endsAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelledAt: s.cancelledAt, paymentId: s.paymentId })),
      payments: payments.map((p) => ({ ...paymentView(p), provider: p.provider, receipt: p.receipt })),
      refunds: refunds.map((r) => ({ id: r.id, paymentId: r.paymentId, amountPaise: paiseToNumber(r.amountPaise), amountDisplay: formatInr(r.amountPaise), reason: r.reason, status: r.status, createdAt: r.createdAt, processedAt: r.processedAt })),
      watchHistory: history.map((h) => ({ seriesId: h.seriesId, seriesTitle: titles.get(h.seriesId) ?? null, lastEpisodeNumber: h.lastEpisodeNumber, lastPositionSeconds: h.lastPositionSeconds, episodesCompleted: h.episodesCompleted, lastWatchedAt: h.lastWatchedAt })),
      watchProgress: progress.map((p) => ({ episodeId: p.episodeId, seriesId: p.seriesId, seriesTitle: titles.get(p.seriesId) ?? null, positionSeconds: p.positionSeconds, durationSeconds: p.durationSeconds, completed: p.completed, lastWatchedAt: p.lastWatchedAt })),
      watchlist: watchlist.map((w) => ({ seriesId: w.seriesId, seriesTitle: titles.get(w.seriesId) ?? null, addedAt: w.addedAt })),
      notifications: inbox.map((n) => ({ title: n.title, body: n.body, category: n.category, read: !!n.readAt, createdAt: n.createdAt })),
      devices: devices.map((d) => ({ platform: d.platform, registeredAt: d.createdAt, lastSeenAt: d.lastSeenAt, active: !d.revokedAt })),
    };
  }

  // ── delete ──
  /**
   * Proof it is really the owner (see the two paths below), then ONE transaction that erases personal data and keeps financial records.
   * - Password accounts: the current password, checked server-side.
   * - Phone/social-only accounts have no secret we can ask for, so the honest substitute is "recently authenticated": the session
   *   making this request must have been CREATED (a real OTP / social sign-in, not a token refresh) within RECENT_SIGN_IN_MINUTES.
   *   Refreshing does not renew `createdAt`, so a stolen long-lived session cannot delete the account; the user is told to sign in again.
   */
  async deleteAccount(ctx: UserContext, dto: DeleteAccountDto, client: ClientInfo): Promise<void> {
    const user = await this.ds.getRepository(User).findOneByOrFail({ id: ctx.userId });
    if (user.passwordHash) {
      if (!dto.password || !(await this.passwords.verify(user.passwordHash, dto.password))) throw forbidden('PASSWORD_INCORRECT', 'Enter your current password to delete your account.');
    } else {
      const session = await this.ds.getRepository(AuthSession).findOneBy({ id: ctx.sessionId });
      if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MINUTES * 60_000) throw forbidden('REAUTH_REQUIRED', `For your security, sign in again and then delete your account within ${RECENT_SIGN_IN_MINUTES} minutes.`);
    }

    const hadPaid = await this.ds.transaction(async (em) => {
      const locked = await em.getRepository(User).createQueryBuilder('u').setLock('pessimistic_write').where('u.id = :id', { id: ctx.userId }).getOne();
      if (!locked || locked.status !== UserStatus.Active) throw forbidden('ACCOUNT_NOT_ACTIVE', 'This account cannot be deleted right now.');
      const paid = await this.hasActivePaidSubscription(em, ctx.userId); // re-checked under the lock so a payment landing meanwhile is not missed
      if (paid && dto.acknowledgeLostAccess !== true) throw conflict('ACTIVE_SUBSCRIPTION', 'You have an active paid subscription. Deleting your account ends your access immediately and the remaining time is not refunded automatically. Confirm that you accept this to continue.');
      await this.erase(em, locked);
      return paid;
    });
    // No personal data: the actor id is only the (now anonymous) tombstone id; no IP, no email, no name.
    await this.audit.record({ actorType: ActorType.User, actorId: ctx.userId, action: 'account.delete', entityType: 'user', entityId: ctx.userId, metadata: { selfService: true, hadActivePaidSubscription: hadPaid }, requestId: client.requestId });
  }

  private async hasActivePaidSubscription(em: EntityManager, userId: string): Promise<boolean> {
    return em.getRepository(Subscription).createQueryBuilder('s').where('s.user_id = :userId AND s.status = :st AND s.source = :src AND s.ends_at > :now', { userId, st: SubscriptionStatus.Active, src: SubscriptionSource.Purchase, now: new Date() }).getExists();
  }

  private async erase(em: EntityManager, user: User): Promise<void> {
    const userId = user.id;
    const now = new Date();
    // Sign-in state: deleting the session rows kills every access token (guard finds no session) and, via the FK cascade, every refresh token.
    await em.query('DELETE rt FROM refresh_tokens rt INNER JOIN auth_sessions s ON s.id = rt.session_id WHERE s.user_id = ?', [userId]);
    await em.getRepository(AuthSession).delete({ userId });
    await em.getRepository(EmailToken).delete({ userId });
    if (user.phone) await em.getRepository(OtpChallenge).delete({ destination: user.phone });
    await em.getRepository(UserIdentity).delete({ userId });
    await em.getRepository(DeviceToken).delete({ userId });
    await em.getRepository(UserNotification).delete({ userId });
    await em.getRepository(WatchProgress).delete({ userId });
    await em.getRepository(WatchHistory).delete({ userId });
    await em.query('DELETE wi FROM watchlist_items wi INNER JOIN watchlists w ON w.id = wi.watchlist_id WHERE w.user_id = ?', [userId]);
    await em.getRepository(Watchlist).delete({ userId });
    // Playback rows are kept (they reference the user) but stopped and stripped of network details.
    await revokePlaybackSessions(em, userId, 'account_deleted');
    await em.getRepository(PlaybackSession).update({ userId }, { ipAddress: null, userAgent: null, endedAt: now });
    await em.getRepository(AnalyticsEvent).update({ userId }, { userId: null });
    await em.getRepository(Profile).update({ userId }, { displayName: 'Deleted user', avatarUrl: null, dateOfBirth: null });
    // Tombstone. Payments, refunds, subscriptions and entitlements keep pointing at this row (financial records must be retained).
    await em.getRepository(User).update(userId, {
      phone: null, phoneVerifiedAt: null, email: null, emailVerifiedAt: null, passwordHash: null, status: UserStatus.Deleted,
      failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, suspendedReason: null, suspendedAt: null, deletedAt: now,
    });
  }
}
