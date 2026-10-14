import { createHmac } from 'node:crypto';
import { safeEqual } from '../../../common/crypto/crypto.util';

export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export interface GatewayPayment {
  id: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  status: GatewayPaymentStatus;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}
export interface GatewayOrderRequest { amountPaise: number; currency: string; receipt: string; notes?: Record<string, string> }
export interface GatewayRefund { refundId: string; status: 'pending' | 'processed' | 'failed' }

export class GatewayError extends Error {
  constructor(readonly httpStatus: number, message: string) { super(message); }
}

/**
 * The payment provider boundary. The rest of the system never talks to Razorpay directly, so the real adapter and the
 * development simulator are interchangeable, and signature verification lives in exactly one place.
 */
export abstract class PaymentGateway {
  abstract readonly name: string;
  abstract readonly enabled: boolean;
  /** Public key id shown to the checkout widget. Never the secret. */
  abstract readonly publicKeyId: string;
  protected abstract readonly keySecret: string;
  protected abstract readonly webhookSecret: string;

  abstract createOrder(req: GatewayOrderRequest): Promise<{ orderId: string }>;
  abstract fetchPayment(paymentId: string): Promise<GatewayPayment | null>;
  abstract fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  abstract capturePayment(paymentId: string, amountPaise: number, currency: string): Promise<GatewayPayment>;
  abstract refund(paymentId: string, amountPaise: number, opts: { receipt: string; reason: string }): Promise<GatewayRefund>;

  /** Razorpay checkout signature: HMAC-SHA256(`${order_id}|${payment_id}`, key secret), hex. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.keySecret || !signature) return false;
    return safeEqual(createHmac('sha256', this.keySecret).update(`${orderId}|${paymentId}`).digest('hex'), signature);
  }

  /** Webhook signature: HMAC-SHA256(raw request body bytes, webhook secret), hex. Must be computed on the RAW body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret || !signature) return false;
    return safeEqual(createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex'), signature);
  }
}
