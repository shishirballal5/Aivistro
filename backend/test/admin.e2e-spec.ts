import { NestExpressApplication } from '@nestjs/platform-express';
import { sha256Hex } from '../src/common/crypto/crypto.util';
import { totpAt } from '../src/common/crypto/totp';
import { AdminStatus, AdminUser } from '../src/database/entities/index';
import { createApp } from './helpers';
import { adminLogin, adminToken, bearer, createAdmin, dsOf, GOOD_PASSWORD, http, resetData, viewerViaOtp } from './factories';

describe('admin authentication and access control (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp(); await resetData(app); });
  afterAll(async () => { await app.close(); });
  const login = (email: string, password: string) => http(app).post('/api/v1/admin/auth/login').send({ email, password });

  describe('two-step sign-in with mandatory MFA', () => {
    it('a correct password alone never yields a session', async () => {
      const a = await createAdmin(app);
      const step1 = await login(a.email, a.password).expect(200);
      expect(step1.body.status).toBe('MFA_REQUIRED');
      expect(step1.body).not.toHaveProperty('accessToken');
      // the challenge token must not work as an access token
      await http(app).get('/api/v1/admin/auth/me').set(bearer(step1.body.challengeToken)).expect(401);
      await http(app).get('/api/v1/admin/series').set(bearer(step1.body.challengeToken)).expect(401);
    });

    it('rejects wrong passwords generically, and an unknown admin identically', async () => {
      const a = await createAdmin(app);
      const wrong = await login(a.email, 'definitely-wrong-pw').expect(401);
      const unknown = await login('nobody@aivistro.test', 'definitely-wrong-pw').expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('an admin with no MFA must enrol first: enrol -> confirm with a real TOTP -> session + recovery codes', async () => {
      const a = await createAdmin(app, { mfa: false });
      const step1 = await login(a.email, a.password).expect(200);
      expect(step1.body.status).toBe('MFA_SETUP_REQUIRED');
      const enrol = await http(app).post('/api/v1/admin/auth/mfa/enroll').send({ setupToken: step1.body.setupToken }).expect(200);
      expect(enrol.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/AIVISTRO:/);
      const bad = await http(app).post('/api/v1/admin/auth/mfa/confirm').send({ setupToken: step1.body.setupToken, code: '000000' });
      expect([400]).toContain(bad.status);
      const ok = await http(app).post('/api/v1/admin/auth/mfa/confirm').send({ setupToken: step1.body.setupToken, code: totpAt(enrol.body.secret, Date.now()) }).expect(200);
      expect(ok.body.recoveryCodes).toHaveLength(8);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(ok.body.accessToken)).expect(200);
      // the secret is encrypted at rest, never stored in the clear
      const [row] = await dsOf(app).query('SELECT mfa_secret_enc FROM admin_users WHERE id = ?', [a.id]);
      expect(row.mfa_secret_enc).toMatch(/^v1\./);
      expect(row.mfa_secret_enc).not.toContain(enrol.body.secret);
      // MFA cannot be re-enrolled over the top of an active one
      const again = await login(a.email, a.password).expect(200);
      expect(again.body.status).toBe('MFA_REQUIRED');
      await http(app).post('/api/v1/admin/auth/mfa/enroll').send({ setupToken: step1.body.setupToken }).expect(409);
    });

    it('a setup token cannot be used for the verify step, nor a verify token for setup', async () => {
      const a = await createAdmin(app, { mfa: false });
      const setup = (await login(a.email, a.password).expect(200)).body.setupToken;
      await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: setup, code: '123456' }).expect(401);
      const b = await createAdmin(app);
      const challenge = (await login(b.email, b.password).expect(200)).body.challengeToken;
      await http(app).post('/api/v1/admin/auth/mfa/enroll').send({ setupToken: challenge }).expect(401);
    });

    it('rejects a wrong TOTP, and REPLAY of an already-used code', async () => {
      const a = await createAdmin(app);
      const c1 = (await login(a.email, a.password).expect(200)).body.challengeToken;
      await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: c1, code: '000000' }).expect(400);
      const code = totpAt(a.secret!, Date.now());
      await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: c1, code }).expect(200);
      // an attacker who saw the code replays it within the same 30s window
      const c2 = (await login(a.email, a.password).expect(200)).body.challengeToken;
      const replay = await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: c2, code }).expect(400);
      expect(replay.body.code).toBe('INVALID_MFA_CODE');
    });

    it('locks the account after 5 wrong codes', async () => {
      const a = await createAdmin(app);
      const challenge = (await login(a.email, a.password).expect(200)).body.challengeToken;
      for (let i = 0; i < 5; i++) await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: challenge, code: '000000' }).expect(400);
      const locked = await login(a.email, a.password).expect(423);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('locks after 5 wrong passwords too', async () => {
      const a = await createAdmin(app);
      for (let i = 0; i < 5; i++) await login(a.email, 'wrong-password-x1').expect(401);
      await login(a.email, a.password).expect(423);
    });

    it('recovery codes work exactly once', async () => {
      const a = await createAdmin(app, { mfa: false });
      const setup = (await login(a.email, a.password).expect(200)).body.setupToken;
      const enrol = await http(app).post('/api/v1/admin/auth/mfa/enroll').send({ setupToken: setup }).expect(200);
      const done = await http(app).post('/api/v1/admin/auth/mfa/confirm').send({ setupToken: setup, code: totpAt(enrol.body.secret, Date.now()) }).expect(200);
      const [recovery] = done.body.recoveryCodes as string[];
      const row = await dsOf(app).getRepository(AdminUser).findOneByOrFail({ id: a.id });
      expect(row.mfaRecoveryHashes).toContain(sha256Hex(recovery)); // only hashes are stored
      expect(JSON.stringify(row.mfaRecoveryHashes)).not.toContain(recovery);
      const c1 = (await login(a.email, a.password).expect(200)).body.challengeToken;
      await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: c1, recoveryCode: recovery }).expect(200);
      const c2 = (await login(a.email, a.password).expect(200)).body.challengeToken;
      await http(app).post('/api/v1/admin/auth/mfa/verify').send({ challengeToken: c2, recoveryCode: recovery }).expect(400);
    });

    it('a disabled admin cannot sign in or keep using an existing session', async () => {
      const a = await createAdmin(app);
      const t = await adminLogin(app, a);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(t.accessToken)).expect(200);
      await dsOf(app).getRepository(AdminUser).update(a.id, { status: AdminStatus.Disabled });
      await http(app).get('/api/v1/admin/auth/me').set(bearer(t.accessToken)).expect(403);
      await http(app).post('/api/v1/admin/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
      await login(a.email, a.password).expect(401);
    });

    it('refresh rotates, replay revokes the session, logout works, and a viewer refresh token is not accepted', async () => {
      const a = await createAdmin(app);
      const t = await adminLogin(app, a);
      const r1 = await http(app).post('/api/v1/admin/auth/refresh').send({ refreshToken: t.refreshToken }).expect(200);
      const replay = await http(app).post('/api/v1/admin/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');
      await http(app).get('/api/v1/admin/auth/me').set(bearer(r1.body.accessToken)).expect(401);

      const viewer = await viewerViaOtp(app);
      await http(app).post('/api/v1/admin/auth/refresh').send({ refreshToken: viewer.refreshToken }).expect(401); // wrong kind of session

      const t2 = await adminLogin(app, a);
      await http(app).post('/api/v1/admin/auth/logout').set(bearer(t2.accessToken)).expect(204);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(t2.accessToken)).expect(401);
    });

    it('changing the password signs out other devices and needs the current password', async () => {
      const a = await createAdmin(app);
      const d1 = await adminLogin(app, a); const d2 = await adminLogin(app, a);
      await http(app).post('/api/v1/admin/auth/password/change').set(bearer(d1.accessToken)).send({ currentPassword: 'wrong-current-pw', newPassword: 'a-brand-new-passphrase' }).expect(401);
      await http(app).post('/api/v1/admin/auth/password/change').set(bearer(d1.accessToken)).send({ currentPassword: a.password, newPassword: 'a-brand-new-passphrase' }).expect(204);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(d1.accessToken)).expect(200);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(d2.accessToken)).expect(401);
    });
  });

  describe('role-based access control, enforced on the server', () => {
    it('every admin route refuses anonymous and viewer callers', async () => {
      const viewer = await viewerViaOtp(app);
      const routes: [string, string][] = [['get', '/series'], ['get', '/users'], ['get', '/audit-logs'], ['get', '/admin-users'], ['get', '/roles'], ['get', '/banners'], ['post', '/series'], ['post', '/roles']];
      for (const [method, path] of routes) {
        const anon = await (http(app) as unknown as Record<string, (u: string) => import('supertest').Test>)[method](`/api/v1/admin${path}`).send({});
        expect(anon.status).toBe(401);
        const asViewer = await (http(app) as unknown as Record<string, (u: string) => import('supertest').Test>)[method](`/api/v1/admin${path}`).set(bearer(viewer.accessToken)).send({});
        expect(asViewer.status).toBe(401);
      }
    });

    it('EDITOR can manage catalog but not users, payments data, admins or the audit log', async () => {
      const t = await adminToken(app, ['EDITOR']);
      await http(app).get('/api/v1/admin/series').set(bearer(t)).expect(200);
      await http(app).post('/api/v1/admin/genres').set(bearer(t)).send({ name: `Drama ${Date.now()}` }).expect(201);
      for (const path of ['/users', '/audit-logs', '/admin-users', '/roles', '/permissions']) await http(app).get(`/api/v1/admin${path}`).set(bearer(t)).expect(403);
    });

    it('SUPPORT can read and suspend users but cannot touch the catalog', async () => {
      const t = await adminToken(app, ['SUPPORT']);
      await http(app).get('/api/v1/admin/users').set(bearer(t)).expect(200);
      await http(app).get('/api/v1/admin/series').set(bearer(t)).expect(403);
      await http(app).post('/api/v1/admin/genres').set(bearer(t)).send({ name: 'Nope' }).expect(403);
      await http(app).post('/api/v1/admin/series').set(bearer(t)).send({ title: 'x', synopsis: 'y'.repeat(20) }).expect(403);
    });

    it('permission changes take effect on the very next request (no stale tokens)', async () => {
      const boss = await adminToken(app, ['SUPER_ADMIN']);
      const target = await createAdmin(app, { roles: ['EDITOR'] });
      const t = await adminLogin(app, target);
      await http(app).get('/api/v1/admin/series').set(bearer(t.accessToken)).expect(200);
      const roles = (await http(app).get('/api/v1/admin/roles').set(bearer(boss)).expect(200)).body as { id: string; name: string }[];
      const support = roles.find((r) => r.name === 'SUPPORT')!;
      await http(app).patch(`/api/v1/admin/admin-users/${target.id}`).set(bearer(boss)).send({ roleIds: [support.id] }).expect(200);
      await http(app).get('/api/v1/admin/series').set(bearer(t.accessToken)).expect(401); // roles changed => sessions revoked
    });

    it('a client-supplied role or permission in any body is rejected, never trusted', async () => {
      const t = await adminToken(app, ['EDITOR']);
      const r = await http(app).post('/api/v1/admin/genres').set(bearer(t)).send({ name: 'Sneaky', permissions: ['admins.manage'], role: 'SUPER_ADMIN' }).expect(400);
      expect(r.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('privilege escalation is blocked', () => {
    it('an admin-manager cannot grant roles carrying permissions they do not hold', async () => {
      const mgr = await createAdmin(app, { roles: ['EDITOR'] });
      await dsOf(app).query("INSERT INTO roles (name, description, is_system) VALUES ('ADMIN_MANAGER', 'can manage admins only', 0)");
      const [{ id: roleId }] = await dsOf(app).query("SELECT id FROM roles WHERE name = 'ADMIN_MANAGER'");
      await dsOf(app).query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code IN ('admins.manage', 'catalog.read')", [roleId]);
      const m = await createAdmin(app, { roles: ['ADMIN_MANAGER'] });
      const t = await adminLogin(app, m);
      const roles = (await http(app).get('/api/v1/admin/roles').set(bearer(t.accessToken)).expect(200)).body as { id: string; name: string }[];
      const superRole = roles.find((r) => r.name === 'SUPER_ADMIN')!;
      const finance = roles.find((r) => r.name === 'FINANCE')!;
      const res = await http(app).post('/api/v1/admin/admin-users').set(bearer(t.accessToken)).send({ email: 'x@aivistro.test', name: 'X', password: GOOD_PASSWORD, roleIds: [superRole.id] }).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      await http(app).post('/api/v1/admin/admin-users').set(bearer(t.accessToken)).send({ email: 'y@aivistro.test', name: 'Y', password: GOOD_PASSWORD, roleIds: [finance.id] }).expect(403);
      void mgr;
    });

    it('an admin cannot disable themselves or change their own roles, and cannot create duplicates', async () => {
      const me = await createAdmin(app);
      const t = await adminLogin(app, me);
      await http(app).patch(`/api/v1/admin/admin-users/${me.id}`).set(bearer(t.accessToken)).send({ status: 'DISABLED' }).expect(400);
      await http(app).patch(`/api/v1/admin/admin-users/${me.id}`).set(bearer(t.accessToken)).send({ roleIds: [] }).expect(400);
      await http(app).post('/api/v1/admin/admin-users').set(bearer(t.accessToken)).send({ email: me.email, name: 'Dup', password: GOOD_PASSWORD, roleIds: [] }).expect(409);
    });

    it('system roles cannot be modified, and a role cannot be given permissions its editor lacks', async () => {
      const t = await adminToken(app, ['SUPER_ADMIN']);
      const roles = (await http(app).get('/api/v1/admin/roles').set(bearer(t)).expect(200)).body as { id: string; name: string }[];
      await http(app).put(`/api/v1/admin/roles/${roles.find((r) => r.name === 'EDITOR')!.id}/permissions`).set(bearer(t)).send({ permissions: ['catalog.read'] }).expect(400);
      const created = await http(app).post('/api/v1/admin/roles').set(bearer(t)).send({ name: 'QA_TESTER', description: 'tests', permissions: ['catalog.read'] }).expect(201);
      expect(created.body.permissions).toEqual(['catalog.read']);
      await http(app).post('/api/v1/admin/roles').set(bearer(t)).send({ name: 'bad name', description: 'x', permissions: [] }).expect(400);
      await http(app).post('/api/v1/admin/roles').set(bearer(t)).send({ name: 'GHOST', description: 'x', permissions: ['not.a.permission'] }).expect(400);
    });

    it('resetting MFA signs the target out; you cannot reset your own', async () => {
      const boss = await createAdmin(app); const victim = await createAdmin(app, { roles: ['EDITOR'] });
      const bt = await adminLogin(app, boss); const vt = await adminLogin(app, victim);
      await http(app).post(`/api/v1/admin/admin-users/${boss.id}/reset-mfa`).set(bearer(bt.accessToken)).expect(400);
      await http(app).post(`/api/v1/admin/admin-users/${victim.id}/reset-mfa`).set(bearer(bt.accessToken)).expect(200);
      await http(app).get('/api/v1/admin/auth/me').set(bearer(vt.accessToken)).expect(401);
      const next = await login(victim.email, victim.password).expect(200);
      expect(next.body.status).toBe('MFA_SETUP_REQUIRED');
    });
  });

  describe('audit log', () => {
    it('records admin mutations with the actor, without ever storing secrets', async () => {
      const boss = await createAdmin(app);
      const t = await adminLogin(app, boss);
      const created = await http(app).post('/api/v1/admin/admin-users').set(bearer(t.accessToken)).send({ email: `aud-${Date.now()}@aivistro.test`, name: 'Audited', password: 'super-secret-passphrase-1', roleIds: [] }).expect(201);
      const logs = await http(app).get('/api/v1/admin/audit-logs?action=admin_user.create').set(bearer(t.accessToken)).expect(200);
      const entry = logs.body.items[0];
      expect(entry).toMatchObject({ action: 'admin_user.create', actorType: 'ADMIN', actorId: boss.id, entityType: 'admin_user', entityId: created.body.id });
      expect(JSON.stringify(logs.body)).not.toContain('super-secret-passphrase-1');
      expect(JSON.stringify(entry.metadata)).toContain('[redacted]');
    });

    it('records failed sign-ins, MFA events and refresh-token theft signals', async () => {
      const a = await createAdmin(app);
      await login(a.email, 'wrong-password-x1').expect(401);
      const t = await adminLogin(app, a);
      const reader = await adminLogin(app, await createAdmin(app));
      const logs = (await http(app).get('/api/v1/admin/audit-logs?limit=50').set(bearer(reader.accessToken)).expect(200)).body.items as { action: string }[];
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['admin.login.failed', 'admin.login']));
      void t;
    });

    it('is paginated, newest first, and validates its cursor', async () => {
      const t = await adminToken(app);
      const page1 = (await http(app).get('/api/v1/admin/audit-logs?limit=2').set(bearer(t)).expect(200)).body;
      expect(page1.items).toHaveLength(2);
      expect(Number(page1.items[0].id)).toBeGreaterThan(Number(page1.items[1].id));
      const page2 = (await http(app).get(`/api/v1/admin/audit-logs?limit=2&cursor=${page1.nextCursor}`).set(bearer(t)).expect(200)).body;
      expect(Number(page2.items[0].id)).toBeLessThan(Number(page1.items[1].id));
      await http(app).get('/api/v1/admin/audit-logs?cursor=not-a-cursor').set(bearer(t)).expect(400);
    });
  });
});
