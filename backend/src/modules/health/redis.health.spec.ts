import { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

const indicators = {
  check: (key: string) => ({ up: () => ({ [key]: { status: 'up' } }), down: (d: object) => ({ [key]: { status: 'down', ...d } }) }),
} as unknown as HealthIndicatorService;

describe('RedisHealthIndicator', () => {
  it('is up when Redis answers PONG', async () => {
    const r = await new RedisHealthIndicator({ ping: jest.fn().mockResolvedValue('PONG') } as never, indicators).isHealthy('redis');
    expect(r).toEqual({ redis: { status: 'up' } });
  });
  it('is down when Redis errors', async () => {
    const r = await new RedisHealthIndicator({ ping: jest.fn().mockRejectedValue(new Error('offline')) } as never, indicators).isHealthy('redis');
    expect(r).toEqual({ redis: { status: 'down', message: 'offline' } });
  });
  it('is down on an unexpected reply', async () => {
    const r = await new RedisHealthIndicator({ ping: jest.fn().mockResolvedValue('WAT') } as never, indicators).isHealthy('redis');
    expect(r.redis.status).toBe('down');
  });
});
