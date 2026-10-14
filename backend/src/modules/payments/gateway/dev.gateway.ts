import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { deriveKey, randomToken } from '../../../common/crypto/crypto.util';
import { authConfig } from '../../../config/auth.config';
import { ConfigType } from '@nestjs/config';
import { GatewayError, GatewayOrderRequest, GatewayPayment, GatewayPaymentStatus, GatewayRefund, PaymentGateway } from './payment-gateway';

/**
 * DEVELOPMENT SIMULATOR (PAYMENT_GATEWAY=dev, never allowed in production).
 * It behaves like Razorpay's API from the backend's point of view: orders, payments in states, signatures, refunds.
 * It does NOT bypass any check: the backend still verifies signatures and re-reads payment state from the gateway, so a
 * simulated payment goes through exactly the same code as a real one. State is in memory, so it only exists in this process.
 */
@Injectable()
export class DevPaymentGateway extends PaymentGateway {
  readonly name = 'dev';
  readonly enabled = true;
  readonly publicKeyId = 'rzp_dev_key';
  protected readonly keySecret: string;
  protected readonly webhookSecret: string;
  private readonly orders = new Map<string, GatewayOrderRequest>();
  private readonly payments = new Map<string, GatewayPayment>();
  private readonly refunds = new Map<string, { paymentId: string; amountPaise: number }>();
  failNextOrder = false;

  constructor(@Inject(authConfig.KEY) cfg: ConfigType<typeof authConfig>) {
    super();
    this.keySecret = deriveKey(cfg.secret, 'dev-gateway-key').toString('hex');
    this.webhookSecret = deriveKey(cfg.secret, 'dev-gateway-webhook').toString('hex');
  }

  async createOrder(req: GatewayOrderRequest) {
    if (this.failNextOrder) { this.failNextOrder = false; throw new GatewayError(502, 'Simulated gateway outage'); }
    const orderId = `order_dev_${randomToken(9)}`;
    this.orders.set(orderId, req);
    return { orderId };
  }
  async fetchPayment(paymentId: string) { return this.payments.get(paymentId) ?? null; }
  async fetchOrderPayments(orderId: string) { return [...this.payments.values()].filter((p) => p.orderId === orderId); }
  async capturePayment(paymentId: string, amountPaise: number, currency: string) {
    const p = this.payments.get(paymentId);
    if (!p || p.amountPaise !== amountPaise || p.currency !== currency) throw new GatewayError(400, 'Invalid capture');
    p.status = 'captured';
    return p;
  }
  async refund(paymentId: string, amountPaise: number, _opts?: { receipt: string; reason: string }): Promise<GatewayRefund> {
    const p = this.payments.get(paymentId);
    if (!p || p.status !== 'captured') throw new GatewayError(400, 'Payment is not refundable');
    const refundId = `rfnd_dev_${randomToken(9)}`;
    this.refunds.set(refundId, { paymentId, amountPaise });
    return { refundId, status: 'processed' };
  }

  // ── simulation controls (used by tests and the dev-only controller) ──
  hasOrder(orderId: string) { return this.orders.has(orderId); }
  /** Simulates the customer paying (or failing). `amountPaise` can be overridden to simulate tampering. */
  simulatePayment(orderId: string, o: { outcome?: GatewayPaymentStatus; method?: string; amountPaise?: number; currency?: string } = {}): GatewayPayment {
    const order = this.orders.get(orderId);
    if (!order) throw new GatewayError(400, 'Unknown order');
    const outcome = o.outcome ?? 'captured';
    const p: GatewayPayment = { id: `pay_dev_${randomToken(9)}`, orderId, amountPaise: o.amountPaise ?? order.amountPaise, currency: o.currency ?? order.currency, status: outcome, method: o.method ?? 'upi', errorCode: outcome === 'failed' ? 'BAD_REQUEST_ERROR' : null, errorDescription: outcome === 'failed' ? 'Payment failed (simulated)' : null };
    this.payments.set(p.id, p);
    return p;
  }
  signCheckout(orderId: string, paymentId: string): string { return createHmac('sha256', this.keySecret).update(`${orderId}|${paymentId}`).digest('hex'); }
  signWebhook(raw: Buffer | string): string { return createHmac('sha256', this.webhookSecret).update(raw).digest('hex'); }
}

@Injectable()
export class DisabledGateway extends PaymentGateway {
  readonly name = 'none';
  readonly enabled = false;
  readonly publicKeyId = '';
  protected readonly keySecret = '';
  protected readonly webhookSecret = '';
  private fail(): never { throw new GatewayError(503, 'Payments are not configured'); }
  async createOrder(): Promise<never> { return this.fail(); }
  async fetchPayment(): Promise<never> { return this.fail(); }
  async fetchOrderPayments(): Promise<never> { return this.fail(); }
  async capturePayment(): Promise<never> { return this.fail(); }
  async refund(): Promise<never> { return this.fail(); }
}
