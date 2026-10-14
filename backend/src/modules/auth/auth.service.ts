import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, MoreThan, Repository } from 'typeorm';
import { ClientInfo } from '../../common/decorators/params';
import { DomainCode } from '../../common/constants/error-codes';
import { randomToken, sha256Hex } from '../../common/crypto/crypto.util';
import { assertMinAge } from '../../common/age';
import { badRequest, conflict, DomainException, forbidden, unauthorized, unavailable } from '../../common/errors';
import { addSeconds } from '../../common/time';
import { authConfig } from '../../config/auth.config';
import { ActorType, EmailToken, EmailTokenPurpose, IdentityProvider, Profile, User, UserIdentity, UserStatus } from '../../database/entities/index';
import { AuditService } from '../audit-logs/audit.service';
import { normalizePhone, OtpService } from './otp.service';
import { PasswordsService } from './passwords.service';
import { EmailSender } from '../../util/thirdparty/sms-email/senders';
import { SessionsService } from './sessions.service';
import { SocialTokenVerifier } from '../../util/thirdparty/social-login/social.verifier';
import { TokensService } from './tokens.service';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_SECONDS = 15 * 60;
const VERIFY_TTL = 24 * 3600;
const RESET_TTL = 3600;

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserView;
}
/** Returned instead of tokens when a verified phone number has no account yet and the request carried no profile details. */
export interface ProfileRequired { status: 'PROFILE_REQUIRED'; profileToken: string }
export interface NewProfile { displayName: string; email: string; dateOfBirth: string }
export interface UserView { id: string; displayName: string; phone: string | null; email: string | null; emailVerified: boolean; language: string; hasPassword: boolean }

