import { Global, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuard, OptionalUserAuthGuard, UserAuthGuard } from '../../common/auth/guards';
import { authConfig } from '../../config/auth.config';
import { AdminUser, AuthSession, EmailToken, OtpChallenge, Permission, Profile, RefreshToken, Role, User, UserIdentity } from '../../database/entities/index';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordsService } from './passwords.service';
import { DevEmailSender, DevOutbox, DevSmsSender, DisabledEmailSender, DisabledSmsSender, EmailSender, HttpEmailSender, HttpSmsSender, SmsSender } from '../../util/thirdparty/sms-email/senders';
import { SessionsService } from './sessions.service';
import { SocialTokenVerifier } from '../../util/thirdparty/social-login/social.verifier';
import { TokensService } from './tokens.service';
import { UsersController } from '../users/users.controller';

const entities = [User, Profile, UserIdentity, AuthSession, RefreshToken, OtpChallenge, EmailToken, AdminUser, Role, Permission];

/** Everything needed to authenticate a request. Global so any module can use the guards. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature(entities)],
  controllers: [AuthController, UsersController],
  providers: [
    TokensService, SessionsService, PasswordsService, OtpService, AuthService, SocialTokenVerifier,
    UserAuthGuard, OptionalUserAuthGuard, AdminAuthGuard, DevOutbox,
    {
      provide: SmsSender,
      inject: [authConfig.KEY, DevOutbox],
      useFactory: (cfg: ConfigType<typeof authConfig>, outbox: DevOutbox): SmsSender =>
        cfg.sms.provider === 'dev' ? new DevSmsSender(outbox) : cfg.sms.provider === 'http' && cfg.sms.url ? new HttpSmsSender(cfg) : new DisabledSmsSender(),
    },
    {
      provide: EmailSender,
      inject: [authConfig.KEY, DevOutbox],
      useFactory: (cfg: ConfigType<typeof authConfig>, outbox: DevOutbox): EmailSender =>
        cfg.email.provider === 'dev' ? new DevEmailSender(outbox) : cfg.email.provider === 'http' && cfg.email.url ? new HttpEmailSender(cfg) : new DisabledEmailSender(),
    },
  ],
  exports: [TypeOrmModule, TokensService, SessionsService, PasswordsService, AuthService, UserAuthGuard, OptionalUserAuthGuard, AdminAuthGuard, DevOutbox, EmailSender, SmsSender],
})
export class AuthCoreModule {}
