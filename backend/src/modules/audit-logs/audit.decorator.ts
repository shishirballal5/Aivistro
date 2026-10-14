import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, mergeMap } from 'rxjs';
import { AuthedRequest, requestIdOf } from '../../common/auth/auth.types';
import { ActorType } from '../../database/entities/index';
import { AuditService } from './audit.service';

export interface AuditMeta { action: string; entityType?: string }
const KEY = 'audit';
/** Marks an admin route whose successful execution is written to the audit log. */
export const Audit = (action: string, entityType?: string) => SetMetadata(KEY, { action, entityType } satisfies AuditMeta);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(KEY, context.getHandler());
    if (!meta) return next.handle();
    const req = context.switchToHttp().getRequest<AuthedRequest & { params: Record<string, string>; body: unknown }>();
    // The audit row is written BEFORE the response is returned, so a successful admin action can never be observed without its record.
    // (AuditService.record never throws, so an audit failure cannot turn a successful action into an error.)
    return next.handle().pipe(
      mergeMap(async (result) => {
        const id = (result as { id?: string | number } | undefined)?.id ?? req.params?.id ?? null;
        await this.audit.record({
          actorType: ActorType.Admin,
          actorId: req.admin?.adminId ?? null,
          action: meta.action,
          entityType: meta.entityType ?? null,
          entityId: id,
          metadata: { params: req.params, body: req.body } as Record<string, unknown>,
          ip: req.ip ?? null,
          requestId: requestIdOf(req),
        });
        return result;
      }),
    );
  }
}
