import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClientInfo } from '../../common/decorators/params';
import { DomainCode } from '../../common/constants/error-codes';
import { decryptString, encryptString, randomToken, sha256Hex } from '../../common/crypto/crypto.util';
import { KeyService } from '../../common/crypto/key.service';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../common/crypto/totp';
import { badRequest, conflict, DomainException, unauthorized } from '../../common/errors';
import { addSeconds } from '../../common/time';
import { authConfig } from '../../config/auth.config';
import { ActorType, AdminStatus, AdminUser } from '../../database/entities/index';
import { AuditService } from '../audit-logs/audit.service';
import { PasswordsService } from '../auth/passwords.service';
import { SessionsService } from '../auth/sessions.service';
import { TokensService } from '../auth/tokens.service';

const MAX_FAILED = 5;
const LOCKOUT_SECONDS = 15 * 60;
const RECOVERY_CODE_COUNT = 8;

export interface AdminView { id: string; email: string; name: string; roles: string[]; permissions: string[] }
export interface AdminTokens { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number; admin: AdminView }

/**
 * Admin sign-in is two steps and a session is NEVER issued after the password alone:
 *   1. password -> a short-lived token that only unlocks the MFA endpoints
 *   2. TOTP code (or a recovery code) -> the real session
 * An admin with no MFA yet must enrol before getting any access.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(AdminUser) private readonly admins: Repository<AdminUser>,
    @Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>,
    private readonly passwords: PasswordsService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly keys: KeyService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, client: ClientInfo) {
    const admin = await this.admins.findOne({ where: { email } });
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) throw new DomainException(HttpStatus.LOCKED, DomainCode.AccountLocked, 'Too many failed attempts. Try again later.');
    const ok = await this.passwords.verify(admin?.passwordHash ?? null, password);
    if (!admin || !ok || admin.status !== AdminStatus.Active) {
      if (admin) await this.failed(admin.id);
      await this.audit.record({ actorType: ActorType.System, action: 'admin.login.failed', metadata: { email }, ip: client.ip, requestId: client.requestId });
      throw unauthorized(DomainCode.InvalidCredentials, 'Incorrect email or password');
    }
    if (!admin.mfaEnabledAt) return { status: DomainCode.MfaSetupRequired, setupToken: await this.tokens.signMfaToken(admin.id, 'setup') };
    return { status: DomainCode.MfaRequired, challengeToken: await this.tokens.signMfaToken(admin.id, 'verify') };
  }

  /** Generates a TOTP secret for the authenticator app. It stays "pending" until a valid code proves the app is set up. */
  async enroll(setupToken: string) {
    const admin = await this.admins.findOneByOrFail({ id: await this.tokens.verifyMfaToken(setupToken, 'setup') });
    if (admin.mfaEnabledAt) throw conflict('MFA_ALREADY_ENABLED', 'MFA is already set up for this account');
    const secret = generateTotpSecret();
    await this.admins.update(admin.id, { mfaPendingSecretEnc: encryptString(this.keys.mfaEncryption, secret) });
    return { secret, otpauthUri: otpauthUri(this.cfg.totpIssuer, admin.email, secret) };
  }

  async confirm(setupToken: string, code: string, client: ClientInfo): Promise<AdminTokens & { recoveryCodes: string[] }> {
    const admin = await this.admins.findOneByOrFail({ id: await this.tokens.verifyMfaToken(setupToken, 'setup') });
    if (admin.mfaEnabledAt || !admin.mfaPendingSecretEnc) throw conflict('MFA_NOT_PENDING', 'Start MFA setup first');
    const step = verifyTotp(decryptString(this.keys.mfaEncryption, admin.mfaPendingSecretEnc), code);
    if (step === null) { await this.failed(admin.id); throw badRequest(DomainCode.InvalidMfaCode, 'Incorrect code'); }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(8).toUpperCase().replace(/[-_]/g, 'X'));
    await this.admins.update(admin.id, { mfaSecretEnc: admin.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastUsedStep: String(step), mfaRecoveryHashes: recoveryCodes.map((c) => sha256Hex(c)) });
    await this.audit.record({ actorType: ActorType.Admin, actorId: admin.id, action: 'admin.mfa.enabled', ip: client.ip, requestId: client.requestId });
    return { ...(await this.startSession(admin.id, client)), recoveryCodes };
  }

  async verify(challengeToken: string, input: { code?: string; recoveryCode?: string }, client: ClientInfo): Promise<AdminTokens> {
    const adminId = await this.tokens.verifyMfaToken(challengeToken, 'verify');
    const admin = await this.admins.findOneByOrFail({ id: adminId });
    if (admin.lockedUntil && admin.lockedUntil > new Date()) throw new DomainException(HttpStatus.LOCKED, DomainCode.AccountLocked, 'Too many failed attempts. Try again later.');
    if (admin.status !== AdminStatus.Active || !admin.mfaEnabledAt || !admin.mfaSecretEnc) throw unauthorized(DomainCode.InvalidCredentials, 'Incorrect email or password');

    const good = input.recoveryCode ? await this.useRecoveryCode(admin.id, input.recoveryCode) : input.code ? await this.useTotp(admin, input.code) : false;
    if (!good) {
      await this.failed(admin.id);
      await this.audit.record({ actorType: ActorType.Admin, actorId: admin.id, action: 'admin.mfa.failed', ip: client.ip, requestId: client.requestId });
      throw badRequest(DomainCode.InvalidMfaCode, 'Incorrect code');
    }
    await this.audit.record({ actorType: ActorType.Admin, actorId: admin.id, action: input.recoveryCode ? 'admin.login.recovery_code' : 'admin.login', ip: client.ip, requestId: client.requestId });
    return this.startSession(admin.id, client);
  }

  async refresh(rawToken: string, client: ClientInfo): Promise<AdminTokens> {
    const r = await this.sessions.rotate(rawToken, 'admin', client);
    return this.tokensFor(r.adminUserId!, r.session.id, r.refreshToken);
  }
  async logout(adminId: string, sessionId: string) { await this.sessions.revoke(sessionId, 'logout', { adminUserId: adminId }); }
  async logoutAll(adminId: string) { await this.sessions.revokeAll({ adminUserId: adminId }, 'logout_all'); }

  async changePassword(adminId: string, sessionId: string, current: string, next: string) {
    const admin = await this.admins.findOneByOrFail({ id: adminId });
    if (!(await this.passwords.verify(admin.passwordHash, current))) throw unauthorized(DomainCode.InvalidCredentials, 'Current password is incorrect');
    this.passwords.assertStrong(next);
    await this.admins.update(adminId, { passwordHash: await this.passwords.hash(next) });
    await this.sessions.revokeAll({ adminUserId: adminId }, 'password_changed', sessionId); // other devices are signed out
    await this.audit.record({ actorType: ActorType.Admin, actorId: adminId, action: 'admin.password.changed' });
  }

  async view(adminId: string): Promise<AdminView> {
    const a = await this.admins.findOneOrFail({ where: { id: adminId }, relations: { roles: { permissions: true } } });
    return { id: a.id, email: a.email, name: a.name, roles: a.roles.map((r) => r.name), permissions: [...new Set(a.roles.flatMap((r) => r.permissions.map((p) => p.code)))].sort() };
  }

  /** A code is valid once: its time-step must be NEWER than the last accepted one (atomic), defeating replay of a sniffed code. */
  private async useTotp(admin: AdminUser, code: string): Promise<boolean> {
    const step = verifyTotp(decryptString(this.keys.mfaEncryption, admin.mfaSecretEnc!), code);
    if (step === null) return false;
    const r = await this.admins.createQueryBuilder().update().set({ mfaLastUsedStep: String(step) }).where('id = :id AND (mfa_last_used_step IS NULL OR mfa_last_used_step < :step)', { id: admin.id, step }).execute();
    return (r.affected ?? 0) > 0;
  }

  private async useRecoveryCode(adminId: string, code: string): Promise<boolean> {
    const hash = sha256Hex(code.trim().toUpperCase());
    return this.ds.transaction(async (em) => {
      const a = await em.getRepository(AdminUser).findOne({ where: { id: adminId }, lock: { mode: 'pessimistic_write' } });
      const hashes = a?.mfaRecoveryHashes ?? [];
      if (!a || !hashes.includes(hash)) return false;
      await em.getRepository(AdminUser).update(adminId, { mfaRecoveryHashes: hashes.filter((h) => h !== hash) });
      return true;
    });
  }

  private async failed(adminId: string): Promise<void> {
    await this.admins.createQueryBuilder().update().set({ failedLoginCount: () => 'failed_login_count + 1' }).where('id = :adminId', { adminId }).execute();
    const a = await this.admins.findOneByOrFail({ id: adminId });
    if (a.failedLoginCount >= MAX_FAILED) await this.admins.update(adminId, { failedLoginCount: 0, lockedUntil: addSeconds(new Date(), LOCKOUT_SECONDS) });
  }

  private async startSession(adminId: string, client: ClientInfo): Promise<AdminTokens> {
    await this.admins.update(adminId, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() });
    const { session, refreshToken } = await this.sessions.create({ adminUserId: adminId }, client);
    return this.tokensFor(adminId, session.id, refreshToken);
  }

  private async tokensFor(adminId: string, sessionId: string, refreshToken: string): Promise<AdminTokens> {
    return { accessToken: await this.tokens.signAdminAccess(adminId, sessionId), refreshToken, tokenType: 'Bearer', expiresIn: this.tokens.accessTtlSeconds, admin: await this.view(adminId) };
  }
}
