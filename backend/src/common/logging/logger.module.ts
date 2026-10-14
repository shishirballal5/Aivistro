import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigType } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { appConfig } from '../../config/app.config';
import { REQUEST_ID_HEADER } from '../constants/error-codes';

/** Playback and upload tokens live in URL paths. They are credentials, so they never reach the logs. */
export const redactUrl = (url: string): string => url.replace(/\/media\/hls\/[^/?#]+/g, '/media/hls/[redacted]').replace(/\/storage\/local\/[^/?#]+/g, '/storage/local/[redacted]');

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Accept a caller-supplied correlation id only if it is a safe, bounded token; otherwise mint one. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
}

/** Structured JSON logs with a per-request correlation id. Secrets are redacted. */
export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [appConfig.KEY],
  useFactory: (app: ConfigType<typeof appConfig>) => ({
    pinoHttp: {
      level: app.isTest ? 'silent' : app.logLevel,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customProps: () => ({ service: 'aivistro-api' }),
      autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').includes('/health/') },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
      },
      transport: app.isProduction || app.isTest ? undefined : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
    },
  }),
});
