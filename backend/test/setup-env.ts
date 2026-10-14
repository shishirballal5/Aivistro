import 'reflect-metadata';
import { config } from 'dotenv';

config({ path: '.env.test' }); // optional; real environment variables win

process.env.NODE_ENV = 'test';
process.env.APP_SECRET ??= 'test-app-secret-0123456789abcdef0123456789abcdef';
process.env.AUTH_RATE_LIMIT_SCALE ??= '1000';
process.env.THROTTLE_LIMIT ??= '100000';
process.env.GOOGLE_CLIENT_IDS ??= '';
process.env.APPLE_CLIENT_IDS ??= '';
process.env.DB_NAME = process.env.TEST_DB_NAME ?? process.env.DB_NAME ?? 'aivistro_test';

// Safety net: these tests insert and delete rows. Never point them at a development or production database.
if (!/_test$/.test(process.env.DB_NAME)) {
  throw new Error(`Refusing to run e2e tests against database "${process.env.DB_NAME}". Use a database whose name ends in "_test".`);
}
