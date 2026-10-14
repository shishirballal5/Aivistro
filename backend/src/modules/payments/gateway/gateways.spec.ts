import { createHmac } from 'node:crypto';
import { DevPaymentGateway } from './dev.gateway';
import { GatewayError } from './payment-gateway';
import { RazorpayGateway, toGatewayPayment } from '../../../util/thirdparty/razorpay/razorpay.gateway';

const cfg = { gateway: 'razorpay', isProduction: false, razorpay: { keyId: 'rzp_test_abc', keySecret: 'key_secret_value', webhookSecret: 'webhook_secret_value' } } as never;

describe('signature verification (Razorpay algorithm)', () => {
  const gw = new RazorpayGateway(cfg);
  const checkoutSig = (o: string, p: string) => createHmac('sha256', 'key_secret_value').update(`${o}|${p}`).digest('hex');
  const hookSig = (raw: Buffer) => createHmac('sha256', 'webhook_secret_value').update(raw).digest('hex');

  it('accepts a correct checkout signature and rejects any change', () => {
    expect(gw.verifyCheckoutSignature('order_1', 'pay_1', checkoutSig('order_1', 'pay_1'))).toBe(true);
    expect(gw.verifyCheckoutSignature('order_1', 'pay_2', checkoutSig('order_1', 'pay_1'))).toBe(false);
    expect(gw.verifyCheckoutSignature('order_2', 'pay_1', checkoutSig('order_1', 'pay_1'))).toBe(false);
    expect(gw.verifyCheckoutSignature('order_1', 'pay_1', 'deadbeef')).toBe(false);
    expect(gw.verifyCheckoutSignature('order_1', 'pay_1', '')).toBe(false);
  });
  it('verifies webhooks over the exact raw bytes: reformatting the same JSON invalidates the signature', () => {
    const raw = Buffer.from('{"event":"payment.captured","payload":{}}');
    expect(gw.verifyWebhookSignature(raw, hookSig(raw))).toBe(true);
    expect(gw.verifyWebhookSignature(Buffer.from('{"event": "payment.captured","payload":{}}'), hookSig(raw))).toBe(false);
    expect(gw.verifyWebhookSignature(raw, hookSig(Buffer.from('other')))).toBe(false);
    expect(gw.verifyWebhookSignature(raw, '')).toBe(false);
  });
  it('never verifies when a secret is not configured (an empty key must not make every signature valid)', () => {
    const empty = new RazorpayGateway({ gateway: 'razorpay', isProduction: false, razorpay: { keyId: '', keySecret: '', webhookSecret: '' } } as never);
    const raw = Buffer.from('x');
    expect(empty.verifyWebhookSignature(raw, createHmac('sha256', '').update(raw).digest('hex'))).toBe(false);
    expect(empty.verifyCheckoutSignature('o', 'p', createHmac('sha256', '').update('o|p').digest('hex'))).toBe(false);
  });
});

