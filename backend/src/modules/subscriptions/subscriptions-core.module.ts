import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Entitlement, Payment, Subscription, SubscriptionPlan } from '../../database/entities/index';
import { SubscriptionsService } from './subscriptions.service';

/** Subscription logic without HTTP controllers (also used by the worker). */
@Module({ imports: [TypeOrmModule.forFeature([SubscriptionPlan, Subscription, Entitlement, Payment])], providers: [SubscriptionsService], exports: [SubscriptionsService, TypeOrmModule] })
export class SubscriptionsCoreModule {}
