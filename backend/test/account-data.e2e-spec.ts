import { NestExpressApplication } from '@nestjs/platform-express';
import { AnalyticsEvent, AuditLog, AuthSession, DeviceToken, EmailToken, Payment, PlaybackSession, Profile, RefreshToken, Refund, Subscription, User, UserIdentity, UserNotification, UserStatus, WatchHistory, WatchProgress, Watchlist, WatchlistItem } from '../src/database/entities/index';
import { RECENT_SIGN_IN_MINUTES } from '../src/modules/account-data/account-data.service';
import { createApp } from './helpers';
import { addReadyAsset, adminToken, bearer, dsOf, GOOD_PASSWORD, http, registerVerifiedViewer, resetData, subscribedViewer, uniqueEmail, viewerViaOtp } from './factories';

describe('account data rights: export and self-service deletion (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let admin: string;
  beforeAll(async () => { app = await createApp(); });
  beforeEach(async () => { await resetData(app); admin = await adminToken(app, ['SUPER_ADMIN']); });
  afterAll(async () => { await app.close(); });

  const api = (p: string) => `/api/v1${p}`;
  const repo = <T extends object>(e: new () => T) => dsOf(app).getRepository(e);
  let n = 0; const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;

  async function emailViewer() {
    const { email, password } = await registerVerifiedViewer(app);
    const r = await http(app).post(api('/auth/login')).send({ email, password, deviceName: 'laptop' }).expect(200);
    return { email, password, token: r.body.accessToken as string, refreshToken: r.body.refreshToken as string, id: r.body.user.id as string };
  }

  /** A published series with one episode that has a READY video. */
  async function series() {
    const editor = await adminToken(app, ['EDITOR']);
    const g = (await http(app).post(api('/admin/genres')).set(bearer(admin)).send({ name: uniq('G') }).expect(201)).body;
    const s = (await http(app).post(api('/admin/series')).set(bearer(editor)).send({ title: uniq('Show'), synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body as { id: string; title: string };
    const e = (await http(app).post(api(`/admin/series/${s.id}/episodes`)).set(bearer(editor)).send({ title: 'Ep 1' }).expect(201)).body as { id: string };
    await dsOf(app).query("UPDATE episodes SET status = 'PUBLISHED', published_at = NOW(3) WHERE id = ?", [e.id]);
    await addReadyAsset(app, e.id);
    await http(app).post(api(`/admin/series/${s.id}/publish`)).set(bearer(editor)).expect(200);
    return { series: s, episode: e };
  }

  /** Fills every kind of data the export/deletion must handle. */
  async function populate(userId: string, token: string, s: Awaited<ReturnType<typeof series>>) {
    await http(app).put(api(`/me/watchlist/${s.series.id}`)).set(bearer(token)).expect(200);
    await repo(WatchHistory).save({ userId, seriesId: s.series.id, lastEpisodeId: s.episode.id, lastEpisodeNumber: 1, lastPositionSeconds: 42, lastCompleted: false, episodesCompleted: 0, lastWatchedAt: new Date() });
    await repo(WatchProgress).save({ userId, episodeId: s.episode.id, seriesId: s.series.id, positionSeconds: 42, durationSeconds: 300, completed: false, lastWatchedAt: new Date() });
    await repo(UserNotification).save({ userId, notificationId: null, title: 'Hello', body: 'Welcome aboard', category: 'MARKETING' as never, data: null, readAt: null });
    await http(app).put(api('/me/devices')).set(bearer(token)).send({ token: `fcm-${userId}-secret-device-token`, platform: 'android' }).expect(204);
    await http(app).post(api(`/episodes/${s.episode.id}/playback-session`)).set(bearer(token)).expect(201);
  }

  describe('GET /me/export', () => {
    it('returns the viewer\'s own data only, with no hashes, tokens or gateway secrets, and is not cacheable', async () => {
      const s = await series();
      const a = await subscribedViewer(app); const b = await subscribedViewer(app);
      await populate(a.id, a.token, s); await populate(b.id, b.token, s);
      const aUser = await repo(User).findOneByOrFail({ id: a.id }); const bUser = await repo(User).findOneByOrFail({ id: b.id });
      await repo(Profile).update({ userId: b.id }, { displayName: 'Bee Secretperson' });
      await repo(UserIdentity).save({ userId: a.id, provider: 'google' as never, subject: 'google-subject-AAA', email: null });
      const payment = await repo(Payment).findOneByOrFail({ userId: a.id });
      await repo(Refund).save({ paymentId: payment.id, providerRefundId: 'rfnd_A1', amountPaise: '100', reason: 'goodwill', status: 'PROCESSED' as never, requestedByAdminId: null, failureReason: null, processedAt: new Date() });

      const res = await http(app).get(api('/me/export')).set(bearer(a.token)).expect(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      const doc = res.body;
      expect(Date.parse(doc.generatedAt)).not.toBeNaN();
      expect(doc.profile).toMatchObject({ id: a.id, phone: aUser.phone, email: aUser.email, dateOfBirth: '1990-01-01', language: 'hi', hasPassword: false });
      expect(doc.profile.notificationPreferences).toEqual({ marketing: true, newEpisodes: true, billing: true });
      expect(doc.identities).toEqual([expect.objectContaining({ provider: 'google' })]);
      expect(doc.sessions.length).toBeGreaterThanOrEqual(1);
      expect(doc.sessions[0]).toHaveProperty('deviceName'); expect(doc.sessions[0]).toHaveProperty('lastUsedAt');
      expect(doc.subscriptions).toHaveLength(1);
      expect(doc.payments).toHaveLength(1);
      expect(doc.payments[0]).toMatchObject({ amountPaise: 14900, amountDisplay: expect.stringContaining('149'), status: 'CAPTURED', planCode: 'monthly' });
      expect(doc.refunds).toEqual([expect.objectContaining({ amountPaise: 100, status: 'PROCESSED' })]);
      expect(doc.watchHistory).toHaveLength(1); expect(doc.watchProgress).toHaveLength(1);
      expect(doc.watchlist).toEqual([expect.objectContaining({ seriesId: s.series.id, seriesTitle: s.series.title })]);
      expect(doc.notifications).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Hello' })]));
      expect(doc.devices).toEqual([expect.objectContaining({ platform: 'android', active: true })]);

      // Nothing from the other viewer, and nothing secret anywhere in the document.
      const text = JSON.stringify(doc);
      for (const leak of [b.id === a.id ? 'x' : bUser.phone!, bUser.email!, 'Bee Secretperson', `fcm-${b.id}-`]) expect(text).not.toContain(leak);
      const secrets = [a.token, a.refreshToken, 'google-subject-AAA', `fcm-${a.id}-secret-device-token`, 'argon2', 'tokenHash', 'token_hash', 'passwordHash', 'password_hash', 'providerOrderId', 'order_'];
      for (const secret of secrets) expect(text).not.toContain(secret);
      const sessionHash = (await repo(RefreshToken).find())[0].tokenHash; expect(text).not.toContain(sessionHash);
      await http(app).get(api('/me/export')).expect(401);
    });
  });

  describe('DELETE /me', () => {
    const del = (token: string, body: object) => http(app).delete(api('/me')).set(bearer(token)).send(body);

    it('rejects a missing or wrong confirmation word', async () => {
      const v = await emailViewer();
      await del(v.token, {}).expect(400);
      await del(v.token, { confirm: 'delete', password: v.password }).expect(400);
      await del(v.token, { password: v.password }).expect(400);
      await http(app).delete(api('/me')).send({ confirm: 'DELETE' }).expect(401);
      expect((await repo(User).findOneByOrFail({ id: v.id })).status).toBe(UserStatus.Active);
    });

    it('password accounts must supply the current password (wrong, missing: 403 and nothing changes)', async () => {
      const v = await emailViewer();
      expect((await del(v.token, { confirm: 'DELETE' }).expect(403)).body.code).toBe('PASSWORD_INCORRECT');
      expect((await del(v.token, { confirm: 'DELETE', password: 'not-my-password-1' }).expect(403)).body.code).toBe('PASSWORD_INCORRECT');
      const u = await repo(User).findOneByOrFail({ id: v.id });
      expect(u.status).toBe(UserStatus.Active); expect(u.email).toBe(v.email);
      await http(app).get(api('/me')).set(bearer(v.token)).expect(200); // still signed in
      const me = (await http(app).get(api('/me')).set(bearer(v.token)).expect(200)).body;
      expect(me.hasPassword).toBe(true);
    });

    it('phone/social-only accounts need a sign-in from the last 10 minutes; a refreshed old session is not enough', async () => {
      const v = await viewerViaOtp(app);
      expect((await http(app).get(api('/me')).set(bearer(v.accessToken)).expect(200)).body.hasPassword).toBe(false);
      await repo(AuthSession).update({ userId: v.user.id }, { createdAt: new Date(Date.now() - (RECENT_SIGN_IN_MINUTES + 1) * 60_000) });
      expect((await del(v.accessToken, { confirm: 'DELETE' }).expect(403)).body.code).toBe('REAUTH_REQUIRED');
      // A token refresh rotates the refresh token but does not renew the sign-in time.
      const r = await http(app).post(api('/auth/refresh')).send({ refreshToken: v.refreshToken }).expect(200);
      expect((await del(r.body.accessToken, { confirm: 'DELETE' }).expect(403)).body.code).toBe('REAUTH_REQUIRED');
      expect((await repo(User).findOneByOrFail({ id: v.user.id })).status).toBe(UserStatus.Active);
    });

    it('a fresh phone sign-in can delete without a password', async () => {
      const v = await viewerViaOtp(app);
      await del(v.accessToken, { confirm: 'DELETE' }).expect(204);
      expect((await repo(User).findOneByOrFail({ id: v.user.id })).status).toBe(UserStatus.Deleted);
    });

    it('refuses while a paid subscription is active unless the loss of access is acknowledged; payments and subscriptions are kept', async () => {
      const v = await subscribedViewer(app);
      const refused = await del(v.token, { confirm: 'DELETE' }).expect(409);
      expect(refused.body.code).toBe('ACTIVE_SUBSCRIPTION');
      expect(refused.body.message).toMatch(/not refunded automatically/i);
      await del(v.token, { confirm: 'DELETE', acknowledgeLostAccess: false }).expect(409);
      expect((await repo(User).findOneByOrFail({ id: v.id })).status).toBe(UserStatus.Active);

      const paymentsBefore = await repo(Payment).find({ where: { userId: v.id } });
      const subsBefore = await repo(Subscription).find({ where: { userId: v.id } });
      expect(paymentsBefore).toHaveLength(1);
      await del(v.token, { confirm: 'DELETE', acknowledgeLostAccess: true }).expect(204);
      expect(await repo(Payment).find({ where: { userId: v.id } })).toHaveLength(1);
      expect((await repo(Payment).findOneByOrFail({ userId: v.id })).amountPaise).toBe(paymentsBefore[0].amountPaise);
      expect(await repo(Subscription).find({ where: { userId: v.id } })).toHaveLength(subsBefore.length);
    });

    it('erases personal data in one go, keeps financial rows on the tombstone, and every old token dies', async () => {
      const s = await series();
      const v = await subscribedViewer(app); const other = await subscribedViewer(app);
      await populate(v.id, v.token, s); await populate(other.id, other.token, s);
      await repo(UserIdentity).save({ userId: v.id, provider: 'google' as never, subject: 'g-sub-1', email: 'x@gmail.com' });
      await repo(AnalyticsEvent).save({ userId: v.id, eventType: 'app_open', entityType: null, entityId: null, properties: null });
      await repo(EmailToken).save({ userId: v.id, purpose: 'VERIFY_EMAIL' as never, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 1e6), usedAt: null });
      const second = await http(app).post(api('/auth/refresh')).send({ refreshToken: v.refreshToken }).expect(200); // a second live token pair
      const before = { other: await snapshot(other.id) };

      await del(v.token, { confirm: 'DELETE', acknowledgeLostAccess: true }).expect(204);

      const u = await repo(User).findOneByOrFail({ id: v.id });
      expect(u).toMatchObject({ phone: null, email: null, passwordHash: null, phoneVerifiedAt: null, emailVerifiedAt: null, status: UserStatus.Deleted });
      expect(u.deletedAt).not.toBeNull();
      const p = await repo(Profile).findOneByOrFail({ userId: v.id });
      expect(p).toMatchObject({ displayName: 'Deleted user', avatarUrl: null, dateOfBirth: null });
      for (const e of [AuthSession, DeviceToken, UserNotification, WatchHistory, WatchProgress, UserIdentity, EmailToken, Watchlist] as const) expect(await repo(e as never).count({ where: { userId: v.id } as never })).toBe(0);
      expect(await dsOf(app).query('SELECT COUNT(*) AS c FROM refresh_tokens rt JOIN auth_sessions s ON s.id = rt.session_id WHERE s.user_id = ?', [v.id])).toEqual([{ c: '0' }]);
      expect(await repo(AnalyticsEvent).count({ where: { userId: v.id } })).toBe(0);
      const play = await repo(PlaybackSession).find({ where: { userId: v.id } });
      expect(play).toHaveLength(1); expect(play[0].endedAt).not.toBeNull(); expect(play[0].ipAddress).toBeNull(); expect(play[0].userAgent).toBeNull();
      // Financial records stay, attached to the tombstone.
      expect(await repo(Payment).count({ where: { userId: v.id } })).toBe(1);
      expect(await repo(Subscription).count({ where: { userId: v.id } })).toBe(1);

      // Every old credential is dead.
      expect((await http(app).get(api('/me')).set(bearer(v.token)).expect(401)).body.code).toBeDefined();
      await http(app).get(api('/me')).set(bearer(second.body.accessToken)).expect(401);
      await http(app).post(api('/auth/refresh')).send({ refreshToken: second.body.refreshToken }).expect(401);
      await http(app).get(api('/me/export')).set(bearer(v.token)).expect(401);
      // Another viewer is untouched.
      expect(await snapshot(other.id)).toEqual(before.other);
      await http(app).get(api('/me')).set(bearer(other.token)).expect(200);
    });

    async function snapshot(userId: string) {
      const c = (e: new () => object, where: object = { userId }) => repo(e as never).count({ where: where as never });
      return { sessions: await c(AuthSession), devices: await c(DeviceToken), inbox: await c(UserNotification), history: await c(WatchHistory), progress: await c(WatchProgress), watchlist: await c(Watchlist), payments: await c(Payment), subs: await c(Subscription), user: await repo(User).findOneByOrFail({ id: userId }).then((u) => ({ phone: u.phone, email: u.email, status: u.status })), name: (await repo(Profile).findOneByOrFail({ userId })).displayName };
    }

    it('the same email and phone can register again as brand-new accounts', async () => {
      const e = await emailViewer();
      await del(e.token, { confirm: 'DELETE', password: e.password }).expect(204);
      await http(app).post(api('/auth/login')).send({ email: e.email, password: e.password }).expect(401); // the old account no longer signs in
      await registerVerifiedViewer(app, e.email, 'another-strong-pass-77');
      const again = await http(app).post(api('/auth/login')).send({ email: e.email, password: 'another-strong-pass-77' }).expect(200);
      expect(again.body.user.id).not.toBe(e.id);
      expect((await repo(User).findOneByOrFail({ id: e.id })).status).toBe(UserStatus.Deleted);

      const v = await viewerViaOtp(app);
      const phone = v.phone;
      await del(v.accessToken, { confirm: 'DELETE' }).expect(204);
      const v2 = await viewerViaOtp(app, phone);
      expect(v2.user.id).not.toBe(v.user.id);
      expect(await repo(User).count({ where: { status: UserStatus.Deleted } })).toBe(2);
      // The new account starts empty.
      const doc = (await http(app).get(api('/me/export')).set(bearer(v2.accessToken)).expect(200)).body;
      expect(doc.payments).toEqual([]); expect(doc.watchlist).toEqual([]);
    });

    it('is a double-delete safe no-op for a dead session and writes an audit row with no personal data', async () => {
      const e = await emailViewer();
      const profile = await repo(Profile).findOneByOrFail({ userId: e.id });
      await del(e.token, { confirm: 'DELETE', password: e.password }).expect(204);
      await del(e.token, { confirm: 'DELETE', password: e.password }).expect(401);
      const rows = await repo(AuditLog).find({ where: { action: 'account.delete' } });
      expect(rows).toHaveLength(1);
      const text = JSON.stringify(rows[0]);
      expect(rows[0]).toMatchObject({ actorType: 'USER', actorId: e.id, entityId: e.id, ipAddress: null });
      for (const pii of [e.email, profile.displayName, e.password, '127.0.0.1', '::1']) expect(text).not.toContain(pii);
    });

    it('admin user list and detail still render the tombstone', async () => {
      const e = await emailViewer();
      await del(e.token, { confirm: 'DELETE', password: e.password }).expect(204);
      const detail = (await http(app).get(api(`/admin/users/${e.id}`)).set(bearer(admin)).expect(200)).body;
      expect(detail).toMatchObject({ id: e.id, status: 'DELETED', displayName: 'Deleted user', email: null, phone: null, emailVerified: false });
      expect(detail.deletedAt).toBeTruthy();
      const list = (await http(app).get(api('/admin/users?status=DELETED')).set(bearer(admin)).expect(200)).body;
      expect(list.items).toEqual([expect.objectContaining({ id: e.id, displayName: 'Deleted user', status: 'DELETED' })]);
      // Admin actions on a tombstone are refused cleanly.
      await http(app).post(api(`/admin/users/${e.id}/suspend`)).set(bearer(admin)).send({}).expect(404);
      await http(app).post(api(`/admin/users/${e.id}/restore`)).set(bearer(admin)).expect(404);
    });
  });
});