describe('RazorpayGateway HTTP adapter (request shapes, no network)', () => {
  const gw = new RazorpayGateway(cfg);
  let fetchMock: jest.SpyInstance;
  const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  beforeEach(() => { fetchMock = jest.spyOn(global, 'fetch'); });
  afterEach(() => fetchMock.mockRestore());
  const lastCall = () => { const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit]; return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined }; };

  it('creates an order with the amount in paise and Basic auth, never exposing the secret in the body', async () => {
    reply(200, { id: 'order_X' });
    expect(await gw.createOrder({ amountPaise: 14900, currency: 'INR', receipt: 'rcpt_1', notes: { a: 'b' } })).toEqual({ orderId: 'order_X' });
    const c = lastCall();
    expect(c.url).toBe('https://api.razorpay.com/v1/orders');
    expect(c.init.method).toBe('POST');
    expect((c.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('rzp_test_abc:key_secret_value').toString('base64')}`);
    expect(c.body).toEqual({ amount: 14900, currency: 'INR', receipt: 'rcpt_1', notes: { a: 'b' } });
    expect(JSON.stringify(c.body)).not.toContain('key_secret_value');
  });
  it('maps payments, including failures, and treats an unknown payment as null', async () => {
    reply(200, { id: 'pay_1', order_id: 'order_1', amount: 14900, currency: 'INR', status: 'captured', method: 'upi' });
    expect(await gw.fetchPayment('pay_1')).toMatchObject({ id: 'pay_1', orderId: 'order_1', amountPaise: 14900, status: 'captured', method: 'upi' });
    reply(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
    expect(await gw.fetchPayment('pay_nope')).toBeNull();
    reply(200, { id: 'pay_2', order_id: 'o', amount: 1, currency: 'INR', status: 'failed', error_code: 'E1', error_description: 'declined' });
    expect(await gw.fetchPayment('pay_2')).toMatchObject({ status: 'failed', errorCode: 'E1', errorDescription: 'declined' });
  });
  it('surfaces provider errors and timeouts as GatewayError, not as success', async () => {
    reply(500, { error: { description: 'boom' } });
    await expect(gw.createOrder({ amountPaise: 1, currency: 'INR', receipt: 'r' })).rejects.toBeInstanceOf(GatewayError);
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(gw.createOrder({ amountPaise: 1, currency: 'INR', receipt: 'r' })).rejects.toThrow('network down');
  });
  it('lists order payments, captures, and refunds with the amount in paise', async () => {
    reply(200, { items: [{ id: 'pay_1', order_id: 'o', amount: 100, currency: 'INR', status: 'authorized' }] });
    expect((await gw.fetchOrderPayments('o'))[0].status).toBe('authorized');
    expect(lastCall().url).toBe('https://api.razorpay.com/v1/orders/o/payments');
    reply(200, { id: 'pay_1', order_id: 'o', amount: 100, currency: 'INR', status: 'captured' });
    await gw.capturePayment('pay_1', 100, 'INR');
    expect(lastCall().body).toEqual({ amount: 100, currency: 'INR' });
    reply(200, { id: 'rfnd_1', status: 'processed' });
    expect(await gw.refund('pay_1', 50, { receipt: 'rfnd_9', reason: 'Customer request' })).toEqual({ refundId: 'rfnd_1', status: 'processed' });
    expect(lastCall().url).toBe('https://api.razorpay.com/v1/payments/pay_1/refund');
    expect(lastCall().body).toMatchObject({ amount: 50, receipt: 'rfnd_9' });
  });
  it('treats unknown statuses as not-yet-paid (never as captured)', () => {
    expect(toGatewayPayment({ id: 'p', order_id: 'o', amount: 1, currency: 'INR', status: 'something_new' }).status).toBe('created');
  });
  it('encodes ids in URLs (no path injection)', async () => {
    reply(400, {});
    await gw.fetchPayment('pay_1/../../orders');
    expect(lastCall().url).toBe('https://api.razorpay.com/v1/payments/pay_1%2F..%2F..%2Forders');
  });
});

describe('DevPaymentGateway (development simulator)', () => {
  const gw = new DevPaymentGateway({ secret: 's'.repeat(40) } as never);
  it('behaves like a gateway: orders, payments, signatures, refunds', async () => {
    const { orderId } = await gw.createOrder({ amountPaise: 14900, currency: 'INR', receipt: 'r' });
    const p = gw.simulatePayment(orderId);
    expect(await gw.fetchPayment(p.id)).toMatchObject({ status: 'captured', amountPaise: 14900 });
    expect(gw.verifyCheckoutSignature(orderId, p.id, gw.signCheckout(orderId, p.id))).toBe(true);
    expect(gw.verifyCheckoutSignature(orderId, p.id, 'bad')).toBe(false);
    const raw = Buffer.from('{}');
    expect(gw.verifyWebhookSignature(raw, gw.signWebhook(raw))).toBe(true);
    expect((await gw.refund(p.id, 100, { receipt: 'x', reason: 'y' })).status).toBe('processed');
    expect(() => gw.simulatePayment('order_unknown')).toThrow();
  });
});
