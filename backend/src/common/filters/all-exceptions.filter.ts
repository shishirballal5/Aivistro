import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';
import { appConfig } from '../../config/app.config';
import { ErrorReporter } from '../../modules/monitoring/error-reporter';
import { ErrorCode } from '../constants/error-codes';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
  path: string;
  stack?: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: ErrorCode.BadRequest,
  401: ErrorCode.Unauthorized,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  409: ErrorCode.Conflict,
  429: ErrorCode.RateLimited,
  503: ErrorCode.ServiceUnavailable,
};

/**
 * One consistent error shape for the whole API. Unknown errors become a generic 500;
 * internals (SQL, stack traces) are logged but never returned in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: Logger,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    private readonly reporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ id?: string; url: string }>();
    const response = ctx.getResponse();

    const body = this.toBody(exception, request);
    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId: request.id, path: request.url }, 'Unhandled error');
      this.reporter.capture(exception, { requestId: request.id, path: request.url });
    }
    httpAdapter.reply(response, body, body.statusCode);
  }

  /**
   * Health probes (Terminus) report per-dependency status. Keep that so operators can see which
   * dependency is down, but drop the free-text error messages in production (they can name hosts).
   */
  private healthDetails(res: unknown): unknown {
    const details = typeof res === 'object' && res !== null ? (res as { details?: Record<string, { status?: string }> | string[] }).details : undefined;
    if (!details || typeof details !== 'object') return undefined;
    if (Array.isArray(details) || !this.app.isProduction) return details;
    return Object.fromEntries(Object.entries(details).map(([name, v]) => [name, { status: (v as { status?: string })?.status }]));
  }

  private toBody(exception: unknown, request: { id?: string; url: string }): ErrorResponseBody {
    const base = { requestId: request.id, timestamp: new Date().toISOString(), path: request.url };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      const explicitCode = typeof res === 'object' ? (res as { code?: string }).code : undefined;
      if (Array.isArray(message)) {
        return { statusCode: status, code: ErrorCode.ValidationFailed, message: 'Request validation failed', details: message, ...base };
      }
      const details = this.healthDetails(res);
      return { statusCode: status, code: explicitCode ?? CODE_BY_STATUS[status] ?? `HTTP_${status}`, message, ...(details ? { details } : {}), ...base };
    }

    if (exception instanceof QueryFailedError) {
      const driverCode = (exception as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
      if (driverCode === 'ER_DUP_ENTRY') {
        return { statusCode: HttpStatus.CONFLICT, code: ErrorCode.Conflict, message: 'A record with these details already exists', ...base };
      }
    }

    const body: ErrorResponseBody = { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: ErrorCode.Internal, message: 'Internal server error', ...base };
    if (!this.app.isProduction && exception instanceof Error) body.stack = exception.stack;
    return body;
  }
}
