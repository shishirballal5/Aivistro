import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminContext, UserContext } from '../../common/auth/auth.types';
import { AdminAuthGuard, RequirePermissions, UserAuthGuard } from '../../common/auth/guards';
import { CurrentAdmin, CurrentUser } from '../../common/decorators/params';
import { perMinute } from '../../common/throttler/limits';
import { Audit } from '../audit-logs/audit.decorator';
import { CreateCampaignDto, InboxQueryDto, PreferencesDto, RegisterDeviceDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(UserAuthGuard)
@Controller('me')
export class InboxController {
  constructor(private readonly svc: NotificationsService) {}
  @Get('notifications') list(@CurrentUser() u: UserContext, @Query() q: InboxQueryDto) { return this.svc.inboxList(u.userId, q.cursor, q.limit, q.unread === 'true'); }
  @Get('notifications/unread-count') count(@CurrentUser() u: UserContext) { return this.svc.unreadCount(u.userId); }
  @Post('notifications/read-all') @HttpCode(204) readAll(@CurrentUser() u: UserContext) { return this.svc.readAll(u.userId); }
  @Post('notifications/:id/read') @HttpCode(204) read(@CurrentUser() u: UserContext, @Param('id') id: string) { return this.svc.markRead(u.userId, id); }
  @Get('notification-preferences') prefs(@CurrentUser() u: UserContext) { return this.svc.getPreferences(u.userId); }
  @Patch('notification-preferences') setPrefs(@CurrentUser() u: UserContext, @Body() d: PreferencesDto) { return this.svc.setPreferences(u.userId, d); }
  @Put('devices') @HttpCode(204) @perMinute(20) device(@CurrentUser() u: UserContext, @Body() d: RegisterDeviceDto) { return this.svc.registerDevice(u.userId, d.token, d.platform); }
  @Delete('devices/:token') @HttpCode(204) removeDevice(@CurrentUser() u: UserContext, @Param('token') token: string) { return this.svc.removeDevice(u.userId, token); }
}

@ApiTags('admin-notifications')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/notifications')
export class CampaignsAdminController {
  constructor(private readonly svc: NotificationsService) {}
  @Get() @RequirePermissions('notifications.send') list() { return this.svc.list(); }
  @Get(':id') @RequirePermissions('notifications.send') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() @RequirePermissions('notifications.send') @Audit('campaign.create', 'campaign') create(@CurrentAdmin() a: AdminContext, @Body() d: CreateCampaignDto) { return this.svc.create(a.adminId, d); }
  @Post(':id/send') @HttpCode(200) @RequirePermissions('notifications.send') @Audit('campaign.send', 'campaign') send(@Param('id') id: string) { return this.svc.sendNow(id); }
  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('notifications.send') @Audit('campaign.cancel', 'campaign') cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
