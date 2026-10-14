import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Authentication, secrets and external-provider settings. */
export const authConfig = registerAs('auth', () => {
  const env = validateEnv(process.env);
  return {
    secret: env.APP_SECRET as string,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    totpIssuer: env.TOTP_ISSUER,
    sms: { provider: env.SMS_PROVIDER as 'dev' | 'http' | 'none', url: env.SMS_HTTP_URL, authorization: env.SMS_HTTP_AUTHORIZATION },
    email: { provider: env.EMAIL_PROVIDER as 'dev' | 'http' | 'none', url: env.EMAIL_HTTP_URL, authorization: env.EMAIL_HTTP_AUTHORIZATION },
    devFixedOtp: env.DEV_FIXED_OTP || undefined,
    googleClientIds: list(env.GOOGLE_CLIENT_IDS),
    appleClientIds: list(env.APPLE_CLIENT_IDS),
    webAppUrl: env.WEB_APP_URL.replace(/\/+$/, ''),
    mediaPublicBaseUrl: env.MEDIA_PUBLIC_BASE_URL?.replace(/\/+$/, ''),
  };
});
