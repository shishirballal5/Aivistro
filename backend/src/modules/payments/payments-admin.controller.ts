import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsString, Max, Min, Matches, MaxLength } from 'class-validator';
import { IsOptional } from '../../common/validation';
import { AdminContext } from '../../common/auth/auth.types';
import { AdminAuthGuard, RequirePermissions } from '../../common/auth/guards';
import { CurrentAdmin } from '../../common/decorators/params';
import { clampLimit, decodeCursor, encodeCursor } from '../../common/pagination';
import { PageQueryDto } from '../../common/pagination.dto';
import { PaymentStatus, SubscriptionStatus, WebhookStatus } from '../../database/entities/index';
import { Audit } from '../audit-logs/audit.decorator';
import { CreatePlanDto, GrantDto, RefundDto, UpdatePlanDto } from '../subscriptions/plans.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentsService } from './payments.service';
import { SuspendReason } from './reason.dto';

class PaymentListQuery extends PageQueryDto {
  @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @IsOptional() @Matches(/^\d+$/) userId?: string;
}
/** `limit`/`cursor` switch the response from the legacy bare array (first 100 rows) to `{ items, nextCursor }`; max page 100. */
const isPaged = (q: { limit?: number; cursor?: string }) => q.limit !== undefined || q.cursor !== undefined;
const clamp100 = (limit?: number) => clampLimit(limit, 100, 100);
class Page100Query {
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class WebhookListQuery extends Page100Query {
  @IsOptional() @IsEnum(WebhookStatus) status?: WebhookStatus;
  @IsOptional() @IsString() @MaxLength(60) eventType?: string;
}
class SubscriptionListQuery extends Page100Query {
  @IsOptional() @Matches(/^\d+$/) userId?: string;
  @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @IsOptional() @IsString() @MaxLength(30) planCode?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

@ApiTags('admin-payments')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService, private readonly subs: SubscriptionsService) {}

  // plans
  @Get('plans') @RequirePermissions('plans.manage') plans() { return this.subs.listAllPlans(); }
  @Post('plans') @RequirePermissions('plans.manage') @Audit('plan.create', 'plan') createPlan(@Body() d: CreatePlanDto) { return this.subs.createPlan(d); }
  @Patch('plans/:id') @RequirePermissions('plans.manage') @Audit('plan.update', 'plan') updatePlan(@Param('id') id: string, @Body() d: UpdatePlanDto) { return this.subs.updatePlan(id, d); }

  // payments
  @Get('payments') @RequirePermissions('payments.read')
  async list(@Query() q: PaymentListQuery) {
    const cursor = decodeCursor<{ id: number }>(q.cursor, ['id']);
    const r = await this.payments.adminList({ status: q.status, userId: q.userId, cursor: cursor?.id, limit: clampLimit(q.limit) });
    return { items: r.items, nextCursor: r.hasMore && r.lastId ? encodeCursor({ id: r.lastId }) : null };
  }
  @Get('payments/:id') @RequirePermissions('payments.read') get(@Param('id') id: string) { return this.payments.adminGet(id); }

  @Post('payments/:id/refund') @HttpCode(200) @RequirePermissions('payments.refund') @Audit('payment.refund', 'payment')
  refund(@CurrentAdmin() a: AdminContext, @Param('id') id: string, @Body() d: RefundDto) { return this.payments.refundPayment(a.adminId, id, d.amountPaise, d.reason); }

  @Post('payments/reconcile') @HttpCode(200) @RequirePermissions('payments.refund') @Audit('payment.reconcile', 'payment')
  reconcile() { return this.payments.reconcilePending({ olderThanMinutes: 0 }); }

  @Post('payments/:id/recheck') @HttpCode(200) @RequirePermissions('payments.refund') @Audit('payment.recheck', 'payment')
  async recheck(@Param('id') id: string) { return { state: await this.payments.reconcileOne(id) }; }

  @Get('webhook-events') @RequirePermissions('payments.read')
  async events(@Query() q: WebhookListQuery) {
    const cursor = decodeCursor<{ id: number }>(q.cursor, ['id']);
    const r = await this.payments.listWebhookEvents({ status: q.status, eventType: q.eventType, cursor: cursor?.id, limit: clamp100(q.limit) });
    return isPaged(q) ? { items: r.items, nextCursor: r.hasMore && r.lastId ? encodeCursor({ id: r.lastId }) : null } : r.items;
  }
  @Post('webhook-events/retry') @HttpCode(200) @RequirePermissions('payments.refund') @Audit('payment.retry_webhooks') retry() { return this.payments.retryFailedEvents(); }

  // subscriptions
  @Get('subscriptions') @RequirePermissions('subscriptions.read')
  async subscriptions(@Query() q: SubscriptionListQuery) {
    const cursor = decodeCursor<{ id: number }>(q.cursor, ['id']);
    const r = await this.subs.adminList({ userId: q.userId, status: q.status, planCode: q.planCode, q: q.q, cursor: cursor?.id, limit: clamp100(q.limit) });
    return isPaged(q) ? { items: r.items, nextCursor: r.hasMore && r.lastId ? encodeCursor({ id: r.lastId }) : null } : r.items;
  }
  @Post('users/:id/grant-subscription') @HttpCode(200) @RequirePermissions('subscriptions.manage') @Audit('subscription.grant', 'user')
  grant(@CurrentAdmin() a: AdminContext, @Param('id') id: string, @Body() d: GrantDto) { return this.subs.grantByAdmin(a.adminId, id, d.planCode, d.reason); }
  @Post('subscriptions/:id/revoke') @HttpCode(200) @RequirePermissions('subscriptions.manage') @Audit('subscription.revoke', 'subscription')
  revoke(@Param('id') id: string, @Body() d: SuspendReason) { return this.subs.revokeByAdmin(id, d.reason); }
}
