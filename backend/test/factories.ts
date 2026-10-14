import { NestExpressApplication } from '@nestjs/platform-express';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, JWK, JWTVerifyGetKey, KeyLike } from 'jose';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { KeyService } from '../src/common/crypto/key.service';
import { encryptString } from '../src/common/crypto/crypto.util';
import { randomBytes } from 'node:crypto';
import { generateTotpSecret, totpAt } from '../src/common/crypto/totp';
import { AdminStatus, AdminUser, Role, VideoAsset, VideoStatus } from '../src/database/entities/index';
import { PasswordsService } from '../src/modules/auth/passwords.service';
import { DevPaymentGateway } from '../src/modules/payments/gateway/dev.gateway';
import { PaymentGateway } from '../src/modules/payments/gateway/payment-gateway';
import { DevOutbox } from '../src/util/thirdparty/sms-email/senders';

export const dsOf = (app: NestExpressApplication) => app.get(DataSource);
export const http = (app: NestExpressApplication) => request(app.getHttpServer());
const rand = () => Math.random().toString(36).slice(2, 10);

/** Empties every table except reference data (roles, permissions, settings, migrations), so each spec starts clean. */
export async function resetData(app: NestExpressApplication): Promise<void> {
  const ds = dsOf(app);
  const keep = new Set(['typeorm_migrations', 'permissions', 'roles', 'role_permissions', 'system_settings', 'subscription_plans']);
  const rows: { name: string }[] = await ds.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = "BASE TABLE"');
  await ds.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const r of rows) if (!keep.has(r.name)) await ds.query(`TRUNCATE TABLE \`${r.name}\``);
  await ds.query('SET FOREIGN_KEY_CHECKS = 1');
  // Plans are reference data that tests edit: restore the three launch plans exactly as seeded.
  await ds.query("DELETE FROM subscription_plans WHERE code NOT IN ('monthly', 'quarterly', 'annual')");
  await ds.query("UPDATE subscription_plans SET active = 1, price_paise = CASE code WHEN 'monthly' THEN 14900 WHEN 'quarterly' THEN 39900 ELSE 119900 END, duration_months = CASE code WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 ELSE 12 END");
  // Custom roles created by tests are not reference data. Only the four seeded system roles survive.
  await ds.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_system = 0)');
  await ds.query('DELETE FROM roles WHERE is_system = 0');
}

export const uniquePhone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
export const uniqueEmail = () => `user-${rand()}@example.com`;
export const GOOD_PASSWORD = 'correct-horse-battery-9';

// ── viewers ──
export const lastSms = (app: NestExpressApplication, phone: string) => app.get(DevOutbox).last(phone.startsWith('+') ? phone : `+91${phone}`);
export const otpFrom = (app: NestExpressApplication, phone: string): string => /^(\d{6})/.exec(lastSms(app, phone)?.body ?? '')![1];

/** Clears the resend cooldown so a test can request a second code immediately. */
export async function skipCooldown(app: NestExpressApplication) { await dsOf(app).query('UPDATE otp_challenges SET created_at = created_at - INTERVAL 2 MINUTE'); }

/** A date of birth that passes the age rule, for tests that are not about the age rule. */
export const ADULT_DOB = '1990-01-01';

export async function viewerViaOtp(app: NestExpressApplication, phone = uniquePhone()) {
  await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
  const res = await http(app).post('/api/v1/auth/otp/verify').send({ phone, code: otpFrom(app, phone), deviceName: 'test phone', displayName: 'Test Viewer', email: `viewer${phone.replace(/\D/g, '')}@example.com`, dateOfBirth: ADULT_DOB }).expect(200);
  return { phone, ...(res.body as { accessToken: string; refreshToken: string; user: { id: string } }) };
}
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function registerVerifiedViewer(app: NestExpressApplication, email = uniqueEmail(), password = GOOD_PASSWORD) {
  await http(app).post('/api/v1/auth/register').send({ email, password, displayName: 'Test Viewer', dateOfBirth: ADULT_DOB }).expect(202);
  const token = /token=([\w-]+)/.exec(app.get(DevOutbox).last(email)!.body)![1];
  await http(app).post('/api/v1/auth/email/verify').send({ token }).expect(204);
  return { email, password };
}

// ── admins ──
export interface TestAdmin { id: string; email: string; password: string; secret: string | null }

