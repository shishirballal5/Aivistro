import { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './helpers';
import { http } from './factories';

describe('public config + dev outbox', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });
  const api = (p: string) => `/api/v1${p}`;

  it('reports enabled methods and never contains secrets', async () => {
    const r = await http(app).get(api('/config')).expect(200);
    expect(r.body.auth).toMatchObject({ phoneOtp: true, emailPassword: true, google: null, apple: null });
    expect(r.body.payments.gateway).toBe('dev');
    expect(r.body.development).toEqual({ devMessages: true, devPayments: true });
    expect(JSON.stringify(r.body)).not.toMatch(/secret|webhook|rzp_|APP_SECRET/i);
  });

  it('shows the captured OTP in development, and nothing for an unknown recipient', async () => {
    const ten = `98${String(Date.now()).slice(-8)}`; // fresh number per run: OTP requests have a cooldown
    await http(app).post(api('/auth/otp/request')).send({ phone: ten }).expect(202);
    const m = (await http(app).get(api('/dev/outbox')).query({ to: `+91${ten}` }).expect(200)).body.message;
    expect(m.kind).toBe('sms');
    expect(m.body).toMatch(/\d{6}/);
    expect((await http(app).get(api('/dev/outbox')).query({ to: '+919000000000' }).expect(200)).body.message).toBeNull();
  });

  it('does not exist in production, and reports real providers as such', async () => {
    const prod = await createApp({ NODE_ENV: 'production', DB_PASSWORD: process.env.DB_PASSWORD ?? 'x', CORS_ORIGINS: 'https://a.example', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none', PAYMENT_GATEWAY: 'none', PUSH_PROVIDER: 'none', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' });
    try {
      await http(prod).get(api('/dev/outbox')).query({ to: '+919876500011' }).expect(404);
      const c = (await http(prod).get(api('/config')).expect(200)).body;
      expect(c.auth.phoneOtp).toBe(false);
      expect(c.development).toEqual({ devMessages: false, devPayments: false });
    } finally { await prod.close(); }
  });
});

describe('DEV_FIXED_OTP (development convenience, guarded)', () => {
  const api = (p: string) => `/api/v1${p}`;

  it('makes the OTP the configured code, and a wrong code still fails', async () => {
    const app = await createApp({ DEV_FIXED_OTP: '123456' });
    try {
      const ten = `97${String(Date.now()).slice(-8)}`;
      await http(app).post(api('/auth/otp/request')).send({ phone: ten }).expect(202);
      await http(app).post(api('/auth/otp/verify')).send({ phone: ten, code: '654321' }).expect(400);
      const ok = await http(app).post(api('/auth/otp/verify')).send({ phone: ten, code: '123456', displayName: 'Dev Tester', email: `dev${ten}@example.com`, dateOfBirth: '1990-01-01' }).expect(200);
      expect(ok.body.accessToken).toBeTruthy();
    } finally { await app.close(); }
  });

  it('is refused in production and with a real SMS provider (a known code there would be an account takeover)', async () => {
    const prod = { NODE_ENV: 'production', DB_PASSWORD: process.env.DB_PASSWORD ?? 'x', CORS_ORIGINS: 'https://a.example', EMAIL_PROVIDER: 'none', PAYMENT_GATEWAY: 'none', PUSH_PROVIDER: 'none', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    await expect(createApp({ ...prod, SMS_PROVIDER: 'none', DEV_FIXED_OTP: '123456' })).rejects.toThrow(/DEV_FIXED_OTP/);
    await expect(createApp({ SMS_PROVIDER: 'http', SMS_HTTP_URL: 'https://sms.example/send', DEV_FIXED_OTP: '123456' })).rejects.toThrow(/DEV_FIXED_OTP requires SMS_PROVIDER=dev/);
    await expect(createApp({ DEV_FIXED_OTP: '12' })).rejects.toThrow(/6 digits/);
  });
});