const GENERIC_ACCEPTED = { message: 'If the details are valid, we have sent the next steps.' };

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(EmailToken) private readonly emailTokens: Repository<EmailToken>,
    @Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>,
    private readonly passwords: PasswordsService,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
    private readonly email: EmailSender,
    private readonly social: SocialTokenVerifier,
    private readonly audit: AuditService,
  ) {}

  // ── phone + OTP ──
  async requestOtp(phoneRaw: string, client: ClientInfo) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw badRequest('INVALID_PHONE', 'Enter a valid mobile number');
    if (!this.otp.enabled) throw unavailable('SMS_NOT_CONFIGURED', 'Phone sign-in is not available right now');
    return this.otp.request(phone, client.ip);
  }

  /** Name, email and a date of birth that passes the age rule. Throws before anything is consumed or created. */
  private validateNewProfile(p: { displayName?: string; email?: string; dateOfBirth?: string }): NewProfile {
    const displayName = p.displayName?.trim() ?? '';
    if (displayName.length < 2) throw badRequest('NAME_REQUIRED', 'Enter your full name.');
    if (!p.email) throw badRequest('EMAIL_REQUIRED', 'Enter your email address.');
    return { displayName, email: p.email, dateOfBirth: assertMinAge(p.dateOfBirth ?? '') };
  }

  async verifyOtp(phoneRaw: string, code: string, client: ClientInfo, deviceName?: string, profile?: { displayName?: string; email?: string; dateOfBirth?: string }): Promise<AuthResponse | ProfileRequired> {
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw badRequest(DomainCode.InvalidOtp, 'Invalid or expired code');
    // If profile details came with the code, check them first so a bad date of birth does not burn the OTP.
    const supplied = !!(profile?.displayName || profile?.email || profile?.dateOfBirth);
    const np = supplied ? this.validateNewProfile(profile!) : undefined;
    await this.otp.verify(phone, code); // proves control of the number
    let user = await this.users.findOne({ where: { phone } });
    if (user && user.status !== UserStatus.Active) throw this.inactive(user);
    if (!user) {
      if (!np) return { status: 'PROFILE_REQUIRED', profileToken: await this.tokens.signSignupToken(phone) };
      user = await this.createPhoneUser(phone, np);
    } else if (!user.phoneVerifiedAt) await this.users.update(user.id, { phoneVerifiedAt: new Date() });
    await this.audit.record({ actorType: ActorType.User, actorId: user.id, action: 'auth.login.otp', ip: client.ip, requestId: client.requestId });
    return this.issue(user, client, deviceName);
  }

  /** Finishes sign-up for a phone number that already proved ownership (see ProfileRequired). */
  async completeProfile(profileToken: string, profile: { displayName: string; email: string; dateOfBirth: string }, client: ClientInfo, deviceName?: string): Promise<AuthResponse> {
    const phone = await this.tokens.verifySignupToken(profileToken).catch(() => { throw unauthorized(DomainCode.InvalidToken, 'Your sign-up session expired. Please request a new code.'); });
    const np = this.validateNewProfile(profile);
    let user = await this.users.findOne({ where: { phone } });
    if (user && user.status !== UserStatus.Active) throw this.inactive(user);
    if (!user) user = await this.createPhoneUser(phone, np);
    await this.audit.record({ actorType: ActorType.User, actorId: user.id, action: 'auth.signup.otp', ip: client.ip, requestId: client.requestId });
    return this.issue(user, client, deviceName);
  }

  private async createPhoneUser(phone: string, np: NewProfile): Promise<User> {
    if (await this.users.exists({ where: { email: np.email } })) throw conflict('EMAIL_IN_USE', 'That email is already linked to another account. Sign in with it instead.');
    let user: User;
    try { user = await this.createUser({ phone, phoneVerifiedAt: new Date(), email: np.email }, np.displayName, np.dateOfBirth); }
    catch (err) { if (this.isDuplicate(err)) throw conflict('EMAIL_IN_USE', 'That email is already linked to another account. Sign in with it instead.'); throw err; }
    if (this.email.enabled) await this.sendVerification(user).catch(() => undefined); // best effort: the phone is already verified
    return user;
  }

  // ── email + password ──
  async register(input: { email: string; password: string; displayName: string; dateOfBirth: string }, client: ClientInfo) {
    if (!this.email.enabled) throw unavailable('EMAIL_NOT_CONFIGURED', 'Email sign-up is not available right now');
    const np = this.validateNewProfile(input); // age rule first: nothing is hashed or stored for someone under the limit
    this.passwords.assertStrong(input.password);
    const passwordHash = await this.passwords.hash(input.password); // hashed even if the email exists, so timing does not reveal it
    try {
      const user = await this.createUser({ email: input.email, passwordHash }, np.displayName, np.dateOfBirth);
      await this.sendVerification(user);
      await this.audit.record({ actorType: ActorType.User, actorId: user.id, action: 'auth.register.email', ip: client.ip, requestId: client.requestId });
    } catch (err) {
      if (!this.isDuplicate(err)) throw err; // existing email: respond identically (no account enumeration)
    }
    return GENERIC_ACCEPTED;
  }

  async verifyEmail(rawToken: string): Promise<void> {
    await this.ds.transaction(async (em) => {
      const consumed = await this.consumeToken(em, rawToken, EmailTokenPurpose.VerifyEmail);
      await em.getRepository(User).update(consumed.userId, { emailVerifiedAt: new Date() });
    });
  }

  async resendVerification(email: string) {
    if (!this.email.enabled) throw unavailable('EMAIL_NOT_CONFIGURED', 'Email is not available right now');
    const user = await this.users.findOne({ where: { email } });
    if (user && !user.emailVerifiedAt && user.status === UserStatus.Active) await this.sendVerification(user);
    return GENERIC_ACCEPTED;
  }

  async loginEmail(email: string, password: string, client: ClientInfo, deviceName?: string): Promise<AuthResponse> {
    const user = await this.users.findOne({ where: { email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) throw new DomainException(HttpStatus.LOCKED, DomainCode.AccountLocked, 'Too many failed attempts. Try again later.');

    const ok = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || !ok) {
      if (user) await this.recordFailedLogin(user.id);
      await this.audit.record({ actorType: ActorType.System, action: 'auth.login.failed', metadata: { channel: 'email' }, ip: client.ip, requestId: client.requestId });
      throw unauthorized(DomainCode.InvalidCredentials, 'Incorrect email or password');
    }
    if (user.status !== UserStatus.Active) throw this.inactive(user);
    if (!user.emailVerifiedAt) throw forbidden(DomainCode.EmailNotVerified, 'Please verify your email before signing in');
    await this.users.update(user.id, { failedLoginCount: 0, lockedUntil: null });
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) await this.users.update(user.id, { passwordHash: await this.passwords.hash(password) });
    await this.audit.record({ actorType: ActorType.User, actorId: user.id, action: 'auth.login.email', ip: client.ip, requestId: client.requestId });
    return this.issue(user, client, deviceName);
  }

  // ── Google / Apple ──
  async socialLogin(provider: IdentityProvider, input: { idToken: string; nonce?: string; displayName?: string; dateOfBirth?: string; deviceName?: string }, client: ClientInfo): Promise<AuthResponse> {
    const id = await this.social.verify(provider, input.idToken, input.nonce); // throws if not configured / invalid
    let user: User | null = null;

    const identity = await this.identities.findOne({ where: { provider, subject: id.subject }, relations: { user: true } });
    if (identity) user = identity.user;
    else {
      // Link by email ONLY when the provider vouches for it AND our own record of that email is verified too.
      const byEmail = id.email && id.emailVerified ? await this.users.findOne({ where: { email: id.email } }) : null;
      if (byEmail?.emailVerifiedAt) user = byEmail;
      else {
        // An UNverified local account with that email must never be taken over, so the new account is created without the email.
        const dob = assertMinAge(input.dateOfBirth ?? ''); // a NEW account needs a date of birth that passes the age rule
        const emailForNew = id.email && id.emailVerified && !byEmail ? id.email : null;
        user = await this.createUser({ email: emailForNew, emailVerifiedAt: emailForNew ? new Date() : null }, input.displayName ?? id.name ?? id.email?.split('@')[0] ?? 'Viewer', dob);
      }
      try { await this.identities.insert({ userId: user.id, provider, subject: id.subject, email: id.email }); } catch (err) { if (!this.isDuplicate(err)) throw err; }
    }
    if (user.status !== UserStatus.Active) throw this.inactive(user);
    await this.audit.record({ actorType: ActorType.User, actorId: user.id, action: `auth.login.${provider}`, ip: client.ip, requestId: client.requestId });
    return this.issue(user, client, input.deviceName);
  }

  // ── tokens ──
  async refresh(rawRefreshToken: string, client: ClientInfo): Promise<AuthResponse> {
    const r = await this.sessions.rotate(rawRefreshToken, 'viewer', client);
    const user = await this.users.findOneOrFail({ where: { id: r.userId! } });
    return this.response(user, r.session.id, r.refreshToken);
  }

  async logout(userId: string, sessionId: string) { await this.sessions.revoke(sessionId, 'logout', { userId }); }
  async logoutAll(userId: string) { await this.sessions.revokeAll({ userId }, 'logout_all'); }

  // ── password recovery ──
  async forgotPassword(email: string) {
    if (!this.email.enabled) throw unavailable('EMAIL_NOT_CONFIGURED', 'Password reset is not available right now');
    const user = await this.users.findOne({ where: { email } });
    if (user && user.passwordHash && user.emailVerifiedAt && user.status === UserStatus.Active) {
      const raw = await this.createEmailToken(user.id, EmailTokenPurpose.ResetPassword, RESET_TTL);
      await this.email.send(user.email!, 'Reset your AIVISTRO password', `Use this link within 1 hour: ${this.cfg.webAppUrl}/reset-password?token=${raw}\nIf you did not ask for this, ignore this email.`);
    }
    return GENERIC_ACCEPTED;
  }

  async resetPassword(rawToken: string, newPassword: string, client: ClientInfo): Promise<void> {
    this.passwords.assertStrong(newPassword);
    const passwordHash = await this.passwords.hash(newPassword);
    const userId = await this.ds.transaction(async (em) => {
      const consumed = await this.consumeToken(em, rawToken, EmailTokenPurpose.ResetPassword);
      await em.getRepository(User).update(consumed.userId, { passwordHash, failedLoginCount: 0, lockedUntil: null });
      await this.sessions.revokeAll({ userId: consumed.userId }, 'password_reset', undefined, em); // a stolen session must not survive a reset
      return consumed.userId;
    });
    await this.audit.record({ actorType: ActorType.User, actorId: userId, action: 'auth.password.reset', ip: client.ip, requestId: client.requestId });
  }

  // ── helpers ──
  async toView(user: User): Promise<UserView> {
    const profile = await this.profiles.findOne({ where: { userId: user.id } });
    return { id: user.id, displayName: profile?.displayName ?? 'Viewer', phone: user.phone, email: user.email, emailVerified: !!user.emailVerifiedAt, language: profile?.language ?? 'hi', hasPassword: !!user.passwordHash };
  }

  private async issue(user: User, client: ClientInfo, deviceName?: string): Promise<AuthResponse> {
    await this.users.update(user.id, { lastLoginAt: new Date() });
    const { session, refreshToken } = await this.sessions.create({ userId: user.id }, { ...client, deviceName });
    return this.response(user, session.id, refreshToken);
  }

  private async response(user: User, sessionId: string, refreshToken: string): Promise<AuthResponse> {
    return { accessToken: await this.tokens.signViewerAccess(user.id, sessionId), refreshToken, tokenType: 'Bearer', expiresIn: this.tokens.accessTtlSeconds, user: await this.toView(user) };
  }

  private async createUser(fields: Partial<User>, displayName: string, dateOfBirth: string | null = null): Promise<User> {
    return this.ds.transaction(async (em: EntityManager) => {
      const user = await em.getRepository(User).save({ phone: null, email: null, passwordHash: null, phoneVerifiedAt: null, emailVerifiedAt: null, status: UserStatus.Active, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, ...fields });
      await em.getRepository(Profile).insert({ userId: user.id, displayName: displayName.slice(0, 100), dateOfBirth, avatarUrl: null, language: 'hi', notificationPreferences: { marketing: true, newEpisodes: true, billing: true } });
      return user;
    }).catch(async (err) => {
      if (this.isDuplicate(err) && fields.phone) { const existing = await this.users.findOne({ where: { phone: fields.phone } }); if (existing) return existing; }
      throw err;
    });
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    await this.users.createQueryBuilder().update().set({ failedLoginCount: () => 'failed_login_count + 1' }).where('id = :userId', { userId }).execute();
    const u = await this.users.findOneByOrFail({ id: userId });
    if (u.failedLoginCount >= MAX_FAILED_LOGINS) await this.users.update(userId, { failedLoginCount: 0, lockedUntil: addSeconds(new Date(), LOCKOUT_SECONDS) });
  }

  private async sendVerification(user: User): Promise<void> {
    const raw = await this.createEmailToken(user.id, EmailTokenPurpose.VerifyEmail, VERIFY_TTL);
    await this.email.send(user.email!, 'Verify your AIVISTRO email', `Confirm your email: ${this.cfg.webAppUrl}/verify-email?token=${raw}`);
  }

  private async createEmailToken(userId: string, purpose: EmailTokenPurpose, ttlSeconds: number): Promise<string> {
    const raw = randomToken(32);
    await this.emailTokens.insert({ userId, purpose, tokenHash: sha256Hex(raw), expiresAt: addSeconds(new Date(), ttlSeconds), usedAt: null });
    return raw;
  }

  /** Single-use: the conditional UPDATE only succeeds for the first caller. */
  private async consumeToken(em: EntityManager, raw: string, purpose: EmailTokenPurpose): Promise<EmailToken> {
    const repo = em.getRepository(EmailToken);
    const row = await repo.findOne({ where: { tokenHash: sha256Hex(raw), purpose, usedAt: IsNull(), expiresAt: MoreThan(new Date()) } });
    if (!row) throw badRequest(DomainCode.InvalidToken, 'This link is invalid or has expired');
    const done = await repo.createQueryBuilder().update().set({ usedAt: new Date() }).where('id = :id AND used_at IS NULL', { id: row.id }).execute();
    if (!done.affected) throw badRequest(DomainCode.InvalidToken, 'This link is invalid or has expired');
    return row;
  }

  private inactive(user: User): DomainException {
    return user.status === UserStatus.Suspended ? forbidden(DomainCode.AccountSuspended, 'This account has been suspended') : unauthorized(DomainCode.InvalidCredentials, 'Incorrect email or password');
  }

  private isDuplicate(err: unknown): boolean { return (err as { driverError?: { code?: string } })?.driverError?.code === 'ER_DUP_ENTRY'; }
}
