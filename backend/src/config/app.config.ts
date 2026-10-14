import { registerAs } from '@nestjs/config';
import { NodeEnv, validateEnv } from './env.validation';

export const appConfig = registerAs('app', () => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === NodeEnv.Production,
    isTest: env.NODE_ENV === NodeEnv.Test,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    trustProxyHops: env.TRUST_PROXY_HOPS,
    swaggerEnabled: env.SWAGGER_ENABLED === true,
    throttle: { ttlMs: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
    sentryDsn: env.SENTRY_DSN || undefined,
    metricsToken: env.METRICS_TOKEN || undefined,
  };
});
