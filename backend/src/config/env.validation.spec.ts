import { NodeEnv, validateEnv } from './env.validation';

const SECRET = { APP_SECRET: 'x'.repeat(40) };

describe('validateEnv', () => {
  it('applies safe development defaults', () => {
    const env = validateEnv({ ...SECRET });
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(3306);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.SWAGGER_ENABLED).toBe(true); // on outside production
  });

  it('converts numeric and boolean strings from the environment', () => {
    const env = validateEnv({ ...SECRET, PORT: '4100', DB_SSL: 'true', DB_LOGGING: 'false', REDIS_TLS: '1' });
    expect(env.PORT).toBe(4100);
    expect(env.DB_SSL).toBe(true);
    expect(env.DB_LOGGING).toBe(false);
    expect(env.REDIS_TLS).toBe(true);
  });

  it('rejects malformed values with a readable message', () => {
    expect(() => validateEnv({ ...SECRET, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...SECRET, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...SECRET, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ ...SECRET, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  describe('production', () => {
    const prod = { ...SECRET, NODE_ENV: 'production', DB_PASSWORD: 's3cret', CORS_ORIGINS: 'https://aivistro.example', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none', PAYMENT_GATEWAY: 'none', PUSH_PROVIDER: 'none', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };

    it('accepts a complete production config and turns Swagger off by default', () => {
      const env = validateEnv(prod);
      expect(env.SWAGGER_ENABLED).toBe(false);
    });

    it('requires APP_SECRET everywhere, and rejects a placeholder or a dev SMS/email provider in production', () => {
      expect(() => validateEnv({})).toThrow(/APP_SECRET/);
      expect(() => validateEnv({ ...prod, APP_SECRET: 'change-me-change-me-change-me-change-me' })).toThrow(/placeholder/);
      expect(() => validateEnv({ ...prod, SMS_PROVIDER: 'dev' })).toThrow(/SMS_PROVIDER/);
      expect(() => validateEnv({ ...prod, EMAIL_PROVIDER: 'dev' })).toThrow(/EMAIL_PROVIDER/);
    });

    it('requires a database password', () => {
      expect(() => validateEnv({ ...prod, DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
    });

    it('refuses a wildcard CORS origin', () => {
      expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'https://a.example, *' })).toThrow(/CORS_ORIGINS/);
    });

    it('lets Swagger be switched on explicitly', () => {
      expect(validateEnv({ ...prod, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    });
  });
});

describe('assertValidEnv', () => {
  const { assertValidEnv } = jest.requireActual('./env.validation');
  it('validates but returns the input untouched (no defaults written back)', () => {
    const raw = { ...SECRET, NODE_ENV: 'production', DB_PASSWORD: 'x', CORS_ORIGINS: 'https://a.example', SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none', PAYMENT_GATEWAY: 'none', PUSH_PROVIDER: 'none', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    expect(assertValidEnv(raw)).toBe(raw);
    expect(raw).not.toHaveProperty('SWAGGER_ENABLED');
  });
  it('throws on invalid input', () => {
    expect(() => assertValidEnv({ ...SECRET, PORT: 'x' })).toThrow(/PORT/);
  });
});
