import { NestExpressApplication } from '@nestjs/platform-express';
import { addMonthsUtc } from '../src/common/time';
import { Entitlement, Payment, PaymentStatus, Refund, Subscription, SubscriptionPlan, SubscriptionStatus, User, UserStatus, WebhookStatus, PaymentWebhookEvent } from '../src/database/entities/index';
import { DevPaymentGateway } from '../src/modules/payments/gateway/dev.gateway';
import { GatewayPayment, PaymentGateway } from '../src/modules/payments/gateway/payment-gateway';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { createApp } from './helpers';
import { adminLogin, adminToken, bearer, createAdmin, dsOf, http, resetData, viewerViaOtp } from './factories';

describe('subscriptions and payments (real MySQL + Redis, dev gateway with real signature checks)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp(); });
  beforeEach(async () => { await resetData(app); });
  afterAll(async () => { await app.close(); });

  const gw = () => app.get(PaymentGateway) as unknown as DevPaymentGateway;
  const api = (p: string) => `/api/v1${p}`;
  const repo = <T extends object>(e: new () => T) => dsOf(app).getRepository(e);
  const subCount = (userId: string) => repo(Subscription).count({ where: { userId } });

  async function viewer() { const v = await viewerViaOtp(app); return { token: v.accessToken, id: v.user.id }; }
  async function checkout(token: string, planCode = 'monthly') { return (await http(app).post(api('/subscriptions/checkout')).set(bearer(token)).send({ planCode }).expect(200)).body as { orderId: string; paymentId: string; amountPaise: number; keyId: string }; }
  const me = async (token: string) => (await http(app).get(api('/subscriptions/me')).set(bearer(token)).expect(200)).body;

  const eventBody = (event: string, gp: GatewayPayment) => JSON.stringify({ entity: 'event', event, payload: { payment: { entity: { id: gp.id, order_id: gp.orderId, amount: gp.amountPaise, currency: gp.currency, status: gp.status, method: gp.method, error_code: gp.errorCode, error_description: gp.errorDescription } } } });
  let evtN = 0;
  const deliver = (raw: string, o: { sig?: string; eventId?: string; omitSig?: boolean } = {}) => {
    const r = http(app).post(api('/payments/razorpay/webhook')).set('Content-Type', 'application/json').set('x-razorpay-event-id', o.eventId ?? `evt_test_${Date.now()}_${++evtN}`);
    if (!o.omitSig) r.set('x-razorpay-signature', o.sig ?? gw().signWebhook(raw));
    return r.send(raw);
  };
  const captureViaWebhook = (gp: GatewayPayment, eventId?: string) => deliver(eventBody('payment.captured', gp), { eventId });
  /** The customer pays at the gateway but nothing has told our backend yet. */
  const payAtGateway = (orderId: string, o: Parameters<DevPaymentGateway['simulatePayment']>[1] = {}) => gw().simulatePayment(orderId, o);
  const checkoutTriple = (orderId: string, gp: GatewayPayment) => ({ razorpay_order_id: orderId, razorpay_payment_id: gp.id, razorpay_signature: gw().signCheckout(orderId, gp.id) });

  describe('plans and prices', () => {
    it('lists the active plans with integer paise and exact display amounts', async () => {
      const r = await http(app).get(api('/plans')).expect(200);
      expect(r.body.map((p: { code: string }) => p.code)).toEqual(['monthly', 'quarterly', 'annual']);
      expect(r.body.map((p: { pricePaise: number }) => p.pricePaise)).toEqual([14900, 39900, 119900]);
      expect(r.body.map((p: { priceDisplay: string }) => p.priceDisplay)).toEqual(['₹149', '₹399', '₹1,199']);
      expect(r.body.every((p: { pricePaise: number }) => Number.isInteger(p.pricePaise))).toBe(true);
    });

    it('stores money as an unsigned BIGINT of paise', async () => {
      const [col] = await dsOf(app).query("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'amount_paise'");
      expect(col.t).toBe('bigint unsigned');
    });

    it('lets finance change a price; it applies to NEW purchases only, never to past payments', async () => {
      const v = await viewer();
      const first = await checkout(v.token, 'monthly');
      expect(first.amountPaise).toBe(14900);
      const fin = await adminToken(app, ['FINANCE']);
      const plans = (await http(app).get(api('/admin/plans')).set(bearer(fin)).expect(200)).body as { id: string; code: string }[];
      const monthly = plans.find((p) => p.code === 'monthly')!;
      const upd = await http(app).patch(api(`/admin/plans/${monthly.id}`)).set(bearer(fin)).send({ pricePaise: 17900 }).expect(200);
      expect(upd.body).toMatchObject({ pricePaise: 17900, priceDisplay: '₹179' });
      const second = await checkout(v.token, 'monthly');
      expect(second.amountPaise).toBe(17900);
      expect(second.orderId).not.toBe(first.orderId); // a price change never re-uses the old order
      const old = await repo(Payment).findOneByOrFail({ id: first.paymentId });
      expect(old.amountPaise).toBe('14900'); // history is a snapshot
    });

    it.each([[14900.5], [-1], [0], [50], [10_000_001], ['100'], [null]])('rejects an invalid price %p', async (price) => {
      const fin = await adminToken(app, ['FINANCE']);
      const plans = (await http(app).get(api('/admin/plans')).set(bearer(fin)).expect(200)).body as { id: string }[];
      await http(app).patch(api(`/admin/plans/${plans[0].id}`)).set(bearer(fin)).send({ pricePaise: price }).expect(400);
    });

    it('hides inactive plans from viewers, refuses to sell them, and only plan managers can edit', async () => {
      const fin = await adminToken(app, ['FINANCE']);
      const plans = (await http(app).get(api('/admin/plans')).set(bearer(fin)).expect(200)).body as { id: string; code: string }[];
      await http(app).patch(api(`/admin/plans/${plans.find((p) => p.code === 'quarterly')!.id}`)).set(bearer(fin)).send({ active: false }).expect(200);
      expect((await http(app).get(api('/plans')).expect(200)).body.map((p: { code: string }) => p.code)).toEqual(['monthly', 'annual']);
      const v = await viewer();
      await http(app).post(api('/subscriptions/checkout')).set(bearer(v.token)).send({ planCode: 'quarterly' }).expect(404);
      for (const role of ['EDITOR', 'SUPPORT']) { const t = await adminToken(app, [role]); await http(app).patch(api(`/admin/plans/${plans[0].id}`)).set(bearer(t)).send({ pricePaise: 100 }).expect(403); }
      await http(app).post(api('/admin/plans')).set(bearer(fin)).send({ code: 'monthly', name: 'Dup', durationMonths: 1, pricePaise: 100 }).expect(409);
      const created = await http(app).post(api('/admin/plans')).set(bearer(fin)).send({ code: 'weekly', name: 'Weekly', durationMonths: 1, pricePaise: 4900 }).expect(201);
      expect(created.body.priceDisplay).toBe('₹49');
    });
  });

  describe('checkout', () => {
    it('requires sign-in and takes the price from the server, ignoring anything the client sends', async () => {
      await http(app).post(api('/subscriptions/checkout')).send({ planCode: 'monthly' }).expect(401);
      const v = await viewer();
      await http(app).post(api('/subscriptions/checkout')).set(bearer(v.token)).send({ planCode: 'monthly', amountPaise: 1 }).expect(400); // unknown field rejected
      const ok = await checkout(v.token);
      expect(ok.amountPaise).toBe(14900);
      expect(ok.keyId).toBe('rzp_dev_key');
      expect(JSON.stringify(ok)).not.toMatch(/secret/i);
      await http(app).post(api('/subscriptions/checkout')).set(bearer(v.token)).send({ planCode: 'nope' }).expect(404);
    });

    it('records the order with a snapshot of plan, price and duration, and is idempotent for repeated taps', async () => {
      const v = await viewer();
      const a = await checkout(v.token, 'annual'); const b = await checkout(v.token, 'annual');
      expect(b.orderId).toBe(a.orderId);
      expect(await repo(Payment).count({ where: { userId: v.id } })).toBe(1);
      const p = await repo(Payment).findOneByOrFail({ id: a.paymentId });
      expect(p).toMatchObject({ planCode: 'annual', durationMonths: 12, amountPaise: '119900', currency: 'INR', status: PaymentStatus.Created, provider: 'dev' });
      const other = await checkout(v.token, 'monthly');
      expect(other.orderId).not.toBe(a.orderId);
    });

    it('if the gateway is down: 502, the attempt is marked FAILED, and no access is granted', async () => {
      const v = await viewer();
      gw().failNextOrder = true;
      const r = await http(app).post(api('/subscriptions/checkout')).set(bearer(v.token)).send({ planCode: 'monthly' }).expect(502);
      expect(r.body.code).toBe('PAYMENT_GATEWAY_ERROR');
      expect(await repo(Payment).findOneByOrFail({ userId: v.id })).toMatchObject({ status: PaymentStatus.Failed, failureCode: 'GATEWAY_ERROR' });
      expect((await me(v.token)).active).toBe(false);
      await checkout(v.token); // a retry works
    });

    it('returns 503 when payments are not configured', async () => {
      const off = await createApp({ PAYMENT_GATEWAY: 'none' });
      try {
        const v = await viewerViaOtp(off);
        const r = await http(off).post(api('/subscriptions/checkout')).set(bearer(v.accessToken)).send({ planCode: 'monthly' }).expect(503);
        expect(r.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
        await http(off).post(api('/payments/razorpay/webhook')).set('x-razorpay-signature', 'x').send({}).expect(503);
      } finally { await off.close(); }
    });
  });

  describe('the client callback is verified, never trusted', () => {
    it('happy path: pay -> verify -> exactly one month of access starting now', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      expect((await me(v.token)).active).toBe(false);
      const gp = payAtGateway(order.orderId);
      const r = await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, gp)).expect(200);
      expect(r.body.status).toBe('ACTIVE');
      expect(r.body.payment).toMatchObject({ status: 'CAPTURED', amountPaise: 14900, amountDisplay: '₹149', method: 'upi' });
      const s = await repo(Subscription).findOneByOrFail({ userId: v.id });
      expect(s.status).toBe(SubscriptionStatus.Active);
      expect(Math.abs(s.startsAt.getTime() - Date.now())).toBeLessThan(10_000);
      expect(s.endsAt.toISOString()).toBe(addMonthsUtc(s.startsAt, 1).toISOString());
      const m = await me(v.token);
      expect(m.active).toBe(true);
      expect(new Date(m.entitledUntil).toISOString()).toBe(s.endsAt.toISOString());
    });

    it('a forged or altered signature grants nothing', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      for (const bad of ['', 'a'.repeat(64), gw().signCheckout(order.orderId, 'pay_other'), gw().signCheckout('order_other', gp.id)]) {
        const r = await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: bad });
        expect(r.status).toBe(400);
      }
      expect(await subCount(v.id)).toBe(0);
      expect((await me(v.token)).active).toBe(false);
    });

    it('a VALID signature still grants nothing unless the gateway itself reports the money was captured', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const created = payAtGateway(order.orderId, { outcome: 'created' });
      const r = await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, created)).expect(200);
      expect(r.body.status).toBe('PENDING');
      expect(await subCount(v.id)).toBe(0);
      const unknown = { razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_never_existed', razorpay_signature: gw().signCheckout(order.orderId, 'pay_never_existed') };
      expect((await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(unknown).expect(200)).body.status).toBe('PENDING');
      expect(await subCount(v.id)).toBe(0);
    });

    it('a failed payment is recorded, grants nothing, and the user can pay again', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const failed = payAtGateway(order.orderId, { outcome: 'failed' });
      const r = await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, failed)).expect(200);
      expect(r.body.status).toBe('FAILED');
      expect(r.body.payment).toMatchObject({ status: 'FAILED', failureReason: 'Payment failed (simulated)' });
      expect((await me(v.token)).active).toBe(false);
      const retry = payAtGateway(order.orderId); // same order, second attempt succeeds
      await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, retry)).expect(200);
      expect((await me(v.token)).active).toBe(true);
      expect((await repo(Payment).findOneByOrFail({ userId: v.id })).status).toBe(PaymentStatus.Captured);
    });

    it('you can only verify YOUR order', async () => {
      const a = await viewer(); const b = await viewer();
      const order = await checkout(a.token);
      const gp = payAtGateway(order.orderId);
      await http(app).post(api('/subscriptions/verify')).set(bearer(b.token)).send(checkoutTriple(order.orderId, gp)).expect(404);
      expect(await subCount(b.id)).toBe(0);
    });

    it('a cheap order\'s payment cannot be used to unlock an expensive plan (order/payment binding)', async () => {
      const v = await viewer();
      const cheap = await checkout(v.token, 'monthly'); const dear = await checkout(v.token, 'annual');
      const paidCheap = payAtGateway(cheap.orderId);
      const r = await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send({ razorpay_order_id: dear.orderId, razorpay_payment_id: paidCheap.id, razorpay_signature: gw().signCheckout(dear.orderId, paidCheap.id) }).expect(400);
      expect(r.body.code).toBe('ORDER_MISMATCH');
      expect(await subCount(v.id)).toBe(0);
    });

    it('a payment for the wrong AMOUNT is refused, flagged, and never activated', async () => {
      const v = await viewer();
      const order = await checkout(v.token, 'annual');
      const underpaid = payAtGateway(order.orderId, { amountPaise: 100 });
      const r = await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, underpaid)).expect(409);
      expect(r.body.code).toBe('AMOUNT_MISMATCH');
      expect(await subCount(v.id)).toBe(0);
      const wrongCurrency = payAtGateway(order.orderId, { currency: 'USD' });
      await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, wrongCurrency)).expect(409);
      expect(await subCount(v.id)).toBe(0);
      const [audit] = await dsOf(app).query("SELECT action FROM audit_logs WHERE action = 'payment.amount_mismatch' LIMIT 1");
      expect(audit.action).toBe('payment.amount_mismatch');
    });

    it('there is no way to claim payment: a client-set flag or fake callback never grants access', async () => {
      const v = await viewer();
      await checkout(v.token);
      await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send({ razorpay_order_id: 'x', razorpay_payment_id: 'y', razorpay_signature: 'z', paid: true }).expect(400);
      await http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send({ razorpay_order_id: 'order_fake', razorpay_payment_id: 'pay_fake', razorpay_signature: 'sig' }).expect(404);
      await http(app).patch(api('/me/profile')).set(bearer(v.token)).send({ subscribed: true, plan: 'annual' }).expect(400);
      expect((await me(v.token)).active).toBe(false);
    });

    it('the dev simulator goes through the same signature and gateway checks (and is invisible to others)', async () => {
      const a = await viewer(); const b = await viewer();
      const order = await checkout(a.token);
      await http(app).post(api(`/dev/payments/${order.orderId}/complete`)).set(bearer(b.token)).send({}).expect(403);
      const triple = (await http(app).post(api(`/dev/payments/${order.orderId}/complete`)).set(bearer(a.token)).send({}).expect(200)).body;
      expect((await me(a.token)).active).toBe(true); // activated by the signed webhook, before the client even called verify
      expect((await http(app).post(api('/subscriptions/verify')).set(bearer(a.token)).send(triple).expect(200)).body.status).toBe('ACTIVE');
      expect(await subCount(a.id)).toBe(1); // callback + webhook: still one
    });
  });

  describe('webhooks', () => {
    it('rejects a missing, wrong or tampered signature and stores nothing', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      const raw = eventBody('payment.captured', gp);
      await deliver(raw, { omitSig: true }).expect(400);
      await deliver(raw, { sig: 'f'.repeat(64) }).expect(400);
      await deliver(raw, { sig: gw().signWebhook(raw + ' ') }).expect(400);
      await deliver(raw.replace('"captured"', '"captured" '), { sig: gw().signWebhook(raw) }).expect(400); // same JSON, different bytes
      expect(await repo(PaymentWebhookEvent).count()).toBe(0);
      expect(await subCount(v.id)).toBe(0);
    });

    it('a valid payment.captured webhook activates the subscription', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      const r = await captureViaWebhook(gp).expect(200);
      expect(r.body).toEqual({ received: true, duplicate: false });
      expect((await me(v.token)).active).toBe(true);
      expect(await repo(PaymentWebhookEvent).findOneByOrFail({ eventType: 'payment.captured' })).toMatchObject({ status: WebhookStatus.Processed, note: 'activated' });
    });

    it('a redelivered event is acknowledged but never extends access again', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      await captureViaWebhook(gp, 'evt_same_one').expect(200);
      const before = await repo(Subscription).findOneByOrFail({ userId: v.id });
      for (let i = 0; i < 3; i++) { const r = await captureViaWebhook(gp, 'evt_same_one').expect(200); expect(r.body.duplicate).toBe(true); }
      expect(await subCount(v.id)).toBe(1);
      expect((await repo(Subscription).findOneByOrFail({ userId: v.id })).endsAt.toISOString()).toBe(before.endsAt.toISOString());
      expect(await repo(PaymentWebhookEvent).count()).toBe(1);
    });

    it('the SAME payment announced by different events (captured, then order.paid) still activates once', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      await captureViaWebhook(gp, 'evt_a').expect(200);
      await deliver(eventBody('order.paid', gp), { eventId: 'evt_b' }).expect(200);
      await deliver(eventBody('payment.captured', gp), { eventId: 'evt_c' }).expect(200);
      expect(await subCount(v.id)).toBe(1);
      expect(await repo(Entitlement).count({ where: { userId: v.id } })).toBe(1);
    });

    it('callback and webhook arriving at the same instant: exactly ONE subscription, exactly one month', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      const results = await Promise.all([
        http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, gp)),
        captureViaWebhook(gp, 'evt_race_1'), captureViaWebhook(gp, 'evt_race_2'),
        http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, gp)),
      ]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await subCount(v.id)).toBe(1);
      expect(await repo(Entitlement).count({ where: { userId: v.id } })).toBe(1);
      const s = await repo(Subscription).findOneByOrFail({ userId: v.id });
      expect(s.endsAt.toISOString()).toBe(addMonthsUtc(s.startsAt, 1).toISOString());
    });

    it('many parallel verify calls for one order are safe', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId);
      const rs = await Promise.all(Array.from({ length: 8 }, () => http(app).post(api('/subscriptions/verify')).set(bearer(v.token)).send(checkoutTriple(order.orderId, gp))));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(await subCount(v.id)).toBe(1);
    });

    it('a late payment.failed never downgrades a captured payment (out-of-order delivery)', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const failedAttempt = payAtGateway(order.orderId, { outcome: 'failed' });
      const good = payAtGateway(order.orderId);
      await captureViaWebhook(good).expect(200);
      await deliver(eventBody('payment.failed', failedAttempt)).expect(200);
      expect((await repo(Payment).findOneByOrFail({ userId: v.id })).status).toBe(PaymentStatus.Captured);
      expect((await me(v.token)).active).toBe(true);
      expect(await repo(PaymentWebhookEvent).findOneByOrFail({ eventType: 'payment.failed' })).toMatchObject({ status: WebhookStatus.Ignored });
    });

    it('a failure followed by a successful retry ends up active', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      await deliver(eventBody('payment.failed', payAtGateway(order.orderId, { outcome: 'failed' }))).expect(200);
      expect((await repo(Payment).findOneByOrFail({ userId: v.id })).status).toBe(PaymentStatus.Failed);
      expect((await me(v.token)).active).toBe(false);
      await captureViaWebhook(payAtGateway(order.orderId)).expect(200);
      expect((await me(v.token)).active).toBe(true);
    });

    it('payment.failed alone: recorded with the reason, no access', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      await deliver(eventBody('payment.failed', payAtGateway(order.orderId, { outcome: 'failed' }))).expect(200);
      expect(await repo(Payment).findOneByOrFail({ userId: v.id })).toMatchObject({ status: PaymentStatus.Failed, failureCode: 'BAD_REQUEST_ERROR', failureReason: 'Payment failed (simulated)' });
      expect(await subCount(v.id)).toBe(0);
    });

    it('a webhook with a tampered amount is acknowledged but flagged and NOT activated', async () => {
      const v = await viewer();
      const order = await checkout(v.token, 'annual');
      const gp = payAtGateway(order.orderId, { amountPaise: 100 });
      await captureViaWebhook(gp).expect(200);
      expect(await subCount(v.id)).toBe(0);
      expect(await repo(PaymentWebhookEvent).findOneByOrFail({ eventType: 'payment.captured' })).toMatchObject({ status: WebhookStatus.Failed, note: expect.stringContaining('AMOUNT_MISMATCH') });
    });

    it('unknown orders, unknown event types and malformed bodies are handled without side effects', async () => {
      const foreign: GatewayPayment = { id: 'pay_x', orderId: 'order_not_ours', amountPaise: 100, currency: 'INR', status: 'captured', method: 'upi', errorCode: null, errorDescription: null };
      expect((await captureViaWebhook(foreign).expect(200)).body.received).toBe(true);
      expect(await repo(PaymentWebhookEvent).findOneByOrFail({ eventType: 'payment.captured' })).toMatchObject({ status: WebhookStatus.Ignored, note: 'unknown order' });
      await deliver(JSON.stringify({ event: 'subscription.charged', payload: {} })).expect(200);
      const bad = 'not json at all';
      await deliver(bad, { sig: gw().signWebhook(bad) }).expect(400);
      const noEvent = JSON.stringify({ payload: {} });
      await deliver(noEvent).expect(400);
      expect(await repo(Subscription).count()).toBe(0);
    });

    it('payment.authorized is captured through the gateway and then activates', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId, { outcome: 'authorized' });
      await deliver(eventBody('payment.authorized', gp)).expect(200);
      expect((await me(v.token)).active).toBe(true);
      expect((await gw().fetchPayment(gp.id))!.status).toBe('captured');
    });

    it('if OUR processing fails, the provider gets a 5xx (so it retries), the event is kept FAILED, and a redelivery succeeds', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId, { outcome: 'authorized' });
      const spy = jest.spyOn(gw(), 'capturePayment').mockRejectedValueOnce(new Error('gateway timeout'));
      await deliver(eventBody('payment.authorized', gp), { eventId: 'evt_flaky' }).expect(500);
      spy.mockRestore();
      const stored = await repo(PaymentWebhookEvent).findOneByOrFail({ providerEventId: 'evt_flaky' });
      expect(stored.status).toBe(WebhookStatus.Failed);
      expect(await subCount(v.id)).toBe(0);
      const again = await deliver(eventBody('payment.authorized', gp), { eventId: 'evt_flaky' }).expect(200); // the provider's retry
      expect(again.body.duplicate).toBe(false);
      expect((await repo(PaymentWebhookEvent).findOneByOrFail({ providerEventId: 'evt_flaky' })).attempts).toBe(2);
      expect(await subCount(v.id)).toBe(1);
    });

    it('the background retry job recovers failed events by itself', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      const gp = payAtGateway(order.orderId, { outcome: 'authorized' });
      jest.spyOn(gw(), 'capturePayment').mockRejectedValueOnce(new Error('timeout'));
      await deliver(eventBody('payment.authorized', gp), { eventId: 'evt_retry_job' }).expect(500);
      jest.restoreAllMocks();
      const r = await app.get(PaymentsService).retryFailedEvents();
      expect(r).toMatchObject({ retried: 1, recovered: 1 });
      expect(await subCount(v.id)).toBe(1);
    });
  });

  describe('periods, stacking and expiry', () => {
    async function buy(token: string, plan: string) { const o = await checkout(token, plan); const gp = payAtGateway(o.orderId); await captureViaWebhook(gp).expect(200); return gp; }

    it('a second purchase starts when the first ends (periods stack, never overlap or waste days)', async () => {
      const v = await viewer();
      await buy(v.token, 'monthly'); await buy(v.token, 'quarterly');
      const [a, b] = await repo(Subscription).find({ where: { userId: v.id }, order: { id: 'ASC' } });
      expect(b.startsAt.toISOString()).toBe(a.endsAt.toISOString());
      expect(b.endsAt.toISOString()).toBe(addMonthsUtc(a.endsAt, 3).toISOString());
      expect(new Date((await me(v.token)).entitledUntil).toISOString()).toBe(b.endsAt.toISOString());
    });

    it('two different payments for one user activating AT THE SAME TIME still stack correctly', async () => {
      const v = await viewer();
      const o1 = await checkout(v.token, 'monthly'); const o2 = await checkout(v.token, 'annual');
      const g1 = payAtGateway(o1.orderId); const g2 = payAtGateway(o2.orderId);
      await Promise.all([captureViaWebhook(g1), captureViaWebhook(g2)]);
      const rows = await repo(Subscription).find({ where: { userId: v.id }, order: { startsAt: 'ASC' } });
      expect(rows).toHaveLength(2);
      expect(rows[1].startsAt.toISOString()).toBe(rows[0].endsAt.toISOString()); // no overlap, no gap
      expect(new Date((await me(v.token)).entitledUntil).toISOString()).toBe(rows[1].endsAt.toISOString()); // access runs to the end of the LAST period
      expect(rows[0].endsAt.getTime() - rows[0].startsAt.getTime()).toBeGreaterThan(0);
    });

    it('each plan grants its own length', async () => {
      const v = await viewer();
      for (const [plan, months] of [['monthly', 1], ['quarterly', 3], ['annual', 12]] as const) {
        const w = await viewer(); await buy(w.token, plan);
        const s = await repo(Subscription).findOneByOrFail({ userId: w.id });
        expect(s.endsAt.toISOString()).toBe(addMonthsUtc(s.startsAt, months).toISOString());
      }
      void v;
    });

    it('expired access is denied immediately by the clock (no cron needed), and bookkeeping marks it EXPIRED', async () => {
      const v = await viewer();
      await buy(v.token, 'monthly');
      await dsOf(app).query('UPDATE entitlements SET ends_at = NOW(3) - INTERVAL 1 SECOND, starts_at = NOW(3) - INTERVAL 1 MONTH WHERE user_id = ?', [v.id]);
      await dsOf(app).query('UPDATE subscriptions SET ends_at = NOW(3) - INTERVAL 1 SECOND WHERE user_id = ?', [v.id]);
      const m = await me(v.token);
      expect(m.active).toBe(false);
      expect(await app.get(SubscriptionsService).expireDue()).toBe(1);
      expect((await repo(Subscription).findOneByOrFail({ userId: v.id })).status).toBe(SubscriptionStatus.Expired);
      expect(await app.get(SubscriptionsService).expireDue()).toBe(0);
    });

    it('cancelling records intent but keeps access until the period ends', async () => {
      const v = await viewer();
      await http(app).post(api('/subscriptions/cancel')).set(bearer(v.token)).expect(409); // nothing to cancel
      await buy(v.token, 'monthly');
      const r = await http(app).post(api('/subscriptions/cancel')).set(bearer(v.token)).expect(200);
      expect(r.body.active).toBe(true);
      expect(r.body.current.cancelAtPeriodEnd).toBe(true);
    });

    it('payment history is private and shows exact amounts', async () => {
      const a = await viewer(); const b = await viewer();
      await buy(a.token, 'annual');
      const mine = (await http(app).get(api('/payments/me')).set(bearer(a.token)).expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ planCode: 'annual', amountPaise: 119900, amountDisplay: '₹1,199', status: 'CAPTURED' });
      expect((await http(app).get(api('/payments/me')).set(bearer(b.token)).expect(200)).body).toEqual([]);
      await http(app).get(api('/payments/me')).expect(401);
    });
  });

  describe('refunds', () => {
    async function paid(plan = 'annual') { const v = await viewer(); const o = await checkout(v.token, plan); const gp = payAtGateway(o.orderId); await captureViaWebhook(gp).expect(200); return { v, o, gp, paymentId: o.paymentId }; }
    const refund = (token: string, id: string, body: object) => http(app).post(api(`/admin/payments/${id}/refund`)).set(bearer(token)).send(body);

    it('a full refund ends the access that payment bought, and marks everything REFUNDED', async () => {
      const { v, paymentId } = await paid();
      const fin = await adminToken(app, ['FINANCE']);
      const r = await refund(fin, paymentId, { reason: 'Customer request' }).expect(200);
      expect(r.body).toMatchObject({ amountPaise: 119900, amountDisplay: '₹1,199', status: 'PROCESSED', paymentStatus: 'REFUNDED' });
      expect((await me(v.token)).active).toBe(false);
      expect(await repo(Payment).findOneByOrFail({ id: paymentId })).toMatchObject({ status: PaymentStatus.Refunded, refundedPaise: '119900' });
      expect((await repo(Subscription).findOneByOrFail({ userId: v.id })).status).toBe(SubscriptionStatus.Refunded);
      expect((await repo(Entitlement).findOneByOrFail({ userId: v.id })).revokedAt).not.toBeNull();
      await refund(fin, paymentId, { reason: 'again' }).expect(409); // already fully refunded
    });

    it('a partial refund keeps access; further refunds cannot exceed the remaining amount', async () => {
      const { v, paymentId } = await paid('annual');
      const fin = await adminToken(app, ['FINANCE']);
      await refund(fin, paymentId, { amountPaise: 20000, reason: 'Goodwill' }).expect(200);
      expect(await repo(Payment).findOneByOrFail({ id: paymentId })).toMatchObject({ status: PaymentStatus.PartiallyRefunded, refundedPaise: '20000' });
      expect((await me(v.token)).active).toBe(true);
      const over = await refund(fin, paymentId, { amountPaise: 100000, reason: 'Too much' }).expect(400);
      expect(over.body.code).toBe('INVALID_REFUND_AMOUNT');
      await refund(fin, paymentId, { amountPaise: 99900, reason: 'The rest' }).expect(200);
      expect((await me(v.token)).active).toBe(false);
    });

    it('concurrent refunds can never refund more than the payment', async () => {
      const { paymentId } = await paid('annual');
      const fin = await adminToken(app, ['FINANCE']);
      const rs = await Promise.all([1, 2, 3, 4].map(() => refund(fin, paymentId, { amountPaise: 60000, reason: 'Race' })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      const total = await dsOf(app).query("SELECT COALESCE(SUM(amount_paise),0) AS s FROM refunds WHERE payment_id = ? AND status IN ('PENDING','PROCESSED')", [paymentId]);
      expect(Number(total[0].s)).toBeLessThanOrEqual(119900);
    });

    it('refunding one of two stacked purchases removes only that period', async () => {
      const v = await viewer();
      const o1 = await checkout(v.token, 'monthly'); await captureViaWebhook(payAtGateway(o1.orderId));
      const o2 = await checkout(v.token, 'monthly'); await captureViaWebhook(payAtGateway(o2.orderId));
      const fin = await adminToken(app, ['FINANCE']);
      await refund(fin, o2.paymentId, { reason: 'Changed mind' }).expect(200);
      const m = await me(v.token);
      expect(m.active).toBe(true); // the first month is still paid for
      const first = await repo(Subscription).findOneByOrFail({ paymentId: o1.paymentId });
      expect(new Date(m.entitledUntil).toISOString()).toBe(first.endsAt.toISOString());
    });

    it('only finance-type admins can refund, and unpaid or unknown payments cannot be refunded', async () => {
      const { paymentId } = await paid();
      for (const role of ['EDITOR', 'SUPPORT']) await refund(await adminToken(app, [role]), paymentId, { reason: 'nope' }).expect(403);
      await http(app).post(api(`/admin/payments/${paymentId}/refund`)).send({ reason: 'x' }).expect(401);
      const fin = await adminToken(app, ['FINANCE']);
      const unpaid = await checkout((await viewer()).token);
      await refund(fin, unpaid.paymentId, { reason: 'not paid' }).expect(409);
      await refund(fin, '999999', { reason: 'ghost' }).expect(404);
      await refund(fin, paymentId, { reason: 'ab' }).expect(400); // reason too short
    });

    it('a refund confirmed by webhook is idempotent, and one started in the provider dashboard is recorded', async () => {
      const { v, gp, paymentId } = await paid('monthly');
      const dash = (event: string, id: string) => JSON.stringify({ entity: 'event', event, payload: { refund: { entity: { id, payment_id: gp.id, amount: 14900, status: 'processed' } } } });
      await deliver(dash('refund.processed', 'rfnd_dashboard_1'), { eventId: 'evt_r1' }).expect(200);
      await deliver(dash('refund.processed', 'rfnd_dashboard_1'), { eventId: 'evt_r2' }).expect(200); // different event, same refund
      const refunds = await repo(Refund).find({ where: { paymentId } });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ providerRefundId: 'rfnd_dashboard_1', status: 'PROCESSED', requestedByAdminId: null });
      expect(await repo(Payment).findOneByOrFail({ id: paymentId })).toMatchObject({ status: PaymentStatus.Refunded, refundedPaise: '14900' });
      expect((await me(v.token)).active).toBe(false);
    });

    it('is recorded in the audit log with the acting admin', async () => {
      const { paymentId } = await paid();
      const fin = await createAdmin(app, { roles: ['FINANCE'] });
      const t = await adminLogin(app, fin);
      await refund(t.accessToken, paymentId, { reason: 'Audit me' }).expect(200);
      const rows = await dsOf(app).query("SELECT actor_type, actor_id FROM audit_logs WHERE action = 'payment.refund' AND entity_id = ?", [paymentId]);
      expect(rows[0]).toMatchObject({ actor_type: 'ADMIN', actor_id: fin.id });
    });
  });

  describe('reconciliation (lost webhooks, closed browser tabs)', () => {
    it('activates a payment that was captured at the gateway but whose webhook and callback never arrived, exactly once', async () => {
      const v = await viewer();
      const order = await checkout(v.token);
      payAtGateway(order.orderId); // paid; nobody told us
      expect((await me(v.token)).active).toBe(false);
      const svc = app.get(PaymentsService);
      expect(await svc.reconcilePending({ olderThanMinutes: 0 })).toMatchObject({ checked: 1, activated: 1, errors: 0 });
      expect((await me(v.token)).active).toBe(true);
      expect((await svc.reconcilePending({ olderThanMinutes: 0 })).activated).toBe(0); // idempotent
      expect(await subCount(v.id)).toBe(1);
    });

    it('does not touch unpaid or too-recent orders, and the admin endpoint is permission-checked', async () => {
      const v = await viewer();
      const unpaid = await checkout(v.token);
      const svc = app.get(PaymentsService);
      expect((await svc.reconcilePending({ olderThanMinutes: 0 })).activated).toBe(0);
      payAtGateway(unpaid.orderId);
      expect((await svc.reconcilePending({ olderThanMinutes: 60 })).checked).toBe(0); // too recent to be considered lost
      const support = await adminToken(app, ['SUPPORT']); const finance = await adminToken(app, ['FINANCE']);
      await http(app).post(api('/admin/payments/reconcile')).set(bearer(support)).expect(403);
      const r = await http(app).post(api('/admin/payments/reconcile')).set(bearer(finance)).expect(200);
      expect(r.body.activated).toBe(1);
    });

    it('survives a gateway error for one payment without blocking the rest', async () => {
      const v = await viewer(); const w = await viewer();
      const a = await checkout(v.token); const b = await checkout(w.token);
      payAtGateway(b.orderId);
      const spy = jest.spyOn(gw(), 'fetchOrderPayments').mockImplementationOnce(async () => { throw new Error('gateway down'); });
      const r = await app.get(PaymentsService).reconcilePending({ olderThanMinutes: 0 });
      spy.mockRestore();
      expect(r.errors).toBe(1);
      expect(r.activated).toBe(1);
      void a;
    });
  });

  describe('admin: grants, revokes and visibility', () => {
    it('lets finance grant and revoke access with an audit trail; viewers cannot', async () => {
      const v = await viewer();
      const fin = await adminToken(app, ['FINANCE']);
      const grant = await http(app).post(api(`/admin/users/${v.id}/grant-subscription`)).set(bearer(fin)).send({ planCode: 'monthly', reason: 'Support goodwill' }).expect(200);
      expect(grant.body).toMatchObject({ planName: 'Monthly', source: 'ADMIN_GRANT', status: 'ACTIVE' });
      expect((await me(v.token)).active).toBe(true);
      await http(app).post(api(`/admin/subscriptions/${grant.body.id}/revoke`)).set(bearer(fin)).send({ reason: 'granted by mistake' }).expect(200);
      expect((await me(v.token)).active).toBe(false);
      await http(app).post(api(`/admin/subscriptions/${grant.body.id}/revoke`)).set(bearer(fin)).send({ reason: 'again again' }).expect(409);
      await http(app).post(api(`/admin/users/${v.id}/grant-subscription`)).set(bearer(v.token)).send({ planCode: 'annual', reason: 'give me free' }).expect(401);
      const editor = await adminToken(app, ['EDITOR']);
      await http(app).post(api(`/admin/users/${v.id}/grant-subscription`)).set(bearer(editor)).send({ planCode: 'annual', reason: 'sneaky' }).expect(403);
      await http(app).post(api('/admin/users/999999/grant-subscription')).set(bearer(fin)).send({ planCode: 'annual', reason: 'ghost' }).expect(404);
      const audit = await dsOf(app).query("SELECT action FROM audit_logs WHERE action IN ('subscription.grant','subscription.revoke') ORDER BY id");
      expect(audit.map((a: { action: string }) => a.action)).toEqual(['subscription.grant', 'subscription.revoke']);
    });

    it('lists payments and webhook events for finance, with filters, and hides them from other roles', async () => {
      const v = await viewer(); const order = await checkout(v.token);
      await captureViaWebhook(payAtGateway(order.orderId));
      const fin = await adminToken(app, ['FINANCE']);
      const list = (await http(app).get(api('/admin/payments?status=CAPTURED')).set(bearer(fin)).expect(200)).body;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ planCode: 'monthly', amountDisplay: '₹149', userId: v.id });
      expect((await http(app).get(api('/admin/payments?status=FAILED')).set(bearer(fin)).expect(200)).body.items).toHaveLength(0);
      await http(app).get(api('/admin/payments?status=BOGUS')).set(bearer(fin)).expect(400);
      const detail = (await http(app).get(api(`/admin/payments/${list.items[0].id}`)).set(bearer(fin)).expect(200)).body;
      expect(detail.webhookEvents).toHaveLength(1);
      expect(detail.subscriptionId).not.toBeNull();
      const events = (await http(app).get(api('/admin/webhook-events')).set(bearer(fin)).expect(200)).body;
      expect(events[0]).not.toHaveProperty('payload'); // raw payloads are not listed
      const editorToken = await adminToken(app, ['EDITOR']);
      await http(app).get(api('/admin/payments')).set(bearer(editorToken)).expect(403);
      await http(app).get(api('/admin/payments')).set(bearer(v.token)).expect(401);
    });
  });

  describe('database guarantees', () => {
    it('a payment can create at most one subscription (unique key), even if application code were wrong', async () => {
      const v = await viewer(); const order = await checkout(v.token);
      await captureViaWebhook(payAtGateway(order.orderId));
      const s = await repo(Subscription).findOneByOrFail({ userId: v.id });
      await expect(repo(Subscription).insert({ userId: v.id, planId: s.planId, paymentId: s.paymentId, source: s.source, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt })).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
    });

    it('financial records cannot be destroyed by deleting a user or a plan (RESTRICT, no cascade)', async () => {
      const v = await viewer(); const order = await checkout(v.token);
      await captureViaWebhook(payAtGateway(order.orderId));
      await expect(repo(User).delete({ id: v.id })).rejects.toMatchObject({ driverError: { code: 'ER_ROW_IS_REFERENCED_2' } });
      await expect(repo(SubscriptionPlan).delete({ code: 'monthly' })).rejects.toMatchObject({ driverError: { code: 'ER_ROW_IS_REFERENCED_2' } });
      await expect(repo(Payment).delete({ id: order.paymentId })).rejects.toMatchObject({ driverError: { code: 'ER_ROW_IS_REFERENCED_2' } });
      expect(await repo(Payment).count()).toBe(1);
    });

    it('a provider payment id can be attached to only one payment', async () => {
      const a = await viewer(); const b = await viewer();
      const oa = await checkout(a.token); const ob = await checkout(b.token);
      const gp = payAtGateway(oa.orderId);
      await captureViaWebhook(gp);
      await expect(repo(Payment).update({ id: ob.paymentId }, { providerPaymentId: gp.id })).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
    });

    it('a suspended account that already paid keeps its record but gets no playback until restored', async () => {
      const v = await viewer(); const order = await checkout(v.token);
      await captureViaWebhook(payAtGateway(order.orderId));
      await repo(User).update(v.id, { status: UserStatus.Suspended });
      await http(app).get(api('/subscriptions/me')).set(bearer(v.token)).expect(403);
      expect(await repo(Payment).count({ where: { userId: v.id } })).toBe(1);
    });
  });
});
