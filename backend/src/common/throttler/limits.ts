import { Throttle } from '@nestjs/throttler';

/**
 * Per-route rate limit: `base` requests per minute per client.
 * AUTH_RATE_LIMIT_SCALE (default 1) multiplies every base limit. It exists so load/e2e tests can relax limits;
 * leave it unset in production.
 */
export const perMinute = (base: number) => Throttle({ default: { limit: () => Math.max(1, Math.round(base * Number(process.env.AUTH_RATE_LIMIT_SCALE || 1))), ttl: 60_000 } });
