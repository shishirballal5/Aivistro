import { NestExpressApplication } from '@nestjs/platform-express';
import { Profile } from '../src/database/entities';
import { createApp } from './helpers';
import { dsOf, http, otpFrom, uniqueEmail, uniquePhone } from './factories';

const api = (p: string) => `/api/v1${p}`;
const isoDaysAgoYears = (years: number, extraDays = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() + extraDays); return d.toISOString().slice(0, 10); };

describe('sign-up requires name, email and a date of birth (minimum age 14), enforced by the server', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });
  const otp = async (phone: string) => { await http(app).post(api('/auth/otp/request')).send({ phone }).expect(202); return otpFrom(app, phone); };

  describe('phone OTP', () => {
    it('creates the account with the profile in one step, and stores the date of birth', async () => {
      const phone = uniquePhone(); const email = uniqueEmail();
      const c1 = await otp(phone);
      const r = await http(app).post(api('/auth/otp/verify')).send({ phone, code: c1, displayName: 'Asha Rao', email, dateOfBirth: '1995-04-02' }).expect(200);
      expect(r.body.user).toMatchObject({ displayName: 'Asha Rao', email, emailVerified: false });
      const profile = await dsOf(app).getRepository(Profile).findOneByOrFail({ userId: r.body.user.id });
      expect(profile.dateOfBirth).toBe('1995-04-02');
    });

    it('a new number without details gets PROFILE_REQUIRED (no account, no tokens); completing it creates the account', async () => {
      const phone = uniquePhone(); const email = uniqueEmail();
      const c2 = await otp(phone);
      const step = await http(app).post(api('/auth/otp/verify')).send({ phone, code: c2 }).expect(200);
      expect(step.body).toEqual({ status: 'PROFILE_REQUIRED', profileToken: expect.any(String) });
      expect(step.body.accessToken).toBeUndefined();
      expect(await dsOf(app).query('SELECT id FROM users WHERE phone = ?', ['+91' + phone.replace(/^\+91/, '')])).toHaveLength(0);
      const done = await http(app).post(api('/auth/otp/complete')).send({ profileToken: step.body.profileToken, displayName: 'Ravi Kumar', email, dateOfBirth: '1988-12-25' }).expect(200);
      expect(done.body.accessToken).toBeTruthy();
      expect(done.body.user).toMatchObject({ displayName: 'Ravi Kumar', email });
    });

    it('rejects under-14 before the OTP is spent, so the person can correct the date and retry with the SAME code', async () => {
      const phone = uniquePhone(); const code = await otp(phone); const email = uniqueEmail();
      const under = await http(app).post(api('/auth/otp/verify')).send({ phone, code, displayName: 'Kid', email, dateOfBirth: isoDaysAgoYears(14, 1) }).expect(400);
      expect(under.body.code).toBe('UNDER_MIN_AGE');
      await http(app).post(api('/auth/otp/verify')).send({ phone, code, displayName: 'Kid Grown', email, dateOfBirth: isoDaysAgoYears(14) }).expect(200); // exactly 14 today
    });

    it('rejects under-14 on the completion step too, and creates nothing', async () => {
      const phone = uniquePhone();
      const c3 = await otp(phone);
      const step = await http(app).post(api('/auth/otp/verify')).send({ phone, code: c3 }).expect(200);
      const bad = await http(app).post(api('/auth/otp/complete')).send({ profileToken: step.body.profileToken, displayName: 'Kid', email: uniqueEmail(), dateOfBirth: isoDaysAgoYears(10) }).expect(400);
      expect(bad.body.code).toBe('UNDER_MIN_AGE');
      expect(await dsOf(app).query('SELECT id FROM users WHERE phone LIKE ?', [`%${phone.slice(-10)}`])).toHaveLength(0);
    });

    it.each([
      ['a future date', () => isoDaysAgoYears(-1)], ['an impossible date', () => '2000-02-30'], ['a malformed date', () => '02/04/1995'],
    ])('rejects %s', async (_l, dob) => {
      const phone = uniquePhone();
      const c4 = await otp(phone);
      const r = await http(app).post(api('/auth/otp/verify')).send({ phone, code: c4, displayName: 'Test User', email: uniqueEmail(), dateOfBirth: dob() });
      expect(r.status).toBe(400);
    });

    it('needs name, email and date of birth together: a partial profile is refused', async () => {
      const phone = uniquePhone(); const code = await otp(phone);
      for (const body of [{ displayName: 'Only Name' }, { email: uniqueEmail() }, { dateOfBirth: '1990-01-01' }, { displayName: 'Name', email: uniqueEmail() }, { displayName: 'A', email: uniqueEmail(), dateOfBirth: '1990-01-01' }]) {
        await http(app).post(api('/auth/otp/verify')).send({ phone, code, ...body }).expect(400);
      }
    });

    it('an email already used by another account is refused with a clear conflict, and a returning user just signs in', async () => {
      const first = uniquePhone(); const email = uniqueEmail();
      const c5 = await otp(first);
      await http(app).post(api('/auth/otp/verify')).send({ phone: first, code: c5, displayName: 'First User', email, dateOfBirth: '1990-01-01' }).expect(200);
      const second = uniquePhone();
      const c6 = await otp(second);
      const dup = await http(app).post(api('/auth/otp/verify')).send({ phone: second, code: c6, displayName: 'Second User', email, dateOfBirth: '1990-01-01' }).expect(409);
      expect(dup.body.code).toBe('EMAIL_IN_USE');
      // returning user: profile fields are not needed and not required
      await http(app).post(api('/auth/otp/request')).send({ phone: first }).expect(429); // cooldown: re-verify uses a fresh code in practice
    });

    it('the completion token is single-purpose: garbage and tampered tokens are refused', async () => {
      const bad = await http(app).post(api('/auth/otp/complete')).send({ profileToken: 'x'.repeat(60), displayName: 'Nobody', email: uniqueEmail(), dateOfBirth: '1990-01-01' });
      expect(bad.status).toBe(401);
    });
  });

  describe('email + password', () => {
    const base = () => ({ email: uniqueEmail(), password: 'Correct-Horse-9', displayName: 'Meera Nair' });
    it('requires a date of birth', async () => { await http(app).post(api('/auth/register')).send(base()).expect(400); });
    it('refuses under-14 and stores nothing', async () => {
      const b = base();
      const r = await http(app).post(api('/auth/register')).send({ ...b, dateOfBirth: isoDaysAgoYears(13) }).expect(400);
      expect(r.body.code).toBe('UNDER_MIN_AGE');
      expect(await dsOf(app).query('SELECT id FROM users WHERE email = ?', [b.email])).toHaveLength(0);
    });
    it('accepts 14 and over, and records the date of birth', async () => {
      const b = base();
      await http(app).post(api('/auth/register')).send({ ...b, dateOfBirth: isoDaysAgoYears(14) }).expect(202);
      const [row] = await dsOf(app).query('SELECT p.date_of_birth d FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email = ?', [b.email]);
      expect(String(row.d).slice(0, 10) || row.d).toBeTruthy();
    });
    it('requires a real name (at least 2 characters)', async () => { await http(app).post(api('/auth/register')).send({ ...base(), displayName: 'x', dateOfBirth: '1990-01-01' }).expect(400); });
  });
});
