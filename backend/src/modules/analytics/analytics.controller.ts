import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, Matches, ValidateNested } from 'class-validator';
import { UserContext } from '../../common/auth/auth.types';
import { AdminAuthGuard, OptionalUserAuthGuard, RequirePermissions } from '../../common/auth/guards';
import { MaybeUser } from '../../common/decorators/params';
import { perMinute } from '../../common/throttler/limits';
import { IsOptional } from '../../common/validation';
import { AnalyticsService, CLIENT_EVENT_TYPES } from './analytics.service';
import { DashboardService } from './dashboard.service';

class ClientEventDto {
  @IsIn(CLIENT_EVENT_TYPES) type: (typeof CLIENT_EVENT_TYPES)[number];
  @IsOptional() @IsIn(['series', 'episode', 'banner']) entityType?: string;
  @IsOptional() @Matches(/^\d{1,20}$/) entityId?: string;
  @IsOptional() @IsObject() properties?: Record<string, unknown>;
}
class EventsDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ClientEventDto) events: ClientEventDto[]; }
class DashboardQuery { @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90]) days?: 7 | 30 | 90; }

@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService, private readonly dashboard: DashboardService) {}

  @Post('analytics/events') @HttpCode(202) @UseGuards(OptionalUserAuthGuard) @ApiBearerAuth() @perMinute(30)
  @ApiOperation({ summary: 'Report client-side usage events (batched, allow-listed). Anonymous callers are allowed.' })
  async ingest(@Body() dto: EventsDto, @MaybeUser() u?: UserContext) {
    await this.analytics.trackMany(dto.events.map((e) => ({ userId: u?.userId ?? null, type: e.type, entityType: e.entityType, entityId: e.entityId, properties: e.properties as never })));
    return { accepted: dto.events.length };
  }

  @Get('admin/dashboard') @UseGuards(AdminAuthGuard) @ApiBearerAuth() @RequirePermissions('analytics.read')
  @ApiOperation({ summary: 'Dashboard metrics for the last 7, 30 or 90 days (cached for 60s)' })
  metrics(@Query() q: DashboardQuery) { return this.dashboard.metrics(q.days ?? 30); }
}
