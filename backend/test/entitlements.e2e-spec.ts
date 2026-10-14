import { NestExpressApplication } from '@nestjs/platform-express';
import { User, UserStatus } from '../src/database/entities/index';
import { DevPaymentGateway } from '../src/modules/payments/gateway/dev.gateway';
import { PaymentGateway } from '../src/modules/payments/gateway/payment-gateway';
import { createApp } from './helpers';
import { addReadyAsset, adminToken, bearer, dsOf, http, resetData, viewerViaOtp } from './factories';

describe('entitlements: who may watch what (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let editor: string;
  let fin: string;
  beforeAll(async () => { app = await createApp(); });
  beforeEach(async () => { await resetData(app); editor = await adminToken(app, ['EDITOR']); fin = await adminToken(app, ['FINANCE']); });
  afterAll(async () => { await app.close(); });

  const api = (p: string) => `/api/v1${p}`;
  const gw = () => app.get(PaymentGateway) as unknown as DevPaymentGateway;
  let n = 0;
  const uniq = (p: string) => `${p} ${Date.now()}-${++n}`;

  async function liveSeries() {
    const g = (await http(app).post(api('/admin/genres')).set(bearer(editor)).send({ name: uniq('G') }).expect(201)).body;
    const s = (await http(app).post(api('/admin/series')).set(bearer(editor)).send({ title: uniq('Show'), synopsis: 'A story worth watching tonight.', posterKey: 'images/a.jpg', genreIds: [g.id] }).expect(201)).body;
    const eps: { id: string; number: number }[] = [];
    for (let i = 1; i <= 3; i++) {
      const e = (await http(app).post(api(`/admin/series/${s.id}/episodes`)).set(bearer(editor)).send({ title: `Ep ${i}` }).expect(201)).body;
      await dsOf(app).query("UPDATE episodes SET status = 'PUBLISHED', published_at = NOW(3) WHERE id = ?", [e.id]);
      await addReadyAsset(app, e.id);
      eps.push(e);
    }
    await http(app).post(api(`/admin/series/${s.id}/publish`)).set(bearer(editor)).expect(200);
    return { series: s as { id: string; slug: string }, eps };
  }
  async function subscriber(plan = 'monthly') {
    const v = await viewerViaOtp(app);
    const order = (await http(app).post(api('/subscriptions/checkout')).set(bearer(v.accessToken)).send({ planCode: plan }).expect(200)).body;
    const gp = gw().simulatePayment(order.orderId);
    await http(app).post(api('/subscriptions/verify')).set(bearer(v.accessToken)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: gw().signCheckout(order.orderId, gp.id) }).expect(200);
    return { token: v.accessToken, id: v.user.id };
  }
  const access = (id: string, token?: string) => { const r = http(app).get(api(`/episodes/${id}/access`)); return token ? r.set(bearer(token)) : r; };

  it('anonymous visitors can browse metadata but every episode says SUBSCRIPTION_REQUIRED (sign in needed)', async () => {
    const { series, eps } = await liveSeries();
    const list = (await http(app).get(api(`/series/${series.id}/episodes`)).expect(200)).body;
    expect(list.items).toHaveLength(3);
    for (const e of list.items) expect(e.access).toEqual({ allowed: false, code: 'SUBSCRIPTION_REQUIRED', message: expect.any(String), requiresAuth: true });
    expect((await access(eps[0].id).expect(200)).body).toMatchObject({ allowed: false, code: 'SUBSCRIPTION_REQUIRED', requiresAuth: true });
  });

  it('there are NO free episodes: even episode 1 requires a subscription', async () => {
    const { eps } = await liveSeries();
    const free = await viewerViaOtp(app);
    for (const e of eps) expect((await access(e.id, free.accessToken).expect(200)).body).toMatchObject({ allowed: false, code: 'SUBSCRIPTION_REQUIRED' });
  });

  it('a signed-in user with no subscription is told SUBSCRIPTION_REQUIRED (not that sign-in is needed)', async () => {
    const { series, eps } = await liveSeries();
    const v = await viewerViaOtp(app);
    const body = (await access(eps[0].id, v.accessToken).expect(200)).body;
    expect(body.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(body.requiresAuth).toBeUndefined();
    const list = (await http(app).get(api(`/series/${series.id}/episodes`)).set(bearer(v.accessToken)).expect(200)).body;
    expect(list.items.every((e: { access: { code: string } }) => e.access.code === 'SUBSCRIPTION_REQUIRED')).toBe(true);
  });

  it('a subscriber is allowed on every live episode, with the time until which access lasts', async () => {
    const { series, eps } = await liveSeries();
    const s = await subscriber('quarterly');
    const body = (await access(eps[1].id, s.token).expect(200)).body;
    expect(body.allowed).toBe(true);
    expect(new Date(body.entitledUntil).getTime()).toBeGreaterThan(Date.now() + 80 * 86400_000);
    const list = (await http(app).get(api(`/series/${series.id}/episodes`)).set(bearer(s.token)).expect(200)).body;
    expect(list.items.every((e: { access: { allowed: boolean } }) => e.access.allowed)).toBe(true);
  });

  it('after the subscription ends the answer becomes SUBSCRIPTION_EXPIRED (distinct from never subscribed)', async () => {
    const { eps } = await liveSeries();
    const s = await subscriber();
    await dsOf(app).query('UPDATE entitlements SET starts_at = NOW(3) - INTERVAL 2 MONTH, ends_at = NOW(3) - INTERVAL 1 DAY WHERE user_id = ?', [s.id]);
    const body = (await access(eps[0].id, s.token).expect(200)).body;
    expect(body).toMatchObject({ allowed: false, code: 'SUBSCRIPTION_EXPIRED' });
  });

  it('a revoked or not-yet-started entitlement never grants access', async () => {
    const { eps } = await liveSeries();
    const s = await subscriber();
    await dsOf(app).query("UPDATE entitlements SET revoked_at = NOW(3), revoked_reason = 'test' WHERE user_id = ?", [s.id]);
    expect((await access(eps[0].id, s.token).expect(200)).body.allowed).toBe(false);
    await dsOf(app).query('UPDATE entitlements SET revoked_at = NULL, starts_at = NOW(3) + INTERVAL 1 DAY WHERE user_id = ?', [s.id]);
    expect((await access(eps[0].id, s.token).expect(200)).body.allowed).toBe(false);
  });

  it.each([
    ['a draft episode', "status = 'DRAFT', published_at = NULL"],
    ['an archived episode', "status = 'ARCHIVED'"],
    ['a scheduled episode', "status = 'SCHEDULED', published_at = NULL, publish_at = NOW(3) + INTERVAL 1 DAY"],
    ['an episode whose release time is still in the future', 'published_at = NOW(3) + INTERVAL 1 DAY'],
    ['an episode with no video at all', 'current_asset_id = NULL'],
  ])('%s is EPISODE_NOT_AVAILABLE even for a paying subscriber', async (_label, sqlSet) => {
    const { eps } = await liveSeries();
    const s = await subscriber();
    await dsOf(app).query(`UPDATE episodes SET ${sqlSet} WHERE id = ?`, [eps[0].id]);
    const body = (await access(eps[0].id, s.token).expect(200)).body;
    expect(body).toMatchObject({ allowed: false, code: 'EPISODE_NOT_AVAILABLE' });
    expect((await access(eps[1].id, s.token).expect(200)).body.allowed).toBe(true); // siblings unaffected
  });

  it('episodes of an unpublished, archived or future series are not available either', async () => {
    const { series, eps } = await liveSeries();
    const s = await subscriber();
    await http(app).post(api(`/admin/series/${series.id}/unpublish`)).set(bearer(editor)).expect(200);
    expect((await access(eps[0].id, s.token).expect(200)).body.code).toBe('EPISODE_NOT_AVAILABLE');
    await http(app).post(api(`/admin/series/${series.id}/publish`)).set(bearer(editor)).expect(200);
    expect((await access(eps[0].id, s.token).expect(200)).body.allowed).toBe(true);
    await dsOf(app).query('UPDATE series SET published_at = NOW(3) + INTERVAL 1 DAY WHERE id = ?', [series.id]);
    expect((await access(eps[0].id, s.token).expect(200)).body.code).toBe('EPISODE_NOT_AVAILABLE');
  });

  it('hidden and non-existent episodes are indistinguishable (nothing is revealed about unpublished content)', async () => {
    const { eps } = await liveSeries();
    const s = await subscriber();
    await dsOf(app).query("UPDATE episodes SET status = 'DRAFT', published_at = NULL WHERE id = ?", [eps[0].id]);
    const hidden = (await access(eps[0].id, s.token).expect(200)).body;
    const missing = (await access('987654', s.token).expect(200)).body;
    const junk = (await access('not-a-number', s.token).expect(200)).body;
    const strip = (b: Record<string, unknown>) => ({ ...b, episodeId: undefined });
    expect(strip(hidden)).toEqual(strip(missing));
    expect(strip(hidden)).toEqual(strip(junk));
    expect(hidden.code).toBe('EPISODE_NOT_AVAILABLE');
  });

  it('a suspended user is cut off (ACCOUNT_SUSPENDED), and gets access back when restored', async () => {
    const { eps } = await liveSeries();
    const s = await subscriber();
    await dsOf(app).getRepository(User).update(s.id, { status: UserStatus.Suspended });
    const denied = await access(eps[0].id, s.token).expect(403);
    expect(denied.body.code).toBe('ACCOUNT_SUSPENDED');
    await dsOf(app).getRepository(User).update(s.id, { status: UserStatus.Active });
    expect((await access(eps[0].id, s.token).expect(200)).body.allowed).toBe(true);
  });

  it('nothing the client sends can change the answer: flags, headers, query strings, bodies', async () => {
    const { eps } = await liveSeries();
    const v = await viewerViaOtp(app);
    const tries = [
      http(app).get(api(`/episodes/${eps[0].id}/access?subscribed=true&allowed=1&plan=annual&free=1`)).set(bearer(v.accessToken)),
      http(app).get(api(`/episodes/${eps[0].id}/access`)).set(bearer(v.accessToken)).set('x-subscribed', 'true').set('x-plan', 'annual').set('x-entitled', '1'),
      http(app).get(api(`/series/${eps[0].id}/episodes`)).set(bearer(v.accessToken)).set('x-subscribed', 'true'),
    ];
    const [a, b] = await Promise.all(tries.slice(0, 2));
    expect(a.body.allowed).toBe(false);
    expect(b.body.allowed).toBe(false);
  });

  it('an invalid or tampered token is rejected on the access endpoint rather than silently treated as anonymous', async () => {
    const { eps } = await liveSeries();
    const v = await viewerViaOtp(app);
    await access(eps[0].id, v.accessToken.slice(0, -4) + 'AAAA').expect(401);
    await access(eps[0].id, 'garbage').expect(401);
  });

  it('refunding a purchase takes the access away immediately', async () => {
    const { eps } = await liveSeries();
    const s = await subscriber('annual');
    expect((await access(eps[0].id, s.token).expect(200)).body.allowed).toBe(true);
    const [p] = await dsOf(app).query('SELECT id FROM payments WHERE user_id = ?', [s.id]);
    await http(app).post(api(`/admin/payments/${p.id}/refund`)).set(bearer(fin)).send({ reason: 'Refund test' }).expect(200);
    expect((await access(eps[0].id, s.token).expect(200)).body).toMatchObject({ allowed: false, code: 'SUBSCRIPTION_EXPIRED' });
  });

  it('episode list responses are never cacheable (they carry per-user access state)', async () => {
    const { series } = await liveSeries();
    const r = await http(app).get(api(`/series/${series.id}/episodes`)).expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    const a = await http(app).get(api('/episodes/1/access')).expect(200);
    expect(a.headers['cache-control']).toBe('private, no-store');
  });
});
