import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { perMinute } from '../../common/throttler/limits';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminContext } from '../../common/auth/auth.types';
import { AdminAuthGuard } from '../../common/auth/guards';
import { Client, ClientInfo, CurrentAdmin } from '../../common/decorators/params';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto, AdminRefreshDto, ChangePasswordDto, MfaConfirmDto, MfaSetupDto, MfaVerifyDto } from './admin-auth.dto';


@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login') @HttpCode(200) @perMinute(10)
  @ApiOperation({ summary: 'Step 1: password. Returns an MFA challenge or setup token, never a session.' })
  login(@Body() dto: AdminLoginDto, @Client() c: ClientInfo) { return this.auth.login(dto.email, dto.password, c); }

  @Post('mfa/enroll') @HttpCode(200) @perMinute(10)
  @ApiOperation({ summary: 'Start MFA setup: returns the TOTP secret and otpauth:// URI for an authenticator app' })
  enroll(@Body() dto: MfaSetupDto) { return this.auth.enroll(dto.setupToken); }

  @Post('mfa/confirm') @HttpCode(200) @perMinute(10)
  @ApiOperation({ summary: 'Finish MFA setup with the first code. Returns the session and one-time recovery codes.' })
  confirm(@Body() dto: MfaConfirmDto, @Client() c: ClientInfo) { return this.auth.confirm(dto.setupToken, dto.code, c); }

  @Post('mfa/verify') @HttpCode(200) @perMinute(10)
  @ApiOperation({ summary: 'Step 2: TOTP code or recovery code. Returns the session.' })
  verify(@Body() dto: MfaVerifyDto, @Client() c: ClientInfo) { return this.auth.verify(dto.challengeToken, dto, c); }

  @Post('refresh') @HttpCode(200) @perMinute(60)
  refresh(@Body() dto: AdminRefreshDto, @Client() c: ClientInfo) { return this.auth.refresh(dto.refreshToken, c); }

  @Get('me') @UseGuards(AdminAuthGuard) @ApiBearerAuth()
  me(@CurrentAdmin() a: AdminContext) { return this.auth.view(a.adminId); }

  @Post('logout') @HttpCode(204) @UseGuards(AdminAuthGuard) @ApiBearerAuth()
  logout(@CurrentAdmin() a: AdminContext) { return this.auth.logout(a.adminId, a.sessionId); }

  @Post('logout-all') @HttpCode(204) @UseGuards(AdminAuthGuard) @ApiBearerAuth()
  logoutAll(@CurrentAdmin() a: AdminContext) { return this.auth.logoutAll(a.adminId); }

  @Post('password/change') @HttpCode(204) @UseGuards(AdminAuthGuard) @ApiBearerAuth() @perMinute(5)
  change(@CurrentAdmin() a: AdminContext, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(a.adminId, a.sessionId, dto.currentPassword, dto.newPassword); }
}
