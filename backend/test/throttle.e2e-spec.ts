import request from 'supertest';
import { createApp } from './helpers';

describe('rate limiting', () => {
  it('returns 429 RATE_LIMITED after the limit, but never throttles health probes', async () => {
    const app = await createApp({ THROTTLE_LIMIT: '3', THROTTLE_TTL_MS: '60000' });
    try {
      const http = () => request(app.getHttpServer());
      for (let i = 0; i < 3; i++) await http().get('/api/v1/echo/ping').expect(200);
      const limited = await http().get('/api/v1/echo/ping').expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      for (let i = 0; i < 8; i++) await http().get('/api/v1/health/live').expect(200);
    } finally { await app.close(); }
  });
});
