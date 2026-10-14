import { Injectable } from '@nestjs/common';

export interface ErrorContext { requestId?: string | null; path?: string }

/** Where unexpected (5xx) errors are reported. A no-op unless SENTRY_DSN is set. Reporting must never throw or slow a request. */
export abstract class ErrorReporter {
  abstract capture(err: unknown, ctx: ErrorContext): void;
}

@Injectable()
export class NoopErrorReporter extends ErrorReporter { capture(): void { /* nothing configured */ } }
