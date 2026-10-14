import { NestExpressApplication } from '@nestjs/platform-express';
import { DevPaymentGateway } from '../src/modules/payments/gateway/dev.gateway';
import { PaymentGateway } from '../src/modules/payments/gateway/payment-gateway';
import { createApp } from './helpers';
import { adminToken, bearer, dsOf, http, resetData, viewerViaOtp } from './factories';

const api = (p: string) => `/api/v1${p}`;
const DAY = 86400000;

describe('plan upgrades: a longer plan replaces the running one and the unused value is credited (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let gw: DevPaymentGateway;
  beforeAll(async () => { app = await createApp(); gw = app.get(PaymentGateway) as unknown as DevPaymentGateway; });
  beforeEach(async () => { await resetData(app); });
  afterAll(async () => { await app.close(); });

  const quote = async (token: string, planCode: string) => (await http(app).post(api('/subscriptions/quote')).set(bearer(token)).send({ planCode }).expect(200)).body;
  async function buy(token: string, planCode: string) {
    const order = (await http(app).post(api('/subscriptions/checkout')).set(bearer(token)).send({ planCode }).expect(200)).body;
    const gp = gw.simulatePayment(order.orderId);
    const res = await http(app).post(api('/subscriptions/verify')).set(bearer(token)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: gw.signCheckout(order.orderId, gp.id) }).expect(200);
    return { order, verified: res.body };
  }
  const me = async (token: string) => (await http(app).get(api('/subscriptions/me')).set(bearer(token)).expect(200)).body;
  /** Pretend `days` have passed since the subscriptions were bought. */
  const ageBy = async (days: number) => { const ds = dsOf(app); await ds.query('UPDATE entitlements SET starts_at = starts_at - INTERVAL ? DAY, ends_at = ends_at - INTERVAL ? DAY', [days, days]); await ds.query('UPDATE subscriptions SET starts_at = starts_at - INTERVAL ? DAY, ends_at = ends_at - INTERVAL ? DAY', [days, days]); };
  async function monthlyViewer() { const v = await viewerViaOtp(app); await buy(v.accessToken, 'monthly'); return v; }

  it('quotes the full list price for a first purchase, with no credit', async () => {
    const v = await viewerViaOtp(app);
    expect(await quote(v.accessToken, 'annual')).toMatchObject({ listPricePaise: 119900, creditPaise: 0, amountPaise: 119900, upgrade: false, replaces: null });
  });

  it('credits (almost) the whole monthly price when upgrading right after buying it', async () => {
    const v = await monthlyViewer();
    const q = await quote(v.accessToken, 'annual');
    expect(q.upgrade).toBe(true);
    expect(q.creditPaise).toBeGreaterThan(14800); expect(q.creditPaise).toBeLessThanOrEqual(14900);
    expect(q.amountPaise).toBe(119900 - q.creditPaise);
    expect(q.replaces.planName).toBe('Monthly');
    expect(await quote(v.accessToken, 'quarterly')).toMatchObject({ upgrade: true }); // 3 months > 1 month
  });

  it('credits about half after half the period', async () => {
    const v = await monthlyViewer(); await ageBy(15);
    const q = await quote(v.accessToken, 'annual');
    expect(q.creditPaise).toBeGreaterThan(7000); expect(q.creditPaise).toBeLessThan(7900);
  });

  it('upgrading ends the old period now, starts the new one now (no stacking), and charges only the difference', async () => {
    const v = await monthlyViewer(); await ageBy(10);
    const q = await quote(v.accessToken, 'annual');
    const { order, verified } = await buy(v.accessToken, 'annual');
    expect(order.amountPaise).toBe(q.amountPaise); expect(order.upgrade).toBe(true);
    expect(verified.status).toBe('ACTIVE');
    const s = await me(v.accessToken);
    const until = new Date(s.entitledUntil).getTime();
    expect(Math.abs(until - (Date.now() + 365 * DAY))).toBeLessThan(2 * DAY); // ~12 months from NOW, not 13
    const monthly = s.history.find((h: { planName: string }) => h.planName === 'Monthly'); const annual = s.history.find((h: { planName: string }) => h.planName === 'Annual');
    expect(monthly.status).toBe('EXPIRED'); expect(new Date(monthly.endsAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(new Date(annual.startsAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await dsOf(app).query("SELECT id FROM entitlements WHERE revoked_at IS NULL AND ends_at > NOW(3)")).toHaveLength(1);
    const pays = await dsOf(app).query('SELECT amount_paise a, credit_paise c, upgrade_from_subscription_id u FROM payments ORDER BY id');
    expect(pays.map((p: { a: string }) => Number(p.a))).toEqual([14900, q.amountPaise]);
    expect(Number(pays[1].c)).toBe(q.creditPaise); expect(pays[1].u).toBe(monthly.id);
    expect(Number(pays[0].a) + Number(pays[1].a)).toBeLessThan(14900 + 119900); // total spend is NOT the sum of both list prices
    const [audit] = await dsOf(app).query("SELECT metadata m FROM audit_logs WHERE action = 'subscription.activated' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(typeof audit.m === 'string' ? audit.m : JSON.stringify(audit.m))).toMatchObject({ upgradeApplied: true });
  });

  it('the credit is never applied for a same-length or shorter plan: those still extend (stack)', async () => {
    const v = await monthlyViewer();
    expect(await quote(v.accessToken, 'monthly')).toMatchObject({ upgrade: false, creditPaise: 0, amountPaise: 14900 });
    await buy(v.accessToken, 'monthly');
    const s = await me(v.accessToken);
    expect(Math.abs(new Date(s.entitledUntil).getTime() - (Date.now() + 61 * DAY))).toBeLessThan(3 * DAY); // two months, stacked
    const a = await viewerViaOtp(app); await buy(a.accessToken, 'annual');
    expect(await quote(a.accessToken, 'monthly')).toMatchObject({ upgrade: false, creditPaise: 0 }); // shorter than running annual
    expect(await quote(a.accessToken, 'annual')).toMatchObject({ upgrade: false, creditPaise: 0 }); // same length
  });

  it('no credit when the current access was granted by an admin, or when periods are already stacked', async () => {
    const granted = await monthlyViewer();
    await dsOf(app).query("UPDATE subscriptions SET source = 'ADMIN_GRANT', payment_id = NULL WHERE user_id = ?", [granted.user.id]);
    expect(await quote(granted.accessToken, 'annual')).toMatchObject({ upgrade: false, creditPaise: 0 });
    const stacked = await monthlyViewer(); await buy(stacked.accessToken, 'monthly');
    expect(await quote(stacked.accessToken, 'annual')).toMatchObject({ upgrade: false, creditPaise: 0 });
  });

  it('credit is based on what was actually paid: a partial refund of the old payment lowers it', async () => {
    const v = await monthlyViewer();
    const full = (await quote(v.accessToken, 'annual')).creditPaise;
    await dsOf(app).query('UPDATE payments SET refunded_paise = 7450');
    const net = (await quote(v.accessToken, 'annual')).creditPaise;
    expect(net).toBeLessThanOrEqual(7450); expect(net).toBeGreaterThan(7300); expect(net).toBeLessThan(full);
  });

  it('never goes below the gateway minimum, even if the credit would cover the whole price', async () => {
    const v = await monthlyViewer();
    await dsOf(app).query("UPDATE subscription_plans SET price_paise = 14950 WHERE code = 'annual'"); // list 149.50, credit up to 149.00
    const q = await quote(v.accessToken, 'annual');
    expect(q.amountPaise).toBeGreaterThanOrEqual(100);
    await dsOf(app).query("UPDATE subscription_plans SET price_paise = 14900 WHERE code = 'annual'");
    expect((await quote(v.accessToken, 'annual')).amountPaise).toBe(100);
  });

  it('re-uses an unpaid order only while its price is still right', async () => {
    const v = await monthlyViewer();
    const a = (await http(app).post(api('/subscriptions/checkout')).set(bearer(v.accessToken)).send({ planCode: 'annual' }).expect(200)).body;
    const again = (await http(app).post(api('/subscriptions/checkout')).set(bearer(v.accessToken)).send({ planCode: 'annual' }).expect(200)).body;
    expect(again.orderId).toBe(a.orderId);
    await ageBy(5); // the credit shrank, so the old discounted order would now undercharge
    const later = (await http(app).post(api('/subscriptions/checkout')).set(bearer(v.accessToken)).send({ planCode: 'annual' }).expect(200)).body;
    expect(later.orderId).not.toBe(a.orderId); expect(later.amountPaise).toBeGreaterThan(a.amountPaise);
  });

  it('if the old plan lapsed before the discounted order was paid, the new period simply starts now and the audit trail says the upgrade was not applied', async () => {
    const v = await monthlyViewer();
    const order = (await http(app).post(api('/subscriptions/checkout')).set(bearer(v.accessToken)).send({ planCode: 'annual' }).expect(200)).body;
    await dsOf(app).query("UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = NOW(3) WHERE user_id = ?", [v.user.id]);
    await dsOf(app).query("UPDATE entitlements SET revoked_at = NOW(3), revoked_reason = 'test' WHERE user_id = ?", [v.user.id]);
    const gp = gw.simulatePayment(order.orderId);
    await http(app).post(api('/subscriptions/verify')).set(bearer(v.accessToken)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: gw.signCheckout(order.orderId, gp.id) }).expect(200);
    expect((await me(v.accessToken)).active).toBe(true);
    const [audit] = await dsOf(app).query("SELECT metadata m FROM audit_logs WHERE action = 'subscription.activated' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(typeof audit.m === 'string' ? audit.m : JSON.stringify(audit.m))).toMatchObject({ upgradeApplied: false });
  });

  it('a repeated verify of the same upgrade payment does not end or extend anything twice', async () => {
    const v = await monthlyViewer();
    const { order } = await buy(v.accessToken, 'annual');
    const before = await me(v.accessToken);
    const gp = gw.simulatePayment(order.orderId);
    await http(app).post(api('/subscriptions/verify')).set(bearer(v.accessToken)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: gw.signCheckout(order.orderId, gp.id) }).expect(200);
    const after = await me(v.accessToken);
    expect(after.entitledUntil).toBe(before.entitledUntil); expect(after.history).toHaveLength(before.history.length);
  });

  it('requires sign-in, a known plan, and shows the credit to admins in the payment list', async () => {
    await http(app).post(api('/subscriptions/quote')).send({ planCode: 'annual' }).expect(401);
    const v = await monthlyViewer();
    await http(app).post(api('/subscriptions/quote')).set(bearer(v.accessToken)).send({ planCode: 'nope' }).expect(404);
    await buy(v.accessToken, 'annual');
    const fin = await adminToken(app, ['FINANCE']);
    const list = (await http(app).get(api('/admin/payments')).set(bearer(fin)).expect(200)).body;
    const items = list.items ?? list;
    const upgraded = items.find((p: { upgrade: boolean }) => p.upgrade);
    expect(upgraded.creditPaise).toBeGreaterThan(0);
  });

  describe('refunding an upgrade', () => {
    const refund = (admin: string, paymentId: string, body: object) => http(app).post(api(`/admin/payments/${paymentId}/refund`)).set(bearer(admin)).send(body);

    it('a FULL refund puts the replaced plan back with its original end date', async () => {
      const v = await monthlyViewer(); await ageBy(10);
      const monthlyBefore = (await me(v.accessToken)).history[0];
      const { order } = await buy(v.accessToken, 'annual');
      const fin = await adminToken(app, ['FINANCE']);
      await refund(fin, order.paymentId, { reason: 'Changed mind' }).expect(200);
      const s = await me(v.accessToken);
      expect(s.active).toBe(true);
      expect(new Date(s.entitledUntil).getTime()).toBe(new Date(monthlyBefore.endsAt).getTime()); // the monthly's ORIGINAL end
      const byName = (n: string) => s.history.find((h: { planName: string }) => h.planName === n);
      expect(byName('Monthly').status).toBe('ACTIVE'); expect(byName('Annual').status).toBe('REFUNDED');
      expect(await dsOf(app).query('SELECT id FROM entitlements WHERE revoked_at IS NULL AND ends_at > NOW(3)')).toHaveLength(1);
    });

    it('a PARTIAL refund keeps the upgrade and does not resurrect the old plan', async () => {
      const v = await monthlyViewer();
      const { order } = await buy(v.accessToken, 'annual');
      const fin = await adminToken(app, ['FINANCE']);
      await refund(fin, order.paymentId, { amountPaise: 10000, reason: 'Goodwill' }).expect(200);
      const s = await me(v.accessToken);
      expect(s.history.find((h: { planName: string }) => h.planName === 'Annual').status).toBe('ACTIVE');
      expect(s.history.find((h: { planName: string }) => h.planName === 'Monthly').status).toBe('EXPIRED');
      expect(await dsOf(app).query('SELECT id FROM entitlements WHERE revoked_at IS NULL AND ends_at > NOW(3)')).toHaveLength(1);
    });

    it('does not restore a plan that was revoked for another reason in the meantime', async () => {
      const v = await monthlyViewer();
      const { order } = await buy(v.accessToken, 'annual');
      await dsOf(app).query("UPDATE entitlements SET revoked_at = NOW(3), revoked_reason = 'fraud' WHERE user_id = ? AND revoked_reason = 'UPGRADED'", [v.user.id]);
      const fin = await adminToken(app, ['FINANCE']);
      await refund(fin, order.paymentId, { reason: 'Changed mind' }).expect(200);
      expect((await me(v.accessToken)).active).toBe(false);
    });
  });
});
