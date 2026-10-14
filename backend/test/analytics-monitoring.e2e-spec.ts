import { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { AnalyticsEvent } from '../src/database/entities/index';
import { DevPaymentGateway } from '../src/modules/payments/gateway/dev.gateway';
import { PaymentGateway } from '../src/modules/payments/gateway/payment-gateway';
import { ErrorReporter } from '../src/modules/monitoring/error-reporter';
import { REDIS_CLIENT } from '../src/modules/redis/redis.module';
import { createApp } from './helpers';
import { addReadyAsset, adminToken, bearer, dsOf, http, resetData, subscribedViewer, viewerViaOtp } from './factories';

describe('analytics, dashboard and monitoring (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let admin: string;
  beforeAll(async () => { app = await createApp(); });
  beforeEach(async () => { await resetData(app); await app.get<Redis>(REDIS_CLIENT).flushdb(); admin = await adminToken(app, ['SUPER_ADMIN']); });
  afterAll(async () => { await app.close(); });
  const api = (p: string) => `/api/v1${p}`;
  const events = (body: unknown, token?: string) => { const r = http(app).post(api('/analytics/events')); if (token) r.set(bearer(token)); return r.send(body as object); };

  describe('client event intake', () => {
    it('accepts a batch from anonymous and signed-in users, attaching the REAL user id (never one from the body)', async () => {
      const u = await viewerViaOtp(app);
      await events({ events: [{ type: 'app_open' }, { type: 'screen_view', properties: { screen: 'home' } }] }).expect(202);
      await events({ events: [{ type: 'episode_impression', entityType: 'episode', entityId: '12', properties: { position: 3 } }] }, u.accessToken).expect(202);
      const rows = await dsOf(app).getRepository(AnalyticsEvent).find({ order: { id: 'ASC' } });
      expect(rows.map((r) => [r.eventType, r.userId])).toEqual([['app_open', null], ['screen_view', null], ['episode_impression', u.user.id]]);
      expect(rows[2]).toMatchObject({ entityType: 'episode', entityId: '12', properties: { position: 3 } });
      await events({ events: [{ type: 'app_open', userId: '999' }] }).expect(400); // identity can never be supplied by the client
    });

    it('only allow-listed client events are accepted; server-side events cannot be forged', async () => {
      for (const type of ['payment_captured', 'playback_started', 'episode_completed', 'subscription_activated', 'drop table', '']) await events({ events: [{ type }] }).expect(400);
      expect(await dsOf(app).getRepository(AnalyticsEvent).count()).toBe(0);
    });

    it.each([
      ['an empty batch', { events: [] }], ['too many events', { events: Array.from({ length: 21 }, () => ({ type: 'app_open' })) }], ['no body', {}], ['events not an array', { events: 'app_open' }],
      ['a bad entity type', { events: [{ type: 'share', entityType: 'user' }] }], ['a bad entity id', { events: [{ type: 'share', entityType: 'series', entityId: '1; DROP' }] }],
    ])('rejects %s', async (_l, body) => { await events(body).expect(400); });

    it('keeps properties flat, short and primitive: nested data, long strings, odd keys and extra keys are dropped', async () => {
      const big = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]));
      await events({ events: [{ type: 'search', properties: { query: 'x'.repeat(500), nested: { a: 1 }, list: [1, 2], 'Bad Key': 'v', ok: true, n: 5, ...big } }] }).expect(202);
      const [row] = await dsOf(app).getRepository(AnalyticsEvent).find();
      const p = row.properties as Record<string, unknown>;
      expect((p.query as string).length).toBe(100);
      expect(p).not.toHaveProperty('nested'); expect(p).not.toHaveProperty('list'); expect(p).not.toHaveProperty('Bad Key');
      expect(Object.keys(p).length).toBeLessThanOrEqual(10);
    });

    it('rejects a bad token rather than treating it as anonymous', async () => {
      await events({ events: [{ type: 'app_open' }] }, 'garbage').expect(401);
    });

    it('server-side retention removes only old events', async () => {
      await events({ events: [{ type: 'app_open' }, { type: 'app_open' }] }).expect(202);
      await dsOf(app).query('UPDATE analytics_events SET occurred_at = NOW(3) - INTERVAL 500 DAY LIMIT 1');
      const { AnalyticsService } = await import('../src/modules/analytics/analytics.service');
      expect(await app.get(AnalyticsService).prune(400)).toBe(1);
      expect(await dsOf(app).getRepository(AnalyticsEvent).count()).toBe(1);
    });
  });

  describe('admin dashboard', () => {
    async function scenario() {
      const gw = app.get(PaymentGateway) as unknown as DevPaymentGateway;
      const a = await subscribedViewer(app, 'annual'); const b = await subscribedViewer(app, 'monthly'); const c = await viewerViaOtp(app);
      const fin = await adminToken(app, ['FINANCE']);
      const [pa] = await dsOf(app).query('SELECT id FROM payments WHERE user_id = ?', [a.id]);
      await http(app).post(api(`/admin/payments/${pa.id}/refund`)).set(bearer(fin)).send({ amountPaise: 20000, reason: 'Goodwill' }).expect(200);
      const order = (await http(app).post(api('/subscriptions/checkout')).set(bearer(c.accessToken)).send({ planCode: 'monthly' }).expect(200)).body;
      const failed = gw.simulatePayment(order.orderId, { outcome: 'failed' });
      await http(app).post(api('/subscriptions/verify')).set(bearer(c.accessToken)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: failed.id, razorpay_signature: gw.signCheckout(order.orderId, failed.id) }).expect(200);
      // one real playback by subscriber A
      const g = (await http(app).post(api('/admin/genres')).set(bearer(admin)).send({ name: 'Drama' }).expect(201)).body;
      const ed = await adminToken(app, ['EDITOR']);
      const s = (await http(app).post(api('/admin/series')).set(bearer(ed)).send({ title: 'Top Show', synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body;
      const e = (await http(app).post(api(`/admin/series/${s.id}/episodes`)).set(bearer(ed)).send({ title: 'Pilot' }).expect(201)).body;
      await dsOf(app).query("UPDATE episodes SET status = 'PUBLISHED', published_at = NOW(3) WHERE id = ?", [e.id]);
      await addReadyAsset(app, e.id);
      await http(app).post(api(`/admin/series/${s.id}/publish`)).set(bearer(ed)).expect(200);
      await http(app).post(api(`/episodes/${e.id}/playback-session`)).set(bearer(a.token)).expect(201);
      return { s };
    }

    it('reports revenue, users, subscribers, playback and top series exactly, in integer paise', async () => {
      const { s } = await scenario();
      const d = (await http(app).get(api('/admin/dashboard?days=30')).set(bearer(admin)).expect(200)).body;
      expect(d.totals).toMatchObject({ users: 3, newUsers: 3, activeSubscribers: 2, newSubscriptions: 2, failedPayments: 1, playbackStarts: 1, uniqueViewers: 1 });
      expect(d.totals.revenue).toEqual({ grossPaise: 134800, refundedPaise: 20000, netPaise: 114800, netDisplay: '₹1,148', payments: 2 });
      expect(Object.values(d.totals.revenue).every((v) => typeof v === 'number' || typeof v === 'string')).toBe(true);
      expect(d.topSeries).toEqual([{ id: s.id, title: 'Top Show', playbackStarts: 1, uniqueViewers: 1 }]);
      for (const k of ['revenuePaise', 'newUsers', 'playbackStarts']) expect(d.daily[k]).toHaveLength(30);
      const today = new Date().toISOString().slice(0, 10);
      expect(d.daily.revenuePaise.at(-1)).toEqual({ date: today, value: 134800 });
      expect(d.daily.newUsers.at(-1)).toEqual({ date: today, value: 3 });
      expect(d.daily.playbackStarts.at(-1).value).toBe(1);
      expect((await http(app).get(api('/admin/dashboard?days=7')).set(bearer(admin)).expect(200)).body.daily.revenuePaise).toHaveLength(7);
    });

    it('excludes old activity from a short window, and caches for 60 seconds', async () => {
      await scenario();
      await dsOf(app).query('UPDATE payments SET captured_at = NOW(3) - INTERVAL 20 DAY');
      await app.get<Redis>(REDIS_CLIENT).flushdb();
      expect((await http(app).get(api('/admin/dashboard?days=7')).set(bearer(admin)).expect(200)).body.totals.revenue.grossPaise).toBe(0);
      const first = (await http(app).get(api('/admin/dashboard?days=30')).set(bearer(admin)).expect(200)).body;
      expect(first.cached).toBe(false);
      expect(first.totals.revenue.grossPaise).toBe(134800);
      expect((await http(app).get(api('/admin/dashboard?days=30')).set(bearer(admin)).expect(200)).body.cached).toBe(true);
    });

    it('validates the range and enforces analytics.read', async () => {
      for (const bad of ['5', '0', '-30', 'abc', '30.5', '365']) await http(app).get(api(`/admin/dashboard?days=${bad}`)).set(bearer(admin)).expect(400);
      await http(app).get(api('/admin/dashboard?days=90')).set(bearer(admin)).expect(200);
      for (const role of ['EDITOR', 'FINANCE']) { const t = await adminToken(app, [role]); await http(app).get(api('/admin/dashboard')).set(bearer(t)).expect(200); }
      const support = await adminToken(app, ['SUPPORT']);
      await http(app).get(api('/admin/dashboard')).set(bearer(support)).expect(403);
      await http(app).get(api('/admin/dashboard')).expect(401);
      const v = await viewerViaOtp(app);
      await http(app).get(api('/admin/dashboard')).set(bearer(v.accessToken)).expect(401);
    });

    it('is correct and fast on an empty system', async () => {
      const d = (await http(app).get(api('/admin/dashboard')).set(bearer(admin)).expect(200)).body;
      expect(d.totals).toMatchObject({ users: 0, activeSubscribers: 0, playbackStarts: 0, watchHours: 0 });
      expect(d.totals.revenue.netPaise).toBe(0);
      expect(d.topSeries).toEqual([]);
    });
  });

  describe('metrics endpoint', () => {
    it('does not exist unless a token is configured', async () => {
      await http(app).get(api('/metrics')).expect(404);
      await http(app).get(api('/metrics')).set(bearer('anything-at-all-1234567')).expect(404);
    });

    it('requires the bearer token, and reports bounded-label request metrics and queue depths', async () => {
      const m = await createApp({ METRICS_TOKEN: 'metrics-token-0123456789' });
      try {
        await http(m).get(api('/series')).expect(200);
        await http(m).get(api('/series/12345')).expect(404);
        await http(m).get(api('/series/some-slug-here')).expect(404);
        await http(m).get(api('/metrics')).expect(401);
        await http(m).get(api('/metrics')).set(bearer('wrong-token-0123456789')).expect(401);
        const r = await http(m).get(api('/metrics')).set(bearer('metrics-token-0123456789')).expect(200);
        expect(r.headers['content-type']).toMatch(/text\/plain/);
        expect(r.text).toContain('aivistro_http_requests_total{method="GET",route="/api/v1/series",status="200"} 1');
        expect(r.text).toContain('route="/api/v1/series/:ref",status="404"} 2'); // route PATTERN: two different ids, one series
        expect(r.text).not.toMatch(/12345|some-slug-here/);
        expect(r.text).toMatch(/aivistro_http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/series",le="\+Inf"\} 1/);
        expect(r.text).toMatch(/aivistro_queue_jobs\{queue="video-processing",state="waiting"\} \d+/);
        expect(r.text).toMatch(/aivistro_process_uptime_seconds \d+/);
      } finally { await m.close(); }
    });
  });

  describe('error reporting', () => {
    it('reports unexpected 5xx errors with the request id, never 4xx, and never leaks the error to the client', async () => {
      const capture = jest.fn();
      const r = await createApp({}, (b) => b.overrideProvider(ErrorReporter).useValue({ capture }));
      try {
        const boom = await http(r).get(api('/echo/boom')).expect(500);
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(capture.mock.calls[0][1]).toEqual({ requestId: boom.body.requestId, path: '/api/v1/echo/boom' });
        await http(r).get(api('/does-not-exist')).expect(404);
        await http(r).post(api('/echo')).send({}).expect(400);
        expect(capture).toHaveBeenCalledTimes(1);
      } finally { await r.close(); }
    });
  });

  describe('response caching defaults', () => {
    it('anything fetched with credentials is private/no-store by default; public catalog pages keep their own policy', async () => {
      const u = await viewerViaOtp(app);
      expect((await http(app).get(api('/me')).set(bearer(u.accessToken)).expect(200)).headers['cache-control']).toBe('private, no-store');
      expect((await http(app).get(api('/subscriptions/me')).set(bearer(u.accessToken)).expect(200)).headers['cache-control']).toBe('private, no-store');
      expect((await http(app).get(api('/admin/dashboard')).set(bearer(admin)).expect(200)).headers['cache-control']).toBe('private, no-store');
      expect((await http(app).get(api('/plans')).expect(200)).headers['cache-control']).toBe('public, max-age=60');
      expect((await http(app).get(api('/genres')).expect(200)).headers['cache-control']).toMatch(/public/);
    });
  });
});
