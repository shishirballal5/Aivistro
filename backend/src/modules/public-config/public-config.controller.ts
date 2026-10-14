import { Controller, Get, Header, Inject, NotFoundException, Query } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { appConfig } from '../../config/app.config';
import { authConfig } from '../../config/auth.config';
import { paymentsConfig } from '../../config/payments.config';
import { DevOutbox } from '../../util/thirdparty/sms-email/senders';

/** What this deployment can actually do, so a client never offers a sign-in or payment method that would fail. No secrets. */
@ApiTags('config')
@Controller()
export class PublicConfigController {
  constructor(
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
    @Inject(paymentsConfig.KEY) private readonly pay: ConfigType<typeof paymentsConfig>,
    private readonly outbox: DevOutbox,
  ) {}

  @Get('config') @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Enabled sign-in methods and payment mode' })
  config() {
    return {
      auth: {
        phoneOtp: this.auth.sms.provider !== 'none',
        emailPassword: this.auth.email.provider !== 'none',
        google: this.auth.googleClientIds.length > 0 ? { clientId: this.auth.googleClientIds[0] } : null,
        apple: this.auth.appleClientIds.length > 0 ? { clientId: this.auth.appleClientIds[0] } : null,
      },
      payments: { gateway: this.pay.gateway, keyId: this.pay.gateway === 'razorpay' ? this.pay.razorpay.keyId : null },
      /** True only for development adapters. A client may show developer helpers when this is set. */
      development: { devMessages: this.devMessages, devPayments: this.pay.gateway === 'dev' && !this.pay.isProduction },
    };
  }

  private get devMessages() { return !this.app.isProduction && (this.auth.sms.provider === 'dev' || this.auth.email.provider === 'dev'); }

  /** Development only: read the last OTP / email captured by the dev senders. 404 in production or with real providers. */
  @Get('dev/outbox') @Header('Cache-Control', 'no-store') @ApiExcludeEndpoint()
  devOutbox(@Query('to') to?: string) {
    if (!this.devMessages) throw new NotFoundException();
    const m = to ? this.outbox.last(to.trim().toLowerCase()) ?? this.outbox.last(to.trim()) : undefined;
    return { message: m ? { kind: m.kind, to: m.to, subject: m.subject ?? null, body: m.body, at: m.at } : null };
  }
}
