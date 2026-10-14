import { Body, Controller, ForbiddenException, HttpCode, NotFoundException, Param, Post, RawBodyRequest, Req, UseGuards, Headers } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { IsIn, IsString } from 'class-validator';
import { IsOptional } from '../../common/validation';
import { Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserContext } from '../../common/auth/auth.types';
import { UserAuthGuard } from '../../common/auth/guards';
import { randomToken } from '../../common/crypto/crypto.util';
import { CurrentUser } from '../../common/decorators/params';
import { paymentsConfig } from '../../config/payments.config';
import { Payment } from '../../database/entities/index';
import { DevPaymentGateway } from './gateway/dev.gateway';
import { PaymentGateway } from './gateway/payment-gateway';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Razorpay webhook. No user auth: authenticity comes from the HMAC signature over the RAW body.
   * Replies 200 for new, duplicate and ignored events so the provider stops retrying; replies 5xx only if WE failed.
   */
  @Post('razorpay/webhook') @HttpCode(200) @SkipThrottle()
  @ApiOperation({ summary: 'Razorpay webhook receiver (signature-verified, idempotent)' })
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string, @Headers('x-razorpay-event-id') eventId?: string) {
    return this.payments.handleWebhook(req.rawBody, signature, eventId);
  }
}

class SimulateDto {
  @IsOptional() @IsIn(['captured', 'failed', 'authorized']) outcome?: 'captured' | 'failed' | 'authorized';
  @IsOptional() @IsString() method?: string;
}

/**
 * DEVELOPMENT ONLY (PAYMENT_GATEWAY=dev, never in production). Plays the part of the customer's bank + Razorpay's servers:
 * it creates a simulated payment, then delivers a correctly SIGNED webhook through the real webhook endpoint code, and
 * returns what the checkout widget would hand to the frontend. Nothing here skips verification.
 */
@ApiExcludeController()
@Controller('dev/payments')
export class DevPaymentsController {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly payments: PaymentsService,
    @InjectRepository(Payment) private readonly repo: Repository<Payment>,
    @Inject(paymentsConfig.KEY) private readonly cfg: ConfigType<typeof paymentsConfig>,
  ) {}

  @Post(':orderId/complete') @HttpCode(200) @UseGuards(UserAuthGuard) @ApiBearerAuth()
  async complete(@CurrentUser() u: UserContext, @Param('orderId') orderId: string, @Body() dto: SimulateDto) {
    if (this.cfg.isProduction || !(this.gateway instanceof DevPaymentGateway)) throw new NotFoundException();
    const payment = await this.repo.findOne({ where: { providerOrderId: orderId, userId: u.userId } });
    if (!payment) throw new ForbiddenException();
    const outcome = dto.outcome ?? 'captured';
    const gp = this.gateway.simulatePayment(orderId, { outcome, method: dto.method });
    const body = JSON.stringify({ entity: 'event', event: outcome === 'failed' ? 'payment.failed' : outcome === 'authorized' ? 'payment.authorized' : 'payment.captured', payload: { payment: { entity: { id: gp.id, order_id: gp.orderId, amount: gp.amountPaise, currency: gp.currency, status: gp.status, method: gp.method, error_code: gp.errorCode, error_description: gp.errorDescription } } } });
    const raw = Buffer.from(body);
    await this.payments.handleWebhook(raw, this.gateway.signWebhook(raw), `evt_dev_${randomToken(8)}`);
    return { razorpay_order_id: orderId, razorpay_payment_id: gp.id, razorpay_signature: this.gateway.signCheckout(orderId, gp.id) };
  }
}
