import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities/index';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';
import { PaymentsAdminController } from './payments-admin.controller';
import { PaymentsCoreModule } from './payments-core.module';
import { DevPaymentsController, PaymentsWebhookController } from './payments.controller';

@Module({ imports: [PaymentsCoreModule, TypeOrmModule.forFeature([Payment])], controllers: [SubscriptionsController, PaymentsWebhookController, DevPaymentsController, PaymentsAdminController], exports: [PaymentsCoreModule] })
export class PaymentsModule {}
