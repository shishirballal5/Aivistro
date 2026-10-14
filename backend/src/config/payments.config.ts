import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

export const paymentsConfig = registerAs('payments', () => {
  const env = validateEnv(process.env);
  return {
    gateway: env.PAYMENT_GATEWAY as 'razorpay' | 'dev' | 'none',
    razorpay: { keyId: env.RAZORPAY_KEY_ID ?? '', keySecret: env.RAZORPAY_KEY_SECRET ?? '', webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '' },
    isProduction: env.NODE_ENV === 'production',
  };
});
