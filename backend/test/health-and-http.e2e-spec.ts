import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from './helpers';

describe('HTTP foundation (real MySQL + Redis)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app.close(); });
  const http = () => request(app.getHttpServer());

  describe('health', () => {
    it('GET /api/v1/health/live → 200', async () => {
      const res = await http().get('/api/v1/health/live').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /api/v1/health/ready → 200 with MySQL and Redis up', async () => {
      const res = await http().get('/api/v1/health/ready').expect(200);
      expect(res.body.info).toMatchObject({ database: { status: 'up' }, redis: { status: 'up' } });
    });
  });

  describe('request ids and error shape', () => {
    it('mints a request id and returns it in the header and the error body', async () => {
      const res = await http().get('/api/v1/does-not-exist').expect(404);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', requestId: res.headers['x-request-id'], path: '/api/v1/does-not-exist' });
    });

    it('echoes a safe incoming request id and replaces an unsafe one', async () => {
      const good = await http().get('/api/v1/health/live').set('x-request-id', 'trace-abc-12345');
      expect(good.headers['x-request-id']).toBe('trace-abc-12345');
      const bad = await http().get('/api/v1/health/live').set('x-request-id', 'not a valid id!!');
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('never leaks internals of an unexpected error response in production mode', async () => {
      const prod = await createApp({ NODE_ENV: 'production', DB_PASSWORD: process.env.DB_PASSWORD ?? 'x', CORS_ORIGINS: 'https://aivistro.example', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none', PAYMENT_GATEWAY: 'none', PUSH_PROVIDER: 'none', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' });
      try {
        const res = await request(prod.getHttpServer()).get('/api/v1/echo/boom').expect(500);
        expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        expect(JSON.stringify(res.body)).not.toMatch(/hunter2|stack|at .*\.ts/);
        await request(prod.getHttpServer()).get('/api/docs').expect(404); // Swagger is off in production by default
      } finally { await prod.close(); }
    });
  });

  describe('validation', () => {
    const valid = { email: 'a@b.co', name: 'Asha', rating: 4 };
    it('accepts a valid body', async () => {
      await http().post('/api/v1/echo').send(valid).expect(201);
    });
    it('rejects invalid fields with VALIDATION_FAILED and a list of problems', async () => {
      const res = await http().post('/api/v1/echo').send({ ...valid, email: 'nope', rating: 9 }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details).toEqual(expect.arrayContaining([expect.stringContaining('email'), expect.stringContaining('rating')]));
    });
    it('rejects unexpected properties instead of ignoring them (e.g. a client-supplied role)', async () => {
      const res = await http().post('/api/v1/echo').send({ ...valid, role: 'ADMIN' }).expect(400);
      expect(res.body.details).toEqual(expect.arrayContaining([expect.stringContaining('role')]));
    });
    it('rejects type confusion (no implicit conversion of "4" to a number)', async () => {
      await http().post('/api/v1/echo').send({ ...valid, rating: '4' }).expect(400);
    });
  });

  describe('security headers and CORS', () => {
    it('sets Helmet headers and hides X-Powered-By', async () => {
      const res = await http().get('/api/v1/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
    it('allows a configured origin', async () => {
      const res = await http().options('/api/v1/health/live').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
    it('does not grant CORS to an unknown origin', async () => {
      const res = await http().get('/api/v1/health/live').set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('swagger', () => {
    it('serves the OpenAPI document in non-production', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      expect(res.body.info.title).toBe('AIVISTRO API');
      expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/api/v1/health/live', '/api/v1/health/ready']));
    });
  });
});
