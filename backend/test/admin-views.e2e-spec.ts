import { NestExpressApplication } from '@nestjs/platform-express';
import { AuditLog, Payment, PaymentStatus, PaymentWebhookEvent, Permission, Profile, Role, Subscription, SubscriptionPlan, SubscriptionSource, SubscriptionStatus, User, UserStatus, WebhookStatus } from '../src/database/entities/index';
import { createApp } from './helpers';
import { adminToken, bearer, createAdmin, adminLogin, dsOf, http, resetData, viewerViaOtp } from './factories';

describe('admin data views: suspend reason, people in lists, filters, audit filters, roles tab (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  let admin: string;
  beforeAll(async () => { app = await createApp(); });
  beforeEach(async () => { await resetData(app); admin = await adminToken(app, ['SUPER_ADMIN']); });
  afterAll(async () => { await app.close(); });

  const api = (p: string) => `/api/v1${p}`;
  const repo = <T extends object>(e: new () => T) => dsOf(app).getRepository(e);
  const get = (path: string, token = admin) => http(app).get(api(path)).set(bearer(token));
  let n = 0;

  async function person(name: string, email: string) {
    const v = await viewerViaOtp(app);
    await repo(User).update(v.user.id, { email });
    await repo(Profile).update({ userId: v.user.id }, { displayName: name });
    return v.user.id;
  }
  const plan = (code = 'monthly') => repo(SubscriptionPlan).findOneByOrFail({ code });
  async function sub(userId: string, over: Partial<Subscription> = {}) {
    const p = await plan();
    return repo(Subscription).save({ userId, planId: p.id, paymentId: null, source: SubscriptionSource.AdminGrant, status: SubscriptionStatus.Active, startsAt: new Date(), endsAt: new Date(Date.now() + 864e5), cancelledAt: null, cancelAtPeriodEnd: false, grantedByAdminId: null, grantReason: 'test', ...over });
  }
  async function pay(userId: string, over: Partial<Payment> = {}) {
    const p = await plan(); n++;
    return repo(Payment).save({ userId, planId: p.id, planCode: 'monthly', durationMonths: 1, provider: 'dev', providerOrderId: `order_t${n}`, providerPaymentId: `pay_t${n}`, receipt: `rcpt_t${n}`, amountPaise: '14900', currency: 'INR', status: PaymentStatus.Captured, method: 'upi', failureCode: null, failureReason: null, capturedAt: new Date(), refundedPaise: '0', creditPaise: '0', upgradeFromSubscriptionId: null, upgradeReplacedEndsAt: null, ...over });
  }

  describe('suspend reason', () => {
    it('is stored, shown in the admin list and detail, survives no restore, and still revokes sessions', async () => {
      const v = await viewerViaOtp(app);
      await http(app).post(api(`/admin/users/${v.user.id}/suspend`)).set(bearer(admin)).send({ reason: '  Chargeback abuse  ' }).expect(200).expect((r) => expect(r.body).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Chargeback abuse' }));
      await http(app).get(api('/me')).set(bearer(v.accessToken)).expect(401); // revoked session: signed out everywhere
      expect((await dsOf(app).query('SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL', [v.user.id]))[0].c).toBe('0');
      const detail = (await get(`/admin/users/${v.user.id}`)).body;
      expect(detail).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Chargeback abuse' });
      expect(detail.suspendedAt).toBeTruthy();
      expect((await get('/admin/users?status=SUSPENDED')).body.items[0]).toMatchObject({ id: v.user.id, suspendedReason: 'Chargeback abuse' });
      await http(app).post(api(`/admin/users/${v.user.id}/restore`)).set(bearer(admin)).expect(200);
      expect((await get(`/admin/users/${v.user.id}`)).body).toMatchObject({ status: 'ACTIVE', suspendedReason: null, suspendedAt: null });
    });
    it('works without a reason and rejects an over-long one', async () => {
      const v = await viewerViaOtp(app);
      await http(app).post(api(`/admin/users/${v.user.id}/suspend`)).set(bearer(admin)).send({ reason: 'x'.repeat(256) }).expect(400);
      await http(app).post(api(`/admin/users/${v.user.id}/suspend`)).set(bearer(admin)).send({}).expect(200);
      expect((await get(`/admin/users/${v.user.id}`)).body.suspendedReason).toBeNull();
    });
  });

  describe('lists show people, not ids', () => {
    it('payments and subscriptions carry user {id, displayName, email, phone}; a tombstone and a missing profile are safe', async () => {
      const a = await person('Asha Rao', 'asha@example.com'); const b = await person('Bela Roy', 'bela@example.com');
      await pay(a); await pay(b); await sub(a); await sub(b);
      const payments = (await get('/admin/payments')).body.items;
      expect(payments).toHaveLength(2);
      expect(payments.find((p: { userId: string }) => p.userId === a).user).toEqual({ id: a, displayName: 'Asha Rao', email: 'asha@example.com', phone: expect.stringMatching(/^\+91/) });
      const subs = (await get('/admin/subscriptions?limit=10')).body.items;
      expect(subs.find((s: { userId: string }) => s.userId === b).user).toMatchObject({ displayName: 'Bela Roy', email: 'bela@example.com' });
      expect((await get(`/admin/payments?userId=${a}`)).body.items).toHaveLength(1);
      expect((await get(`/admin/subscriptions?userId=${a}&limit=5`)).body.items).toHaveLength(1);
      const paymentId = payments[0].id;
      expect((await get(`/admin/payments/${paymentId}`)).body.user).toMatchObject({ id: expect.any(String) });
      // tombstone: anonymised contact, still named
      await repo(User).update(a, { phone: null, email: null, status: UserStatus.Deleted }); await repo(Profile).update({ userId: a }, { displayName: 'Deleted user' });
      expect((await get(`/admin/payments?userId=${a}`)).body.items[0].user).toEqual({ id: a, displayName: 'Deleted user', email: null, phone: null });
      // missing profile: displayName null, no crash
      await repo(Profile).delete({ userId: b });
      expect((await get(`/admin/subscriptions?userId=${b}&limit=5`)).body.items[0].user).toMatchObject({ id: b, displayName: null });
    });

    it('does a constant number of queries however many rows are on the page (no N+1)', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) ids.push(await person(`Person ${i}`, `p${i}@example.com`));
      for (const id of ids) { await sub(id); await pay(id); }
      const ds = dsOf(app); const spy: string[] = [];
      const logger = { logQuery: (q: string) => { spy.push(q); }, logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} };
      const prev = ds.logger; (ds as unknown as { logger: unknown }).logger = logger;
      const count = async (path: string) => { spy.length = 0; await get(path).expect(200); return spy.filter((q) => /FROM `(users|profiles)`/.test(q)).length; };
      try {
        const s6 = await count('/admin/subscriptions?limit=100'); const p6 = await count('/admin/payments');
        expect(s6).toBeGreaterThanOrEqual(1); expect(s6).toBeLessThanOrEqual(2); expect(p6).toBeLessThanOrEqual(2);
      } finally { (ds as unknown as { logger: unknown }).logger = prev; }
    });

    it('GET /admin/subscriptions: filters (status, planCode, userId, q) and cursor pagination across >1 page, max page 100', async () => {
      const people = [await person('Zed Quartz', 'zed@example.com'), await person('Amy Pond', 'amy.pond@example.com')];
      for (let i = 0; i < 7; i++) await sub(people[0]);
      for (let i = 0; i < 3; i++) await sub(people[1], { status: SubscriptionStatus.Expired });
      const seen: string[] = []; let cursor: string | null = null; let pages = 0;
      do {
        const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await get(`/admin/subscriptions?limit=4${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...r.body.items.map((i) => i.id)); cursor = r.body.nextCursor; pages++;
      } while (cursor);
      expect(pages).toBe(3); expect(new Set(seen).size).toBe(10);
      expect(seen).toEqual([...seen].sort((x, y) => Number(y) - Number(x))); // newest first
      expect((await get('/admin/subscriptions?status=EXPIRED&limit=100')).body.items).toHaveLength(3);
      expect((await get('/admin/subscriptions?planCode=monthly&limit=100')).body.items).toHaveLength(10);
      expect((await get('/admin/subscriptions?planCode=nope&limit=100')).body.items).toHaveLength(0);
      expect((await get('/admin/subscriptions?q=pond&limit=100')).body.items).toHaveLength(3);
      expect((await get('/admin/subscriptions?q=Zed&limit=100')).body.items).toHaveLength(7);
      expect((await get('/admin/subscriptions?q=%25&limit=100')).body.items).toHaveLength(0); // wildcard is escaped
      await get('/admin/subscriptions?limit=101').expect(400);
      await get('/admin/subscriptions?status=BOGUS&limit=5').expect(400);
      await get('/admin/subscriptions?cursor=garbage&limit=5').expect(400);
      // legacy callers (no limit/cursor) still get a bare array
      expect(Array.isArray((await get('/admin/subscriptions')).body)).toBe(true);
    });

    it('GET /admin/webhook-events: status + eventType filters, cursor pagination, no payloads, legacy array when unpaged', async () => {
      for (let i = 0; i < 9; i++) await repo(PaymentWebhookEvent).save({ provider: 'dev', providerEventId: `evt_${i}`, eventType: i % 3 === 0 ? 'payment.failed' : 'payment.captured', payloadHash: 'h'.repeat(64), payload: { secret: 'x' }, status: i % 2 ? WebhookStatus.Failed : WebhookStatus.Processed, attempts: 0, note: null, processedAt: null });
      const first = (await get('/admin/webhook-events?limit=4')).body;
      expect(first.items).toHaveLength(4); expect(first.nextCursor).toBeTruthy(); expect(first.items[0]).not.toHaveProperty('payload');
      const second = (await get(`/admin/webhook-events?limit=4&cursor=${first.nextCursor}`)).body;
      const third = (await get(`/admin/webhook-events?limit=4&cursor=${second.nextCursor}`)).body;
      expect([...first.items, ...second.items, ...third.items].map((e) => e.providerEventId)).toEqual(['evt_8', 'evt_7', 'evt_6', 'evt_5', 'evt_4', 'evt_3', 'evt_2', 'evt_1', 'evt_0']);
      expect(third.nextCursor).toBeNull();
      expect((await get('/admin/webhook-events?status=FAILED&limit=100')).body.items).toHaveLength(4);
      expect((await get('/admin/webhook-events?eventType=payment.failed&limit=100')).body.items).toHaveLength(3);
      expect((await get('/admin/webhook-events?eventType=payment.failed&status=FAILED&limit=100')).body.items.map((e: { providerEventId: string }) => e.providerEventId)).toEqual(['evt_3']);
      await get('/admin/webhook-events?limit=500').expect(400);
      const legacy = (await get('/admin/webhook-events')).body;
      expect(Array.isArray(legacy)).toBe(true); expect(legacy).toHaveLength(9); expect(legacy[0]).not.toHaveProperty('payload');
    });

    it('GET /admin/payments pages past the first page with users attached', async () => {
      const a = await person('Many Pay', 'many@example.com');
      for (let i = 0; i < 7; i++) await pay(a);
      const p1 = (await get('/admin/payments?limit=5')).body;
      expect(p1.items).toHaveLength(5); expect(p1.nextCursor).toBeTruthy();
      const p2 = (await get(`/admin/payments?limit=5&cursor=${p1.nextCursor}`)).body;
      expect(p2.items).toHaveLength(2); expect(p2.nextCursor).toBeNull();
      expect(p2.items.every((p: { user: { email: string } }) => p.user.email === 'many@example.com')).toBe(true);
    });
  });

  describe('audit log filters', () => {
    async function seedAudit() {
      const mk = (action: string, actorId: string | null, at: string) => repo(AuditLog).save({ actorType: 'ADMIN' as never, actorId, action, entityType: 'x', entityId: null, metadata: null, ipAddress: null, requestId: null, createdAt: new Date(at) });
      await dsOf(app).query('TRUNCATE TABLE audit_logs');
      await mk('a.one', '11', '2026-01-01T10:00:00Z'); await mk('a.two', '11', '2026-01-02T10:00:00Z'); await mk('a.three', '22', '2026-01-03T10:00:00Z');
      await mk('a.four', '22', '2026-01-04T23:59:59Z'); await mk('a.five', '11', '2026-01-05T00:00:00Z');
    }
    it('filters by from/to (inclusive; a bare date covers its whole day) and actorId, still cursor-paged', async () => {
      await seedAudit();
      const actions = async (q: string) => (await get(`/admin/audit-logs?${q}`)).body.items.map((i: { action: string }) => i.action).reverse();
      expect(await actions('from=2026-01-02T00:00:00Z&to=2026-01-03T23:00:00Z')).toEqual(['a.two', 'a.three']);
      expect(await actions('from=2026-01-04')).toEqual(['a.four', 'a.five']);
      expect(await actions('to=2026-01-04')).toEqual(['a.one', 'a.two', 'a.three', 'a.four']); // bare date: through 23:59:59.999
      expect(await actions('actorId=22')).toEqual(['a.three', 'a.four']);
      expect(await actions('actorId=11&from=2026-01-02&to=2026-01-04')).toEqual(['a.two']);
      const p1 = (await get('/admin/audit-logs?actorId=11&limit=2')).body;
      expect(p1.items).toHaveLength(2); expect(p1.nextCursor).toBeTruthy();
      const p2 = (await get(`/admin/audit-logs?actorId=11&limit=2&cursor=${p1.nextCursor}`)).body;
      expect(p2.items.map((i: { action: string }) => i.action)).toEqual(['a.one']);
    });
    it('rejects invalid dates, ranges and actor ids with 400', async () => {
      for (const q of ['from=yesterday', 'to=2026-13-45', 'actorId=abc', 'actorId=1;DROP', 'from=2026-02-01&to=2026-01-01']) await get(`/admin/audit-logs?${q}`).expect(400);
    });
  });

  describe('roles tab permission', () => {
    it('a custom role with only roles.manage can list roles and permissions; admins.manage alone can still list roles; others are refused', async () => {
      const perms = async (...codes: string[]) => repo(Permission).find({ where: codes.map((code) => ({ code })) });
      await repo(Role).save({ name: 'ROLES_ONLY', description: 'x', isSystem: false, permissions: await perms('roles.manage') });
      await repo(Role).save({ name: 'ADMINS_ONLY', description: 'x', isSystem: false, permissions: await perms('admins.manage') });
      await repo(Role).save({ name: 'USERS_ONLY', description: 'x', isSystem: false, permissions: await perms('users.read') });
      const login = async (role: string) => (await adminLogin(app, await createAdmin(app, { roles: [role] }))).accessToken;
      const rolesOnly = await login('ROLES_ONLY');
      const roles = await get('/admin/roles', rolesOnly).expect(200);
      expect(roles.body.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['SUPER_ADMIN', 'ROLES_ONLY']));
      await get('/admin/permissions', rolesOnly).expect(200);
      await get('/admin/admin-users', rolesOnly).expect(403); // roles.manage does not open the admin list
      await get('/admin/roles', await login('ADMINS_ONLY')).expect(200);
      await get('/admin/roles', await login('USERS_ONLY')).expect(403);
      await http(app).get(api('/admin/roles')).expect(401);
    });
  });
});
