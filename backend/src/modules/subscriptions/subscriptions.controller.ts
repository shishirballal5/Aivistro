import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserContext } from '../../common/auth/auth.types';
import { UserAuthGuard } from '../../common/auth/guards';
import { CurrentUser } from '../../common/decorators/params';
import { perMinute } from '../../common/throttler/limits';
import { PaymentsService } from '../payments/payments.service';
import { CheckoutDto, VerifyPaymentDto } from './plans.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService, private readonly payments: PaymentsService) {}

  @Get('plans') @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Active subscription plans (prices in paise)' })
  plans() { return this.subs.listActivePlans(); }

  @Post('subscriptions/quote') @HttpCode(200) @UseGuards(UserAuthGuard) @ApiBearerAuth() @perMinute(30)
  @ApiOperation({ summary: 'The exact price you would pay for a plan right now. Buying a longer plan while a shorter one is running deducts the unused value of the old plan and starts the new one immediately.' })
  quote(@CurrentUser() u: UserContext, @Body() dto: CheckoutDto) { return this.payments.quoteView(u.userId, dto.planCode); }

  @Post('subscriptions/checkout') @HttpCode(200) @UseGuards(UserAuthGuard) @ApiBearerAuth() @perMinute(10)
  @ApiOperation({ summary: 'Start a purchase. The price comes from the server-side plan, never from the client.' })
  checkout(@CurrentUser() u: UserContext, @Body() dto: CheckoutDto) { return this.payments.createCheckout(u.userId, dto.planCode); }

  @Post('subscriptions/verify') @HttpCode(200) @UseGuards(UserAuthGuard) @ApiBearerAuth() @perMinute(20)
  @ApiOperation({ summary: 'Called after checkout. Verifies the signature AND re-reads the payment from the gateway; access is granted only if the gateway confirms it.' })
  verify(@CurrentUser() u: UserContext, @Body() dto: VerifyPaymentDto) { return this.payments.verifyClientPayment(u.userId, dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature); }

  @Get('subscriptions/me') @Header('Cache-Control', 'private, no-store') @UseGuards(UserAuthGuard) @ApiBearerAuth()
  mine(@CurrentUser() u: UserContext) { return this.subs.forUser(u.userId); }

  @Post('subscriptions/cancel') @HttpCode(200) @UseGuards(UserAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark the current subscription as not to be renewed. Access continues to the end of the paid period.' })
  cancel(@CurrentUser() u: UserContext) { return this.subs.cancelAtPeriodEnd(u.userId); }

  @Get('payments/me') @Header('Cache-Control', 'private, no-store') @UseGuards(UserAuthGuard) @ApiBearerAuth()
  history(@CurrentUser() u: UserContext) { return this.payments.historyForUser(u.userId); }
}
