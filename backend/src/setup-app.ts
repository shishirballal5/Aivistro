import { ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from './common/constants/error-codes';
import { appConfig } from './config/app.config';

export const API_PREFIX = 'api/v1';

/**
 * Everything the HTTP app needs beyond its modules. Shared by main.ts and the e2e tests so the
 * tests exercise the same pipes, headers and CORS rules as production.
 */
export function setupApp(app: NestExpressApplication, cfg: ConfigType<typeof appConfig>): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  if (cfg.trustProxyHops > 0) app.set('trust proxy', cfg.trustProxyHops);
  app.disable('x-powered-by');

  app.use(helmet());
  // Anything fetched with credentials is personal: shared caches and the browser must not keep it.
  // Handlers that set their own Cache-Control (public catalog pages) are unaffected: theirs is applied later and wins.
  app.use((req: { headers: Record<string, unknown> }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    if (req.headers.authorization) res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'Content-Range', 'Accept-Ranges', 'Content-Length'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // ...and reject the request instead of silently ignoring them
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (cfg.swaggerEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AIVISTRO API')
        .setDescription('Short-drama streaming platform backend')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
}

