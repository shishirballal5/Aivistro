import request from 'supertest';
import { startServer, waitForPort, withTimeout } from './helpers';

/**
 * These start the REAL server process (src/main.ts) the way a container would,
 * so they cover boot, readiness and shutdown behaviour with a dead dependency.
 */
describe('when a dependency is down', () => {
  it('Redis down: readiness is 503 and names Redis, liveness stays 200, and SIGTERM still shuts down cleanly', async () => {
    const srv = await startServer({ REDIS_PORT: '1' });
    try {
      await waitForPort(srv.port);
      const base = `http://127.0.0.1:${srv.port}`;
      const ready = await request(base).get('/api/v1/health/ready').expect(503);
      expect(ready.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(ready.body.details).toMatchObject({ database: { status: 'up' }, redis: { status: 'down' } });
      await request(base).get('/api/v1/health/live').expect(200);

      srv.child.kill('SIGTERM');
      // Nest's shutdown hooks close MySQL/Redis/BullMQ and then re-raise the signal, so a clean stop shows up as
      // "ended by SIGTERM" (not SIGKILL, which is only our backstop in `finally`).
      const { code, signal } = await withTimeout(srv.exited, 10_000, 'graceful shutdown with Redis down');
      expect(code === 0 || signal === 'SIGTERM').toBe(true);
    } finally { srv.child.kill('SIGKILL'); }
  });

  it('MySQL down: the server refuses to start (exit code 1) so the orchestrator restarts or alerts', async () => {
    const srv = await startServer({ DB_PORT: '1', DB_CONNECT_RETRIES: '1', DB_CONNECT_RETRY_DELAY_MS: '50' });
    try {
      const { code } = await withTimeout(srv.exited, 25_000, 'startup failure');
      expect(code).toBe(1);
      expect(srv.stderr()).toMatch(/ECONNREFUSED|connect/i);
    } finally { srv.child.kill('SIGKILL'); }
  });
});
