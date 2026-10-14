import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { appConfig } from '../../../config/app.config';
import { ErrorContext, ErrorReporter } from '../../../modules/monitoring/error-reporter';

/** Sentry adapter for the ErrorReporter contract. Needs `npm i @sentry/node`; a no-op warning otherwise. */
@Injectable()
export class SentryErrorReporter extends ErrorReporter {
  private readonly log = new Logger(SentryErrorReporter.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sentry: any;
  constructor(@Inject(appConfig.KEY) cfg: ConfigType<typeof appConfig>) {
    super();
    try {
      // Loaded lazily so the package is only required when you actually use it: `npm i @sentry/node`.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.sentry = require('@sentry/node');
      this.sentry.init({ dsn: cfg.sentryDsn, environment: cfg.nodeEnv, sendDefaultPii: false });
    } catch {
      this.log.warn('SENTRY_DSN is set but @sentry/node is not installed (npm i @sentry/node). Errors will NOT be reported.');
    }
  }
  capture(err: unknown, ctx: ErrorContext): void {
    try {
      this.sentry?.withScope((scope: { setTag(k: string, v: string): void }) => { if (ctx.requestId) scope.setTag('request_id', ctx.requestId); if (ctx.path) scope.setTag('path', ctx.path.split('?')[0]); this.sentry.captureException(err); });
    } catch { /* never let reporting break the request */ }
  }
}
