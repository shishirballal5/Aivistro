import { NestExpressApplication } from '@nestjs/platform-express';
import { SocialTokenVerifier } from '../src/util/thirdparty/social-login/social.verifier';
import { DevOutbox } from '../src/util/thirdparty/sms-email/senders';
import { AuthSession, User, UserStatus } from '../src/database/entities/index';
import { createApp } from './helpers';
import { adminToken, bearer, dsOf, GOOD_PASSWORD, http, makeIdTokenIssuer, otpFrom, registerVerifiedViewer, resetData, skipCooldown, uniqueEmail, uniquePhone, viewerViaOtp } from './factories';

describe('viewer authentication (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp(); await resetData(app); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => app.get(DevOutbox).clear());

  describe('phone + OTP', () => {
    it('signs in a new user, then the same number again, and returns the same account', async () => {
      const phone = uniquePhone();
      const first = await viewerViaOtp(app, phone);
      await skipCooldown(app);
      const second = await viewerViaOtp(app, phone);
      expect(second.user.id).toBe(first.user.id);
      const me = await http(app).get('/api/v1/me').set(bearer(first.accessToken)).expect(200);
      expect(me.body).toMatchObject({ id: first.user.id, phone: `+91${phone}`, emailVerified: false });
    });

    it('never returns or logs the code to the caller', async () => {
      const phone = uniquePhone();
      const res = await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      expect(JSON.stringify(res.body)).not.toContain(otpFrom(app, phone));
      expect(res.body).toMatchObject({ expiresInSeconds: 300, resendAfterSeconds: 30 });
    });

    it('rejects a wrong code, and a code cannot be used twice', async () => {
      const phone = uniquePhone();
      await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      const code = otpFrom(app, phone);
      const wrong = code === '000000' ? '111111' : '000000';
      const bad = await http(app).post('/api/v1/auth/otp/verify').send({ phone, code: wrong }).expect(400);
      expect(bad.body.code).toBe('INVALID_OTP');
      await http(app).post('/api/v1/auth/otp/verify').send({ phone, code }).expect(200);
      await http(app).post('/api/v1/auth/otp/verify').send({ phone, code }).expect(400); // already consumed
    });

    it('locks a challenge after 5 wrong guesses: even the correct code then fails', async () => {
      const phone = uniquePhone();
      await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      const code = otpFrom(app, phone);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await http(app).post('/api/v1/auth/otp/verify').send({ phone, code: wrong }).expect(400);
      await http(app).post('/api/v1/auth/otp/verify').send({ phone, code }).expect(400);
    });

    it('parallel guesses cannot exceed the attempt limit', async () => {
      const phone = uniquePhone();
      await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      const code = otpFrom(app, phone);
      const wrong = code === '000000' ? '111111' : '000000';
      await Promise.all(Array.from({ length: 12 }, () => http(app).post('/api/v1/auth/otp/verify').send({ phone, code: wrong })));
      await http(app).post('/api/v1/auth/otp/verify').send({ phone, code }).expect(400);
      const [row] = await dsOf(app).query('SELECT attempts FROM otp_challenges WHERE destination = ? ORDER BY id DESC LIMIT 1', [`+91${phone}`]);
      expect(Number(row.attempts)).toBeLessThanOrEqual(5);
    });

    it('rejects an expired code', async () => {
      const phone = uniquePhone();
      await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      await dsOf(app).query('UPDATE otp_challenges SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE destination = ?', [`+91${phone}`]);
      await http(app).post('/api/v1/auth/otp/verify').send({ phone, code: otpFrom(app, phone) }).expect(400);
    });

    it('enforces a resend cooldown and an hourly cap per number', async () => {
      const phone = uniquePhone();
      await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      const cool = await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(429);
      expect(cool.body.code).toBe('OTP_COOLDOWN');
      for (let i = 0; i < 4; i++) { await skipCooldown(app); await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202); }
      await skipCooldown(app);
      const capped = await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(429);
      expect(capped.body.code).toBe('OTP_RATE_LIMITED');
    });

    it('rejects malformed phone numbers and unexpected fields', async () => {
      await http(app).post('/api/v1/auth/otp/request').send({ phone: '12345' }).expect(400);
      await http(app).post('/api/v1/auth/otp/request').send({ phone: uniquePhone(), role: 'ADMIN' }).expect(400);
      await http(app).post('/api/v1/auth/otp/verify').send({ phone: uniquePhone(), code: '12' }).expect(400);
    });

    it('does not create an account when the code is wrong', async () => {
      const phone = uniquePhone();
      await http(app).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
      await http(app).post('/api/v1/auth/otp/verify').send({ phone, code: '999999' }).expect(400);
      expect(await dsOf(app).getRepository(User).count({ where: { phone: `+91${phone}` } })).toBe(0);
    });
  });

  describe('email + password', () => {
    it('requires email verification before the first sign-in', async () => {
      const email = uniqueEmail();
      await http(app).post('/api/v1/auth/register').send({ email, password: GOOD_PASSWORD, displayName: 'Asha', dateOfBirth: '1990-01-01' }).expect(202);
      const blocked = await http(app).post('/api/v1/auth/login').send({ email, password: GOOD_PASSWORD }).expect(403);
      expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
      const link = app.get(DevOutbox).last(email)!.body;
      const token = /token=([\w-]+)/.exec(link)![1];
      await http(app).post('/api/v1/auth/email/verify').send({ token }).expect(204);
      await http(app).post('/api/v1/auth/email/verify').send({ token }).expect(400); // single use
      const ok = await http(app).post('/api/v1/auth/login').send({ email, password: GOOD_PASSWORD }).expect(200);
      expect(ok.body.user).toMatchObject({ email, emailVerified: true, displayName: 'Asha' });
      expect(JSON.stringify(ok.body)).not.toMatch(/passwordHash|argon2/);
    });

    it('does not reveal whether an email is already registered', async () => {
      const { email } = await registerVerifiedViewer(app);
      const again = await http(app).post('/api/v1/auth/register').send({ email, password: GOOD_PASSWORD, displayName: 'Other', dateOfBirth: '1990-01-01' }).expect(202);
      const fresh = await http(app).post('/api/v1/auth/register').send({ email: uniqueEmail(), password: GOOD_PASSWORD, displayName: 'New', dateOfBirth: '1990-01-01' }).expect(202);
      expect(again.body).toEqual(fresh.body);
      const wrongPw = await http(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password-123' }).expect(401);
      const noUser = await http(app).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'wrong-password-123' }).expect(401);
      expect(wrongPw.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPw.body.message).toBe(noUser.body.message);
    });

    it('rejects weak passwords', async () => {
      const r = await http(app).post('/api/v1/auth/register').send({ email: uniqueEmail(), password: 'Password123', displayName: 'Xavier', dateOfBirth: '1990-01-01' }).expect(400);
      expect(r.body.code).toBe('PASSWORD_TOO_WEAK');
      await http(app).post('/api/v1/auth/register').send({ email: uniqueEmail(), password: 'short', displayName: 'Xavier', dateOfBirth: '1990-01-01' }).expect(400);
    });

    it('locks the account after 5 failed attempts, even for the right password', async () => {
      const { email, password } = await registerVerifiedViewer(app);
      for (let i = 0; i < 5; i++) await http(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password-123' }).expect(401);
      const locked = await http(app).post('/api/v1/auth/login').send({ email, password }).expect(423);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      await dsOf(app).query('UPDATE users SET locked_until = NULL WHERE email = ?', [email]);
      await http(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    });

    it('stores only an argon2id hash, never the password', async () => {
      const { email, password } = await registerVerifiedViewer(app);
      const [row] = await dsOf(app).query('SELECT password_hash FROM users WHERE email = ?', [email]);
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain(password);
    });
  });

  describe('refresh tokens', () => {
    it('rotates on every refresh and the new tokens work', async () => {
      const a = await viewerViaOtp(app);
      const r1 = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(200);
      expect(r1.body.refreshToken).not.toBe(a.refreshToken);
      await http(app).get('/api/v1/me').set(bearer(r1.body.accessToken)).expect(200);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(200);
    });

    it('detects replay of a used token: 401 REFRESH_TOKEN_REUSED and the WHOLE session dies', async () => {
      const a = await viewerViaOtp(app);
      const r1 = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(200);
      const replay = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');
      // the thief AND the legitimate holder are both cut off: the newest refresh token and access token no longer work
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
      await http(app).get('/api/v1/me').set(bearer(r1.body.accessToken)).expect(401);
      const [audit] = await dsOf(app).query("SELECT action FROM audit_logs WHERE action = 'auth.refresh_token_reuse_detected' ORDER BY id DESC LIMIT 1");
      expect(audit.action).toBe('auth.refresh_token_reuse_detected');
    });

    it('two simultaneous refreshes of the same token: at most one succeeds, then the session is revoked', async () => {
      const a = await viewerViaOtp(app);
      const results = await Promise.all([1, 2].map(() => http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(1);
    });

    it('rejects unknown, expired and access-token-as-refresh inputs', async () => {
      const a = await viewerViaOtp(app);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(43) }).expect(401);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.accessToken }).expect(401);
      await dsOf(app).query('UPDATE refresh_tokens SET expires_at = NOW(3) - INTERVAL 1 SECOND');
      const r = await http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
      expect(r.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('stores refresh tokens only as hashes', async () => {
      const a = await viewerViaOtp(app);
      const rows = await dsOf(app).query('SELECT token_hash FROM refresh_tokens');
      expect(JSON.stringify(rows)).not.toContain(a.refreshToken);
    });
  });

  describe('sessions and logout', () => {
    it('logout kills that device immediately; other devices keep working', async () => {
      const phone = uniquePhone();
      const d1 = await viewerViaOtp(app, phone); await skipCooldown(app);
      const d2 = await viewerViaOtp(app, phone);
      await http(app).post('/api/v1/auth/logout').set(bearer(d1.accessToken)).expect(204);
      await http(app).get('/api/v1/me').set(bearer(d1.accessToken)).expect(401);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: d1.refreshToken }).expect(401);
      await http(app).get('/api/v1/me').set(bearer(d2.accessToken)).expect(200);
    });

    it('logout-all signs out every device', async () => {
      const phone = uniquePhone();
      const d1 = await viewerViaOtp(app, phone); await skipCooldown(app);
      const d2 = await viewerViaOtp(app, phone);
      await http(app).post('/api/v1/auth/logout-all').set(bearer(d2.accessToken)).expect(204);
      await http(app).get('/api/v1/me').set(bearer(d1.accessToken)).expect(401);
      await http(app).get('/api/v1/me').set(bearer(d2.accessToken)).expect(401);
    });

    it('lists devices and lets a user revoke their own, but never someone else\'s', async () => {
      const a = await viewerViaOtp(app); const b = await viewerViaOtp(app);
      const mine = await http(app).get('/api/v1/me/sessions').set(bearer(a.accessToken)).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({ deviceName: 'test phone', current: true });
      const theirs = await http(app).get('/api/v1/me/sessions').set(bearer(b.accessToken)).expect(200);
      await http(app).delete(`/api/v1/me/sessions/${theirs.body[0].id}`).set(bearer(a.accessToken)).expect(404);
      await http(app).get('/api/v1/me').set(bearer(b.accessToken)).expect(200);
    });

    it('rejects missing, malformed, tampered and wrong-audience tokens', async () => {
      const a = await viewerViaOtp(app);
      await http(app).get('/api/v1/me').expect(401);
      await http(app).get('/api/v1/me').set({ Authorization: 'Bearer nonsense' }).expect(401);
      await http(app).get('/api/v1/me').set({ Authorization: `Bearer ${a.accessToken.slice(0, -3)}abc` }).expect(401);
      await http(app).get('/api/v1/me').set({ Authorization: `Basic ${a.accessToken}` }).expect(401);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(a.accessToken)).expect(401); // a viewer token is not an admin token
    });
  });

  describe('account status is enforced on every request', () => {
    it('a suspended user is cut off immediately, cannot refresh or sign in, and can be restored', async () => {
      const { email, password } = await registerVerifiedViewer(app);
      const login = await http(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
      const admin = await adminToken(app, ['SUPPORT']);
      await http(app).post(`/api/v1/admin/users/${login.body.user.id}/suspend`).set(bearer(admin)).send({ reason: 'abuse' }).expect(200);

      const me = await http(app).get('/api/v1/me').set(bearer(login.body.accessToken));
      expect([401, 403]).toContain(me.status); // sessions were revoked on suspend
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
      const blocked = await http(app).post('/api/v1/auth/login').send({ email, password }).expect(403);
      expect(blocked.body.code).toBe('ACCOUNT_SUSPENDED');

      await http(app).post(`/api/v1/admin/users/${login.body.user.id}/restore`).set(bearer(admin)).expect(200);
      await http(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
    });

    it('even a still-valid access token is refused the moment the account is suspended directly in the database', async () => {
      const a = await viewerViaOtp(app);
      await dsOf(app).getRepository(User).update(a.user.id, { status: UserStatus.Suspended });
      const r = await http(app).get('/api/v1/me').set(bearer(a.accessToken)).expect(403);
      expect(r.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('an OTP sign-in for a suspended number is refused', async () => {
      const a = await viewerViaOtp(app);
      await dsOf(app).getRepository(User).update(a.user.id, { status: UserStatus.Suspended });
      await skipCooldown(app);
      await http(app).post('/api/v1/auth/otp/request').send({ phone: a.phone }).expect(202);
      const r = await http(app).post('/api/v1/auth/otp/verify').send({ phone: a.phone, code: otpFrom(app, a.phone) }).expect(403);
      expect(r.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('a session past its absolute lifetime cannot be used or refreshed', async () => {
      const a = await viewerViaOtp(app);
      await dsOf(app).getRepository(AuthSession).update({ userId: a.user.id }, { expiresAt: new Date(Date.now() - 1000) });
      await http(app).get('/api/v1/me').set(bearer(a.accessToken)).expect(401);
      await http(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
    });
  });

  describe('password reset', () => {
    it('resets with a single-use link, signs out all devices, and rejects weak passwords', async () => {
      const { email, password } = await registerVerifiedViewer(app);
      const login = await http(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
      app.get(DevOutbox).clear();
      await http(app).post('/api/v1/auth/password/forgot').send({ email }).expect(202);
      const token = /token=([\w-]+)/.exec(app.get(DevOutbox).last(email)!.body)![1];

      await http(app).post('/api/v1/auth/password/reset').send({ token, newPassword: 'short' }).expect(400);
      await http(app).post('/api/v1/auth/password/reset').send({ token, newPassword: 'a-brand-new-passphrase' }).expect(204);
      await http(app).post('/api/v1/auth/password/reset').send({ token, newPassword: 'another-new-passphrase' }).expect(400); // single use

      await http(app).get('/api/v1/me').set(bearer(login.body.accessToken)).expect(401); // old session revoked
      await http(app).post('/api/v1/auth/login').send({ email, password }).expect(401);
      await http(app).post('/api/v1/auth/login').send({ email, password: 'a-brand-new-passphrase' }).expect(200);
    });

    it('answers identically for unknown emails and sends nothing', async () => {
      const known = (await registerVerifiedViewer(app)).email;
      app.get(DevOutbox).clear();
      const a = await http(app).post('/api/v1/auth/password/forgot').send({ email: known }).expect(202);
      const b = await http(app).post('/api/v1/auth/password/forgot').send({ email: uniqueEmail() }).expect(202);
      expect(a.body).toEqual(b.body);
      expect(app.get(DevOutbox).messages).toHaveLength(1);
    });

    it('rejects an expired reset link', async () => {
      const { email } = await registerVerifiedViewer(app);
      app.get(DevOutbox).clear();
      await http(app).post('/api/v1/auth/password/forgot').send({ email }).expect(202);
      const token = /token=([\w-]+)/.exec(app.get(DevOutbox).last(email)!.body)![1];
      await dsOf(app).query("UPDATE email_tokens SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE purpose = 'RESET_PASSWORD'");
      await http(app).post('/api/v1/auth/password/reset').send({ token, newPassword: 'a-brand-new-passphrase' }).expect(400);
    });
  });

  describe('profile', () => {
    it('updates the profile, merges notification preferences, and rejects unexpected or unsafe input', async () => {
      const a = await viewerViaOtp(app);
      const r = await http(app).patch('/api/v1/me/profile').set(bearer(a.accessToken)).send({ displayName: 'Asha K', language: 'en', notificationPreferences: { marketing: false } }).expect(200);
      expect(r.body).toMatchObject({ displayName: 'Asha K', language: 'en' });
      await http(app).patch('/api/v1/me/profile').set(bearer(a.accessToken)).send({ role: 'ADMIN' }).expect(400);
      await http(app).patch('/api/v1/me/profile').set(bearer(a.accessToken)).send({ avatarUrl: 'http://insecure.example/a.png' }).expect(400);
      await http(app).patch('/api/v1/me/profile').set(bearer(a.accessToken)).send({ avatarUrl: 'javascript:alert(1)' }).expect(400);
      await http(app).patch('/api/v1/me/profile').set(bearer(a.accessToken)).send({ language: 'xx' }).expect(400);
      const [p] = await dsOf(app).query('SELECT notification_preferences AS n FROM profiles WHERE user_id = ?', [a.user.id]);
      expect(typeof p.n === 'string' ? JSON.parse(p.n) : p.n).toEqual({ marketing: false, newEpisodes: true, billing: true });
    });
  });
});

describe('Google / Apple sign-in', () => {
  let app: NestExpressApplication;
  let issuer: Awaited<ReturnType<typeof makeIdTokenIssuer>>;
  beforeAll(async () => {
    issuer = await makeIdTokenIssuer();
    app = await createApp({ GOOGLE_CLIENT_IDS: 'test-google-client' }, (b) =>
      b.overrideProvider(SocialTokenVerifier).useFactory({ factory: () => new SocialTokenVerifier({ googleClientIds: ['test-google-client'], appleClientIds: [] } as never, () => issuer.jwks), inject: [] }));
    await resetData(app);
  });
  afterAll(async () => { await app.close(); });
  const google = (idToken: string, extra: object = {}) => http(app).post('/api/v1/auth/google').send({ idToken, dateOfBirth: '1990-01-01', ...extra });

  it('signs in with a valid token, creates the account, and recognises it next time', async () => {
    const sub = `g-${Date.now()}`;
    const t = await issuer.sign({ sub, email: 'Maya@Example.com', email_verified: true, name: 'Maya L' });
    const first = await google(t).expect(200);
    expect(first.body.user).toMatchObject({ displayName: 'Maya L', email: 'maya@example.com', emailVerified: true });
    const second = await google(await issuer.sign({ sub, email: 'maya@example.com', email_verified: true })).expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    await http(app).get('/api/v1/me').set(bearer(first.body.accessToken)).expect(200);
  });

  it.each([
    ['wrong audience (token for another app)', (i: typeof issuer) => i.sign({ sub: 'x' }, { aud: 'someone-elses-client' })],
    ['wrong issuer', (i: typeof issuer) => i.sign({ sub: 'x' }, { iss: 'https://evil.example' })],
    ['expired', (i: typeof issuer) => i.sign({ sub: 'x' }, { exp: '-1m' })],
    ['signed with a different key (forged)', (i: typeof issuer) => i.sign({ sub: 'x' }, { key: i.wrongKey })],
    ['no subject', (i: typeof issuer) => i.sign({})],
  ])('rejects a token with %s', async (_label, make) => {
    const r = await google(await make(issuer)).expect(401);
    expect(r.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects garbage and alg=none tokens', async () => {
    await google('not.a.jwt'.padEnd(30, 'x')).expect(401);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x","iss":"https://accounts.google.com","aud":"test-google-client"}').toString('base64url')}.`;
    await google(none).expect(401);
  });

  it('checks the nonce when one is supplied', async () => {
    const t = await issuer.sign({ sub: `n-${Date.now()}`, nonce: 'abc' });
    await google(t, { nonce: 'different' }).expect(401);
    await google(t, { nonce: 'abc' }).expect(200);
  });

  it('is disabled (503) for a provider with no configured client id', async () => {
    const r = await http(app).post('/api/v1/auth/apple').send({ idToken: 'x'.repeat(40) }).expect(503);
    expect(r.body.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('links to an existing account by email ONLY when both the provider and our record say the email is verified', async () => {
    const { email } = await registerVerifiedViewer(app);
    const local = await dsOf(app).getRepository(User).findOneByOrFail({ email });
    const r = await google(await issuer.sign({ sub: `link-${Date.now()}`, email, email_verified: true })).expect(200);
    expect(r.body.user.id).toBe(local.id);
  });

  it('does NOT link when the provider has not verified the email (prevents account takeover)', async () => {
    const { email } = await registerVerifiedViewer(app);
    const local = await dsOf(app).getRepository(User).findOneByOrFail({ email });
    const r = await google(await issuer.sign({ sub: `nolink-${Date.now()}`, email, email_verified: false })).expect(200);
    expect(r.body.user.id).not.toBe(local.id);
    expect(r.body.user.email).toBeNull();
  });

  it('does NOT take over an UNverified local account that has the same email (pre-hijacking)', async () => {
    const email = uniqueEmail();
    await http(app).post('/api/v1/auth/register').send({ email, password: GOOD_PASSWORD, displayName: 'Attacker', dateOfBirth: '1990-01-01' }).expect(202); // never verified
    const victim = await google(await issuer.sign({ sub: `victim-${Date.now()}`, email, email_verified: true })).expect(200);
    const attacker = await dsOf(app).getRepository(User).findOneByOrFail({ email });
    expect(victim.body.user.id).not.toBe(attacker.id);
    await http(app).post('/api/v1/auth/login').send({ email, password: GOOD_PASSWORD }).expect(403); // attacker still cannot get in
  });
});

describe('providers disabled by configuration', () => {
  it('phone sign-in returns 503 when no SMS provider is configured, and sends nothing', async () => {
    const app = await createApp({ SMS_PROVIDER: 'none' });
    try {
      const r = await http(app).post('/api/v1/auth/otp/request').send({ phone: uniquePhone() }).expect(503);
      expect(r.body.code).toBe('SMS_NOT_CONFIGURED');
    } finally { await app.close(); }
  });
  it('email sign-up returns 503 when no email provider is configured', async () => {
    const app = await createApp({ EMAIL_PROVIDER: 'none' });
    try {
      const r = await http(app).post('/api/v1/auth/register').send({ email: uniqueEmail(), password: GOOD_PASSWORD, displayName: 'Xavier', dateOfBirth: '1990-01-01' }).expect(503);
      expect(r.body.code).toBe('EMAIL_NOT_CONFIGURED');
    } finally { await app.close(); }
  });
});
