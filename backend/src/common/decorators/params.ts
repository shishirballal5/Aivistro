import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminContext, AuthedRequest, requestIdOf, UserContext } from '../auth/auth.types';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserContext => ctx.switchToHttp().getRequest<AuthedRequest>().user!);
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => ctx.switchToHttp().getRequest<AuthedRequest>().admin!);
/** Optional viewer (use with OptionalUserAuthGuard). */
export const MaybeUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserContext | undefined => ctx.switchToHttp().getRequest<AuthedRequest>().user);

export interface ClientInfo { ip: string | null; userAgent: string | null; requestId: string | null }
export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null, requestId: requestIdOf(req) };
});
