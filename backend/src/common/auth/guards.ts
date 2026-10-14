import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminStatus, AdminUser, AuthSession, User, UserStatus } from '../../database/entities/index';
import { TokensService } from '../../modules/auth/tokens.service';
import { DomainCode } from '../constants/error-codes';
import { forbidden, unauthorized } from '../errors';
import { AuthedRequest } from './auth.types';

const bearer = (req: AuthedRequest): string | null => {
  const h = req.headers.authorization;
  return h && /^Bearer\s+\S+$/i.test(h) ? h.split(/\s+/)[1] : null;
};

/**
 * Authenticates a viewer. Beyond the JWT signature it checks, on EVERY request, that the session is not revoked and the
 * account is still ACTIVE - so suspending an account or logging a device out takes effect immediately, not at token expiry.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokensService, @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    if (!token) throw unauthorized(DomainCode.InvalidToken, 'Authentication required');
    await this.authenticate(req, token);
    return true;
  }

  protected async authenticate(req: AuthedRequest, token: string): Promise<void> {
    const claims = await this.tokens.verifyViewerAccess(token);
    const session = await this.sessions.findOne({ where: { id: claims.sid }, relations: { user: true } });
    const now = new Date();
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= now || !session.user) throw unauthorized(DomainCode.InvalidToken, 'Session is no longer valid');
    if (session.user.status !== UserStatus.Active) throw forbidden(DomainCode.AccountSuspended, 'This account is not active');
    req.user = { userId: session.userId, sessionId: session.id };
  }
}

/** Like UserAuthGuard but anonymous requests are allowed. A token that is PRESENT but invalid is still rejected. */
@Injectable()
export class OptionalUserAuthGuard extends UserAuthGuard {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    if (token) await this.authenticate(req, token);
    return true;
  }
}

const PERMISSIONS_KEY = 'permissions';
const ANY_PERMISSIONS_KEY = 'permissions_any';
/** Requires AT LEAST ONE of the listed permissions (use alongside, not instead of, RequirePermissions for extra ALL-of rules). */
export const RequireAnyPermission = (...codes: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, codes);
/** Requires ALL listed permissions. Enforced by AdminAuthGuard on the server for every admin route. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

/** Authenticates an admin: MFA-backed token, live session, ACTIVE account, then checks the route's permissions from the database. */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly reflector: Reflector,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    @InjectRepository(AdminUser) private readonly admins: Repository<AdminUser>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    if (!token) throw unauthorized(DomainCode.InvalidToken, 'Authentication required');
    const claims = await this.tokens.verifyAdminAccess(token);
    if (!claims.amr?.includes('otp')) throw unauthorized(DomainCode.MfaRequired, 'Multi-factor authentication is required');
    const session = await this.sessions.findOne({ where: { id: claims.sid } });
    if (!session || session.adminUserId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) throw unauthorized(DomainCode.InvalidToken, 'Session is no longer valid');
    const admin = await this.admins.findOne({ where: { id: claims.sub }, relations: { roles: { permissions: true } } });
    if (!admin || admin.status !== AdminStatus.Active || !admin.mfaEnabledAt) throw forbidden(DomainCode.AccountSuspended, 'This admin account is not active');

    const permissions = new Set(admin.roles.flatMap((r) => r.permissions.map((p) => p.code)));
    const required = this.reflector.get<string[] | undefined>(PERMISSIONS_KEY, ctx.getHandler()) ?? this.reflector.get<string[] | undefined>(PERMISSIONS_KEY, ctx.getClass()) ?? [];
    const missing = required.filter((c) => !permissions.has(c));
    const any = this.reflector.get<string[] | undefined>(ANY_PERMISSIONS_KEY, ctx.getHandler()) ?? [];
    if (missing.length || (any.length && !any.some((c) => permissions.has(c)))) throw forbidden('FORBIDDEN', 'You do not have permission to do this');
    req.admin = { adminId: admin.id, sessionId: session.id, email: admin.email, permissions, roles: admin.roles.map((r) => r.name) };
    return true;
  }
}
