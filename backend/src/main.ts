import 'reflect-metadata';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true }) // rawBody: webhook signatures are computed over the exact bytes received;
  const cfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  setupApp(app, cfg);
  app.enableShutdownHooks(); // SIGTERM/SIGINT: stop accepting requests, close MySQL, Redis and BullMQ cleanly
  await app.listen(cfg.port, '0.0.0.0');
  app.get(Logger).log(`API listening on :${cfg.port} (${cfg.nodeEnv})${cfg.swaggerEnabled ? ', docs at /api/docs' : ''}`);
}

bootstrap().catch((err) => {
  // Config/DB/Redis problems at boot: fail loudly with a non-zero exit so the orchestrator restarts or alerts.
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
