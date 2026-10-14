import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { perMinute } from '../../common/throttler/limits';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../common/auth/guards';
import { Client, ClientInfo, CurrentUser } from '../../common/decorators/params';
import { UserContext } from '../../common/auth/auth.types';
import { IdentityProvider } from '../../database/entities/index';
import { CompleteProfileDto, EmailDto, LoginDto, RefreshDto, RegisterDto, RequestOtpDto, ResetPasswordDto, SocialLoginDto, TokenDto, VerifyOtpDto } from './auth.dto';
import { AuthService } from './auth.service';


@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request') @HttpCode(202) @perMinute(10)
  @ApiOperation({ summary: 'Send a 6-digit code to a mobile number (sign in or sign up)' })
  requestOtp(@Body() dto: RequestOtpDto, @Client() c: ClientInfo) { return this.auth.requestOtp(dto.phone, c); }

  @Post('otp/verify') @HttpCode(200) @perMinute(20)
  @ApiOperation({ summary: 'Verify the code; returns tokens. Creates the account on first use.' })
  verifyOtp(@Body() dto: VerifyOtpDto, @Client() c: ClientInfo) { return this.auth.verifyOtp(dto.phone, dto.code, c, dto.deviceName, dto); }

  @Post('otp/complete') @HttpCode(200) @perMinute(10)
  @ApiOperation({ summary: 'Finish sign-up for a new number: name, email and date of birth (minimum age enforced). Needs the profileToken from otp/verify.' })
  completeProfile(@Body() dto: CompleteProfileDto, @Client() c: ClientInfo) { return this.auth.completeProfile(dto.profileToken, dto, c, dto.deviceName); }

  @Post('register') @HttpCode(202) @perMinute(10)
  @ApiOperation({ summary: 'Register with email and password. A verification email is sent; sign-in requires a verified email.' })
  register(@Body() dto: RegisterDto, @Client() c: ClientInfo) { return this.auth.register(dto, c); }

  @Post('email/verify') @HttpCode(204) @perMinute(20)
  verifyEmail(@Body() dto: TokenDto) { return this.auth.verifyEmail(dto.token); }

  @Post('email/resend') @HttpCode(202) @perMinute(5)
  resend(@Body() dto: EmailDto) { return this.auth.resendVerification(dto.email); }

  @Post('login') @HttpCode(200) @perMinute(10)
  @ApiOperation({ summary: 'Sign in with email and password' })
  login(@Body() dto: LoginDto, @Client() c: ClientInfo) { return this.auth.loginEmail(dto.email, dto.password, c, dto.deviceName); }

  @Post('google') @HttpCode(200) @perMinute(20)
  @ApiOperation({ summary: 'Sign in with a Google ID token (enabled only when GOOGLE_CLIENT_IDS is set)' })
  google(@Body() dto: SocialLoginDto, @Client() c: ClientInfo) { return this.auth.socialLogin(IdentityProvider.Google, dto, c); }

  @Post('apple') @HttpCode(200) @perMinute(20)
  @ApiOperation({ summary: 'Sign in with an Apple ID token (enabled only when APPLE_CLIENT_IDS is set)' })
  apple(@Body() dto: SocialLoginDto, @Client() c: ClientInfo) { return this.auth.socialLogin(IdentityProvider.Apple, dto, c); }

  @Post('refresh') @HttpCode(200) @perMinute(60)
  @ApiOperation({ summary: 'Exchange a refresh token for new tokens. Each refresh token works once.' })
  refresh(@Body() dto: RefreshDto, @Client() c: ClientInfo) { return this.auth.refresh(dto.refreshToken, c); }

  @Post('password/forgot') @HttpCode(202) @perMinute(5)
  forgot(@Body() dto: EmailDto) { return this.auth.forgotPassword(dto.email); }

  @Post('password/reset') @HttpCode(204) @perMinute(10)
  reset(@Body() dto: ResetPasswordDto, @Client() c: ClientInfo) { return this.auth.resetPassword(dto.token, dto.newPassword, c); }

  @Post('logout') @HttpCode(204) @UseGuards(UserAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out this device' })
  logout(@CurrentUser() u: UserContext) { return this.auth.logout(u.userId, u.sessionId); }

  @Post('logout-all') @HttpCode(204) @UseGuards(UserAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out every device' })
  logoutAll(@CurrentUser() u: UserContext) { return this.auth.logoutAll(u.userId); }
}