export async function createAdmin(app: NestExpressApplication, opts: { roles?: string[]; mfa?: boolean; email?: string; status?: AdminStatus } = {}): Promise<TestAdmin> {
  const ds = dsOf(app);
  const email = opts.email ?? `admin-${rand()}@aivistro.test`;
  const password = GOOD_PASSWORD;
  const secret = opts.mfa === false ? null : generateTotpSecret();
  const keys = app.get(KeyService);
  const roles = await ds.getRepository(Role).find({ where: (opts.roles ?? ['SUPER_ADMIN']).map((name) => ({ name })) });
  const saved = await ds.getRepository(AdminUser).save({
    email, name: 'Test Admin', passwordHash: await app.get(PasswordsService).hash(password), status: opts.status ?? AdminStatus.Active, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null,
    mfaSecretEnc: secret ? encryptString(keys.mfaEncryption, secret) : null, mfaPendingSecretEnc: null, mfaEnabledAt: secret ? new Date() : null, mfaLastUsedStep: null, mfaRecoveryHashes: null, roles,
  });
  return { id: saved.id, email, password, secret };
}

/** Real two-step admin sign-in over HTTP. Resets the replay marker first so back-to-back test logins are not rejected. */
export async function adminLogin(app: NestExpressApplication, a: TestAdmin): Promise<{ accessToken: string; refreshToken: string }> {
  await dsOf(app).getRepository(AdminUser).update(a.id, { mfaLastUsedStep: null });
  const step1 = await http(app).post('/api/v1/admin/auth/login').send({ email: a.email, password: a.password }).expect(200);
  const step2 = await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: step1.body.challengeToken, code: totpAt(a.secret!, Date.now()) }).expect(200);
  return step2.body;
}
export const adminToken = async (app: NestExpressApplication, roles: string[] = ['SUPER_ADMIN']) => (await adminLogin(app, await createAdmin(app, { roles }))).accessToken;

// ── Google / Apple ID tokens signed with a local key ──
export async function makeIdTokenIssuer() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string; key?: KeyLike } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(o.iss ?? 'https://accounts.google.com').setAudience(o.aud ?? 'test-google-client').setIssuedAt().setExpirationTime(o.exp ?? '10m').sign(o.key ?? privateKey);
  return { jwks, sign, wrongKey: other.privateKey };
}

/** Inserts a READY video asset row (metadata only, no files) and makes it the episode's current video. For access/entitlement tests. */
export async function addReadyAsset(app: NestExpressApplication, episodeId: string, over: Partial<VideoAsset> = {}): Promise<string> {
  const ds = dsOf(app);
  const a = await ds.getRepository(VideoAsset).save({
    episodeId, status: VideoStatus.Ready, sourceKey: `private/source/${episodeId}/fixture.mp4`, sourceFilename: 'fixture.mp4', contentType: 'video/mp4', declaredSizeBytes: '1048576', sizeBytes: '1048576', checksumSha256: null,
    hlsPrefix: `private/hls/fixture-${episodeId}/g1/`, variants: [{ name: '720p', width: 720, height: 1280, bandwidth: 3000000 }], durationSeconds: 300, width: 720, height: 1280, thumbnailKey: null,
    encryptionKeyEnc: encryptString(app.get(KeyService).mediaEncryption, randomBytes(16)), processingAttempts: 1, generation: 1, failureReason: null, processingStartedAt: null, processedAt: new Date(), createdByAdminId: null, ...over,
  });
  await ds.query('UPDATE episodes SET current_asset_id = ?, duration_seconds = 300 WHERE id = ?', [a.id, episodeId]);
  return a.id;
}

/** A signed-in viewer with a real, paid subscription (dev gateway + signed checkout, the same path as production). */
export async function subscribedViewer(app: NestExpressApplication, plan = 'monthly') {
  const v = await viewerViaOtp(app);
  const gw = app.get(PaymentGateway) as unknown as DevPaymentGateway;
  const order = (await http(app).post('/api/v1/subscriptions/checkout').set(bearer(v.accessToken)).send({ planCode: plan }).expect(200)).body;
  const gp = gw.simulatePayment(order.orderId);
  await http(app).post('/api/v1/subscriptions/verify').set(bearer(v.accessToken)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: gp.id, razorpay_signature: gw.signCheckout(order.orderId, gp.id) }).expect(200);
  return { token: v.accessToken, id: v.user.id, refreshToken: v.refreshToken };
}

/** Fetches a binary response body. */
export const getBinary = (app: NestExpressApplication, url: string, headers: Record<string, string> = {}) =>
  http(app).get(url).set(headers).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
