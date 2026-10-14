import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { authConfig } from '../../config/auth.config';
import { paymentsConfig } from '../../config/payments.config';
import { Payment, PaymentWebhookEvent, Refund, Subscription, SubscriptionPlan } from '../../database/entities/index';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { SubscriptionsCoreModule } from '../subscriptions/subscriptions-core.module';
import { DevPaymentGateway, DisabledGateway } from './gateway/dev.gateway';
import { PaymentGateway } from './gateway/payment-gateway';
import { RazorpayGateway } from '../../util/thirdparty/razorpay/razorpay.gateway';
import { PaymentsService } from './payments.service';

/** Payment logic without HTTP controllers (also used by the worker for reconciliation). */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, PaymentWebhookEvent, Refund, SubscriptionPlan, Subscription]), SubscriptionsCoreModule, NotificationsCoreModule],
  providers: [
    {
      provide: PaymentGateway,
      inject: [paymentsConfig.KEY, authConfig.KEY],
      useFactory: (p: ConfigType<typeof paymentsConfig>, a: ConfigType<typeof authConfig>): PaymentGateway =>
        p.gateway === 'razorpay' ? new RazorpayGateway(p) : p.gateway === 'dev' && !p.isProduction ? new DevPaymentGateway(a) : new DisabledGateway(),
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PaymentGateway, SubscriptionsCoreModule],
})
export class PaymentsCoreModule {}
