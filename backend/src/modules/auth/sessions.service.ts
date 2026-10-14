import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { ClientInfo } from '../../common/decorators/params';
import { DomainCode } from '../../common/constants/error-codes';
import { randomToken, sha256Hex } from '../../common/crypto/crypto.util';
import { unauthorized } from '../../common/errors';
import { addDays } from '../../common/time';
import { authConfig } from '../../config/auth.config';
import { ActorType, AdminStatus, AdminUser, AuthSession, RefreshToken, User, UserStatus } from '../../database/entities/index';
import { AuditService } from '../audit-logs/audit.service';

/** Sessions cannot be refreshed forever: after this many days the user must sign in again. */
export const SESSION_ABSOLUTE_DAYS = 180;

export type SessionOwner = { userId: string } | { adminUserId: string };
export interface IssuedSession { session: AuthSession; refreshToken: string }
export interface RotationResult extends IssuedSession { userId: string | null; adminUserId: string | null }

@Injectable()
export class SessionsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    @Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>,
    private readonly audit: AuditService,
  ) {}

  /** Creates a device session and its first refresh token. The raw token is returned once and only its hash is stored. */
  async create(owner: SessionOwner, client: ClientInfo & { deviceName?: string | null }, manager?: EntityManager): Promise<IssuedSession> {
    const run = async (em: EntityManager) => {
      const now = new Date();
      const session = await em.getRepository(AuthSession).save({
        userId: 'userId' in owner ? owner.userId : null,
        adminUserId: 'adminUserId' in owner ? owner.adminUserId : null,
        deviceName: client.deviceName?.slice(0, 120) ?? null,
        userAgent: client.userAgent,
        ipAddress: client.ip,
        lastSeenAt: now,
        expiresAt: addDays(now, SESSION_ABSOLUTE_DAYS),
        revokedAt: null,
        revokedReason: null,
      });
      return { session, refreshToken: await this.issueRefresh(em, session.id) };
    };
    return manager ? run(manager) : this.ds.transaction(run);
  }

  private async issueRefresh(em: EntityManager, sessionId: string): Promise<string> {
    const raw = randomToken(32);
    await em.getRepository(RefreshToken).insert({ sessionId, tokenHash: sha256Hex(raw), expiresAt: addDays(new Date(), this.cfg.refreshTokenTtlDays), usedAt: null });
    return raw;
  }

  /**
   * Exchanges a refresh token for a new one (rotation). Each token works exactly once.
   * Presenting an already-used token means it was copied (theft) or replayed, so the WHOLE session is revoked.
   * `kind` stops a viewer token being used on the admin endpoint and vice versa.
   */
  async rotate(rawToken: string, kind: 'viewer' | 'admin', client: ClientInfo): Promise<RotationResult> {
    const outcome = await this.ds.transaction(async (em): Promise<{ ok: RotationResult } | { reuse: AuthSession } | { invalid: true }> => {
      const token = await em.getRepository(RefreshToken).createQueryBuilder('rt').setLock('pessimistic_write').where('rt.token_hash = :h', { h: sha256Hex(rawToken) }).getOne();
      if (!token) return { invalid: true };
      const session = await em.getRepository(AuthSession).findOne({ where: { id: token.sessionId }, lock: { mode: 'pessimistic_write' } });
      if (!session) return { invalid: true };
      const now = new Date();

      if (token.usedAt) {
        // Replay. Revoke the session in THIS transaction (we return instead of throwing so it is committed).
        if (!session.revokedAt) await em.getRepository(AuthSession).update(session.id, { revokedAt: now, revokedReason: 'refresh_token_reuse' });
        return { reuse: session };
      }
      const kindOk = kind === 'viewer' ? session.userId !== null : session.adminUserId !== null;
      if (!kindOk || session.revokedAt || session.expiresAt <= now || token.expiresAt <= now) return { invalid: true };

      if (session.userId) {
        const user = await em.getRepository(User).findOne({ where: { id: session.userId } });
        if (!user || user.status !== UserStatus.Active) return { invalid: true };
      } else {
        const admin = await em.getRepository(AdminUser).findOne({ where: { id: session.adminUserId! } });
        if (!admin || admin.status !== AdminStatus.Active) return { invalid: true };
      }

      await em.getRepository(RefreshToken).update(token.id, { usedAt: now });
      await em.getRepository(AuthSession).update(session.id, { lastSeenAt: now, ipAddress: client.ip ?? session.ipAddress });
      const refreshToken = await this.issueRefresh(em, session.id);
      return { ok: { session, refreshToken, userId: session.userId, adminUserId: session.adminUserId } };
    });

    if ('ok' in outcome) return outcome.ok;
    if ('reuse' in outcome) {
      await this.audit.record({ actorType: ActorType.System, action: 'auth.refresh_token_reuse_detected', entityType: 'auth_session', entityId: outcome.reuse.id, metadata: { userId: outcome.reuse.userId, adminUserId: outcome.reuse.adminUserId }, ip: client.ip, requestId: client.requestId });
      throw unauthorized(DomainCode.RefreshTokenReused, 'This sign-in is no longer valid. Please sign in again.');
    }
    throw unauthorized(DomainCode.InvalidRefreshToken, 'Invalid or expired refresh token');
  }

  async revoke(sessionId: string, reason: string, owner?: SessionOwner): Promise<boolean> {
    const where: Record<string, unknown> = { id: sessionId, revokedAt: IsNull() };
    if (owner && 'userId' in owner) where.userId = owner.userId;
    if (owner && 'adminUserId' in owner) where.adminUserId = owner.adminUserId;
    const r = await this.sessions.update(where, { revokedAt: new Date(), revokedReason: reason });
    return (r.affected ?? 0) > 0;
  }

  async revokeAll(owner: SessionOwner, reason: string, exceptSessionId?: string, manager?: EntityManager): Promise<number> {
    const repo = (manager ?? this.ds.manager).getRepository(AuthSession);
    const qb = repo.createQueryBuilder().update().set({ revokedAt: new Date(), revokedReason: reason }).where('revoked_at IS NULL');
    if ('userId' in owner) qb.andWhere('user_id = :id', { id: owner.userId }); else qb.andWhere('admin_user_id = :id', { id: owner.adminUserId });
    if (exceptSessionId) qb.andWhere('id <> :except', { except: exceptSessionId });
    return (await qb.execute()).affected ?? 0;
  }

  listActive(owner: SessionOwner): Promise<AuthSession[]> {
    const where = 'userId' in owner ? { userId: owner.userId } : { adminUserId: owner.adminUserId };
    return this.sessions.find({ where: { ...where, revokedAt: IsNull() }, order: { lastSeenAt: 'DESC' } }).then((rows) => rows.filter((s) => s.expiresAt > new Date()));
  }
}
