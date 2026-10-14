import { NestExpressApplication } from '@nestjs/platform-express';
import { CampaignStatus, DeviceToken, Notification, NotificationCategory, User, UserNotification, UserStatus } from '../src/database/entities/index';
import { NotificationsCoreModule } from '../src/modules/notifications/notifications-core.module';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PushOutbox } from '../src/util/thirdparty/fcm/push.sender';
import { EngagementCoreModule } from '../src/modules/watch-history/engagement-core.module';
import { EngagementProcessor } from '../src/modules/watch-history/engagement.processor';
import { createApp } from './helpers';
import { adminToken, bearer, dsOf, http, resetData, subscribedViewer, viewerViaOtp } from './factories';

describe('notifications: campaigns, inbox, push and preferences (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let admin: string;
  beforeAll(async () => { app = await createApp({}, undefined, { imports: [EngagementCoreModule, NotificationsCoreModule], providers: [EngagementProcessor] }); });
  beforeEach(async () => { await resetData(app); admin = await adminToken(app, ['SUPER_ADMIN']); app.get(PushOutbox).clear(); });
  afterAll(async () => { await app.close(); });

  const api = (p: string) => `/api/v1${p}`;
  const svc = () => app.get(NotificationsService);
  const campaign = (body: object) => http(app).post(api('/admin/notifications')).set(bearer(admin)).send({ title: 'New drama', body: 'Watch it tonight', audience: 'ALL', ...body });
  const inbox = async (token: string, q = '') => (await http(app).get(api(`/me/notifications${q}`)).set(bearer(token)).expect(200)).body;
  async function waitStatus(id: string, status: CampaignStatus, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) { const c = await dsOf(app).getRepository(Notification).findOneByOrFail({ id }); if (c.status === status) return c; if (Date.now() > end) throw new Error(`campaign stuck in ${c.status}`); await new Promise((r) => setTimeout(r, 80)); }
  }

  describe('creating campaigns', () => {
    it('only roles with notifications.send can create or send; others get 403, anonymous 401', async () => {
      for (const role of ['EDITOR', 'SUPPORT', 'FINANCE']) { const t = await adminToken(app, [role]); await http(app).post(api('/admin/notifications')).set(bearer(t)).send({ title: 'x', body: 'y', audience: 'ALL' }).expect(403); await http(app).get(api('/admin/notifications')).set(bearer(t)).expect(403); }
      await http(app).post(api('/admin/notifications')).send({ title: 'x', body: 'y', audience: 'ALL' }).expect(401);
      const v = await viewerViaOtp(app);
      await http(app).post(api('/admin/notifications')).set(bearer(v.accessToken)).send({ title: 'x', body: 'y', audience: 'ALL' }).expect(401);
      await campaign({}).expect(201);
    });

    it.each([
      ['an empty title', { title: '' }], ['a huge title', { title: 'x'.repeat(121) }], ['a huge body', { body: 'x'.repeat(501) }], ['an unknown audience', { audience: 'EVERYONE' }],
      ['an unknown category', { category: 'SPAM' }], ['a past schedule', { scheduledAt: new Date(Date.now() - 60000).toISOString() }], ['a bad date', { scheduledAt: 'tomorrow' }],
      ['both sendNow and a schedule', { sendNow: true, scheduledAt: new Date(Date.now() + 3600000).toISOString() }], ['nested data', { data: { a: { b: 1 } } }],
      ['non-string data', { data: { a: 5 } }], ['too much data', { data: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) }], ['unknown fields', { recipients: ['1'] }],
    ])('rejects %s', async (_l, over) => { await campaign(over).expect(400); });

    it('creates a draft, or a scheduled campaign, and records who created it', async () => {
      const draft = (await campaign({}).expect(201)).body;
      expect(draft).toMatchObject({ status: 'DRAFT', recipientCount: 0, category: 'MARKETING' });
      const at = new Date(Date.now() + 3600_000).toISOString();
      expect((await campaign({ scheduledAt: at }).expect(201)).body).toMatchObject({ status: 'SCHEDULED' });
      const [row] = await dsOf(app).query('SELECT created_by_admin_id AS a FROM notifications WHERE id = ?', [draft.id]);
      expect(row.a).not.toBeNull();
      const [aud] = await dsOf(app).query("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'campaign.create'");
      expect(Number(aud.n)).toBe(2);
    });
  });

  describe('delivery', () => {
    async function people() {
      const sub = await subscribedViewer(app);
      const free = await viewerViaOtp(app);
      const optedOut = await viewerViaOtp(app);
      await http(app).patch(api('/me/notification-preferences')).set(bearer(optedOut.accessToken)).send({ marketing: false }).expect(200);
      const suspended = await viewerViaOtp(app);
      await dsOf(app).getRepository(User).update(suspended.user.id, { status: UserStatus.Suspended });
      await new Promise((r) => setTimeout(r, 300)); // let the subscriber's own "Premium is active" notice land, then start from a clean inbox
      await dsOf(app).query('DELETE FROM user_notifications');
      return { sub, free, optedOut, suspended };
    }

    it('ALL: reaches active users who have not opted out; skips opted-out and suspended accounts', async () => {
      const p = await people();
      const c = (await campaign({ sendNow: true }).expect(201)).body;
      const done = await waitStatus(c.id, CampaignStatus.Sent);
      expect(done.recipientCount).toBe(2);
      expect((await inbox(p.sub.token)).items[0]).toMatchObject({ title: 'New drama', body: 'Watch it tonight', category: 'MARKETING', read: false });
      expect((await inbox(p.free.accessToken)).items).toHaveLength(1);
      expect((await inbox(p.optedOut.accessToken)).items).toHaveLength(0);
      expect(await dsOf(app).getRepository(UserNotification).count({ where: { userId: p.suspended.user.id } })).toBe(0);
    });

    it('SUBSCRIBERS and NON_SUBSCRIBERS target by live entitlement', async () => {
      const p = await people();
      const a = (await campaign({ audience: 'SUBSCRIBERS', sendNow: true }).expect(201)).body; await waitStatus(a.id, CampaignStatus.Sent);
      expect((await inbox(p.sub.token)).items).toHaveLength(1);
      expect((await inbox(p.free.accessToken)).items).toHaveLength(0);
      const b = (await campaign({ audience: 'NON_SUBSCRIBERS', title: 'Subscribe', sendNow: true }).expect(201)).body; await waitStatus(b.id, CampaignStatus.Sent);
      expect((await inbox(p.sub.token)).items).toHaveLength(1);
      expect((await inbox(p.free.accessToken)).items[0].title).toBe('Subscribe');
    });

    it('a BILLING-category campaign ignores marketing opt-outs; NEW_EPISODES follows its own switch', async () => {
      const p = await people();
      const c = (await campaign({ category: 'BILLING', title: 'Price change', sendNow: true }).expect(201)).body;
      expect((await waitStatus(c.id, CampaignStatus.Sent)).recipientCount).toBe(3);
      expect((await inbox(p.optedOut.accessToken)).items.map((i: { title: string }) => i.title)).toEqual(['Price change']);
      await http(app).patch(api('/me/notification-preferences')).set(bearer(p.free.accessToken)).send({ newEpisodes: false }).expect(200);
      const e = (await campaign({ category: 'NEW_EPISODES', title: 'Episode drop', sendNow: true }).expect(201)).body; await waitStatus(e.id, CampaignStatus.Sent);
      expect((await inbox(p.free.accessToken)).items.map((i: { title: string }) => i.title)).toEqual(['Price change']);
      expect((await inbox(p.sub.token)).items.map((i: { title: string }) => i.title)).toEqual(['Episode drop', 'Price change']);
    });

    it('can only be sent once: parallel sends claim atomically, and a sent campaign cannot be re-sent or cancelled', async () => {
      await people();
      const c = (await campaign({}).expect(201)).body;
      const rs = await Promise.all([1, 2, 3, 4].map(() => http(app).post(api(`/admin/notifications/${c.id}/send`)).set(bearer(admin))));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
      await waitStatus(c.id, CampaignStatus.Sent);
      expect(await dsOf(app).getRepository(UserNotification).count({ where: { notificationId: c.id } })).toBe(2);
      await http(app).post(api(`/admin/notifications/${c.id}/send`)).set(bearer(admin)).expect(409);
      await http(app).post(api(`/admin/notifications/${c.id}/cancel`)).set(bearer(admin)).expect(409);
      await http(app).post(api('/admin/notifications/999999/send')).set(bearer(admin)).expect(404);
    });

    it('is idempotent and resumable: re-running delivery never duplicates, and a retry continues from the saved cursor', async () => {
      const a = await viewerViaOtp(app); const b = await viewerViaOtp(app); const c3 = await viewerViaOtp(app);
      const c = (await campaign({}).expect(201)).body;
      // simulate a worker that died after finishing the first user only
      await dsOf(app).query("UPDATE notifications SET status = 'SENDING', progress_cursor = ?, recipient_count = 1 WHERE id = ?", [a.user.id, c.id]);
      await dsOf(app).query('INSERT INTO user_notifications (user_id, notification_id, title, body, category) VALUES (?, ?, ?, ?, ?)', [a.user.id, c.id, 'New drama', 'Watch it tonight', 'MARKETING']);
      expect(await svc().deliver(c.id)).toEqual({ recipients: 3 });
      expect(await svc().deliver(c.id)).toEqual({ recipients: 3 }); // already SENT: a no-op
      const rows = await dsOf(app).getRepository(UserNotification).find({ where: { notificationId: c.id } });
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([a.user.id, b.user.id, c3.user.id]));
      // even a duplicate insert attempt is rejected by the unique key
      await expect(dsOf(app).getRepository(UserNotification).insert({ userId: a.user.id, notificationId: c.id, title: 't', body: 'b', category: NotificationCategory.Marketing })).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
    });

    it('a scheduled campaign waits for its time, then the dispatcher starts it; cancelling a scheduled one stops it', async () => {
      const p = await people();
      const c = (await campaign({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201)).body;
      expect(await svc().dispatchDue()).toBe(0);
      expect((await inbox(p.sub.token)).items).toHaveLength(0);
      await dsOf(app).query('UPDATE notifications SET scheduled_at = NOW(3) - INTERVAL 1 MINUTE WHERE id = ?', [c.id]);
      expect(await svc().dispatchDue()).toBe(1);
      await waitStatus(c.id, CampaignStatus.Sent);
      expect((await inbox(p.sub.token)).items).toHaveLength(1);
      const later = (await campaign({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201)).body;
      await http(app).post(api(`/admin/notifications/${later.id}/cancel`)).set(bearer(admin)).expect(200);
      await dsOf(app).query('UPDATE notifications SET scheduled_at = NOW(3) - INTERVAL 1 MINUTE WHERE id = ?', [later.id]);
      expect(await svc().dispatchDue()).toBe(0);
      expect((await dsOf(app).getRepository(Notification).findOneByOrFail({ id: later.id })).status).toBe(CampaignStatus.Cancelled);
    });

    it('fans out to 1,200 users in batches without gaps or duplicates', async () => {
      await dsOf(app).transaction(async (em) => {
        await em.query('SET SESSION cte_max_recursion_depth = 5000'); // MySQL's default limit is 1000 rows
        await em.query("INSERT INTO users (status, failed_login_count) WITH RECURSIVE n AS (SELECT 1 AS i UNION ALL SELECT i + 1 FROM n WHERE i < 1200) SELECT 'ACTIVE', 0 FROM n");
      });
      await dsOf(app).query("INSERT INTO profiles (user_id, display_name, language, notification_preferences) SELECT id, 'Bulk', 'hi', JSON_OBJECT('marketing', true, 'newEpisodes', true, 'billing', true) FROM users");
      const c = (await campaign({ sendNow: true }).expect(201)).body;
      const done = await waitStatus(c.id, CampaignStatus.Sent, 60000);
      expect(done.recipientCount).toBe(1200);
      const [r] = await dsOf(app).query('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS d FROM user_notifications WHERE notification_id = ?', [c.id]);
      expect([Number(r.n), Number(r.d)]).toEqual([1200, 1200]);
    });
  });

  describe('push', () => {
    const token = (n: string) => `fcm-token-${n}`.padEnd(40, 'x');
    it('sends to registered devices, skips users who opted out, and retires tokens of uninstalled apps', async () => {
      const a = await viewerViaOtp(app); const b = await viewerViaOtp(app); const gone = await viewerViaOtp(app);
      for (const [u, t] of [[a, token('a')], [b, token('b')], [gone, token('gone')]] as const) await http(app).put(api('/me/devices')).set(bearer(u.accessToken)).send({ token: t, platform: 'android' }).expect(204);
      await http(app).patch(api('/me/notification-preferences')).set(bearer(b.accessToken)).send({ marketing: false }).expect(200);
      app.get(PushOutbox).unregister.add(token('gone'));
      const c = (await campaign({ sendNow: true, data: { seriesId: '7' } }).expect(201)).body;
      await waitStatus(c.id, CampaignStatus.Sent);
      const sent = app.get(PushOutbox).sent;
      expect(sent.map((s) => s.token)).toEqual([token('a')]);
      expect(sent[0].message).toEqual({ title: 'New drama', body: 'Watch it tonight', data: { seriesId: '7' } });
      const goneRow = await dsOf(app).getRepository(DeviceToken).findOneByOrFail({ token: token('gone') });
      expect(goneRow.revokedAt).not.toBeNull();
    });

    it('a device token belongs to one account at a time, can be removed, and is validated', async () => {
      const a = await viewerViaOtp(app); const b = await viewerViaOtp(app);
      const t = token('shared');
      await http(app).put(api('/me/devices')).set(bearer(a.accessToken)).send({ token: t, platform: 'ios' }).expect(204);
      await http(app).put(api('/me/devices')).set(bearer(b.accessToken)).send({ token: t, platform: 'ios' }).expect(204); // the phone changed hands
      expect((await dsOf(app).getRepository(DeviceToken).findOneByOrFail({ token: t })).userId).toBe(b.user.id);
      await http(app).delete(api(`/me/devices/${t}`)).set(bearer(a.accessToken)).expect(204); // A can no longer disable B's device
      expect((await dsOf(app).getRepository(DeviceToken).findOneByOrFail({ token: t })).revokedAt).toBeNull();
      await http(app).delete(api(`/me/devices/${t}`)).set(bearer(b.accessToken)).expect(204);
      expect((await dsOf(app).getRepository(DeviceToken).findOneByOrFail({ token: t })).revokedAt).not.toBeNull();
      for (const bad of [{ token: 'short', platform: 'ios' }, { token: t, platform: 'blackberry' }, { token: `${t} spaces`, platform: 'ios' }, { token: t }]) await http(app).put(api('/me/devices')).set(bearer(b.accessToken)).send(bad).expect(400);
    });

    it('with push disabled, in-app notifications still work', async () => {
      const off = await createApp({ PUSH_PROVIDER: 'none' }, undefined, { imports: [EngagementCoreModule, NotificationsCoreModule], providers: [EngagementProcessor] });
      try {
        await resetData(off);
        const u = await viewerViaOtp(off);
        await http(off).put(api('/me/devices')).set(bearer(u.accessToken)).send({ token: token('x'), platform: 'web' }).expect(204);
        const root = await adminToken(off, ['SUPER_ADMIN']);
        const c = (await http(off).post(api('/admin/notifications')).set(bearer(root)).send({ title: 'Hi', body: 'There', audience: 'ALL', sendNow: true }).expect(201)).body;
        const end = Date.now() + 10000; let st = '';
        while (st !== 'SENT' && Date.now() < end) { st = (await dsOf(off).getRepository(Notification).findOneByOrFail({ id: c.id })).status; await new Promise((r) => setTimeout(r, 80)); }
        expect(st).toBe('SENT');
        expect((await http(off).get(api('/me/notifications')).set(bearer(u.accessToken)).expect(200)).body.items).toHaveLength(1);
        expect(off.get(PushOutbox).sent).toHaveLength(0);
      } finally { await off.close(); }
    });
  });

  describe('the inbox', () => {
    it('lists newest first with a stable cursor, filters unread, counts, and marks read (owner-scoped)', async () => {
      const u = await viewerViaOtp(app); const other = await viewerViaOtp(app);
      for (let i = 1; i <= 5; i++) await svc().notifyUser(u.user.id, { title: `N${i}`, body: 'b', category: NotificationCategory.Billing });
      expect((await http(app).get(api('/me/notifications/unread-count')).set(bearer(u.accessToken)).expect(200)).body).toEqual({ unread: 5 });
      const p1 = await inbox(u.accessToken, '?limit=2');
      expect(p1.items.map((i: { title: string }) => i.title)).toEqual(['N5', 'N4']);
      const p2 = await inbox(u.accessToken, `?limit=2&cursor=${p1.nextCursor}`);
      expect(p2.items.map((i: { title: string }) => i.title)).toEqual(['N3', 'N2']);
      await http(app).get(api('/me/notifications?cursor=junk')).set(bearer(u.accessToken)).expect(400);
      await http(app).get(api('/me/notifications?limit=500')).set(bearer(u.accessToken)).expect(400);
      await http(app).post(api(`/me/notifications/${p1.items[0].id}/read`)).set(bearer(other.accessToken)).expect(404); // not yours
      await http(app).post(api(`/me/notifications/${p1.items[0].id}/read`)).set(bearer(u.accessToken)).expect(204);
      await http(app).post(api(`/me/notifications/${p1.items[0].id}/read`)).set(bearer(u.accessToken)).expect(204); // idempotent
      expect((await inbox(u.accessToken, '?unread=true')).items).toHaveLength(4);
      await http(app).post(api('/me/notifications/read-all')).set(bearer(u.accessToken)).expect(204);
      expect((await http(app).get(api('/me/notifications/unread-count')).set(bearer(u.accessToken)).expect(200)).body).toEqual({ unread: 0 });
      expect((await inbox(other.accessToken)).items).toEqual([]);
      await http(app).get(api('/me/notifications')).expect(401);
    });

    it('preferences are readable, patchable, and strict', async () => {
      const u = await viewerViaOtp(app);
      expect((await http(app).get(api('/me/notification-preferences')).set(bearer(u.accessToken)).expect(200)).body).toEqual({ marketing: true, newEpisodes: true, billing: true });
      expect((await http(app).patch(api('/me/notification-preferences')).set(bearer(u.accessToken)).send({ marketing: false }).expect(200)).body).toEqual({ marketing: false, newEpisodes: true, billing: true });
      await http(app).patch(api('/me/notification-preferences')).set(bearer(u.accessToken)).send({ marketing: 'no' }).expect(400);
      await http(app).patch(api('/me/notification-preferences')).set(bearer(u.accessToken)).send({ admin: true }).expect(400);
    });
  });

  describe('transactional notices', () => {
    it('buying Premium and being refunded each send an in-app billing notice, even to someone who opted out of marketing', async () => {
      const u = await viewerViaOtp(app);
      await http(app).patch(api('/me/notification-preferences')).set(bearer(u.accessToken)).send({ marketing: false, newEpisodes: false }).expect(200);
      const { PaymentGateway } = await import('../src/modules/payments/gateway/payment-gateway');
      const gw = app.get(PaymentGateway) as unknown as import('../src/modules/payments/gateway/dev.gateway').DevPaymentGateway;
      const order = (await http(app).post(api('/subscriptions/checkout')).set(bearer(u.accessToken)).send({ planCode: 'monthly' }).expect(200)).body;
      const gp = gw.simulatePayment(order.orderId);
      await http(app).post(api('/subscriptions/verify')).set(bearer(u.accessToken)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: gw.signCheckout(order.orderId, gp.id) }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect((await inbox(u.accessToken)).items).toMatchObject([{ title: 'Your Premium is active', category: 'BILLING' }]);
      const fin = await adminToken(app, ['FINANCE']);
      await http(app).post(api(`/admin/payments/${order.paymentId}/refund`)).set(bearer(fin)).send({ reason: 'Customer request' }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect((await inbox(u.accessToken)).items.map((i: { title: string }) => i.title)).toEqual(['Refund processed', 'Your Premium is active']);
    });
  });
});
