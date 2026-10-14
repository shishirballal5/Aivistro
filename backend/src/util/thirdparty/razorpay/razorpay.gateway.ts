import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { paymentsConfig } from '../../../config/payments.config';
import { GatewayError, GatewayOrderRequest, GatewayPayment, GatewayPaymentStatus, GatewayRefund, PaymentGateway } from '../../../modules/payments/gateway/payment-gateway';

interface RazorpayPaymentEntity { id: string; order_id: string; amount: number; currency: string; status: string; method?: string; error_code?: string | null; error_description?: string | null }
const STATUSES: GatewayPaymentStatus[] = ['created', 'authorized', 'captured', 'failed', 'refunded'];

export const toGatewayPayment = (p: RazorpayPaymentEntity): GatewayPayment => ({
  id: p.id, orderId: p.order_id, amountPaise: p.amount, currency: p.currency,
  status: STATUSES.includes(p.status as GatewayPaymentStatus) ? (p.status as GatewayPaymentStatus) : 'created',
  method: p.method ?? null, errorCode: p.error_code ?? null, errorDescription: p.error_description ?? null,
});

/**
 * Real Razorpay (https://razorpay.com/docs/api/). Needs RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET.
 * NOTE: unit-tested against recorded request/response shapes, but not exercised against Razorpay's live servers in this
 * repository (no credentials). Run a test-mode end-to-end payment before going live.
 */
@Injectable()
export class RazorpayGateway extends PaymentGateway {
  readonly name = 'razorpay';
  readonly enabled = true;
  readonly publicKeyId: string;
  protected readonly keySecret: string;
  protected readonly webhookSecret: string;
  private readonly authHeader: string;

  constructor(@Inject(paymentsConfig.KEY) cfg: ConfigType<typeof paymentsConfig>, private readonly baseUrl = 'https://api.razorpay.com/v1') {
    super();
    this.publicKeyId = cfg.razorpay.keyId;
    this.keySecret = cfg.razorpay.keySecret;
    this.webhookSecret = cfg.razorpay.webhookSecret;
    this.authHeader = `Basic ${Buffer.from(`${cfg.razorpay.keyId}:${cfg.razorpay.keySecret}`).toString('base64')}`;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers: { Authorization: this.authHeader, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let json: { error?: { description?: string; code?: string } } & Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new GatewayError(res.status, json.error?.description ?? `Razorpay responded ${res.status}`);
    return json as T;
  }

  async createOrder(req: GatewayOrderRequest) {
    const o = await this.call<{ id: string }>('POST', '/orders', { amount: req.amountPaise, currency: req.currency, receipt: req.receipt, notes: req.notes ?? {} });
    return { orderId: o.id };
  }
  async fetchPayment(paymentId: string) {
    try { return toGatewayPayment(await this.call<RazorpayPaymentEntity>('GET', `/payments/${encodeURIComponent(paymentId)}`)); }
    catch (e) { if (e instanceof GatewayError && e.httpStatus === 400 || e instanceof GatewayError && e.httpStatus === 404) return null; throw e; }
  }
  async fetchOrderPayments(orderId: string) {
    const r = await this.call<{ items: RazorpayPaymentEntity[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    return r.items.map(toGatewayPayment);
  }
  async capturePayment(paymentId: string, amountPaise: number, currency: string) {
    return toGatewayPayment(await this.call<RazorpayPaymentEntity>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency }));
  }
  async refund(paymentId: string, amountPaise: number, opts: { receipt: string; reason: string }): Promise<GatewayRefund> {
    const r = await this.call<{ id: string; status: string }>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: 'normal', receipt: opts.receipt, notes: { reason: opts.reason.slice(0, 200) } });
    return { refundId: r.id, status: r.status === 'processed' ? 'processed' : r.status === 'failed' ? 'failed' : 'pending' };
  }
}
