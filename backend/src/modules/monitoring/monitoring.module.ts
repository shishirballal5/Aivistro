import { getQueueToken } from '@nestjs/bullmq';
import { CallHandler, Controller, ExecutionContext, Get, Global, Header, Headers, Inject, Injectable, Module, NestInterceptor, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { safeEqual } from '../../common/crypto/crypto.util';
import { appConfig } from '../../config/app.config';
import { QUEUES } from '../queues/queue.constants';
import { QueueModule } from '../queues/queue.module';
import { ErrorReporter, NoopErrorReporter } from './error-reporter';
import { SentryErrorReporter } from '../../util/thirdparty/sentry/sentry.reporter';
import { MetricsService } from './metrics.service';

@Injectable()
export class QueueRegistry {
  constructor(
    @Inject(getQueueToken(QUEUES.System)) private readonly a: Queue, @Inject(getQueueToken(QUEUES.Catalog)) private readonly b: Queue, @Inject(getQueueToken(QUEUES.Payments)) private readonly c: Queue,
    @Inject(getQueueToken(QUEUES.VideoProcessing)) private readonly d: Queue, @Inject(getQueueToken(QUEUES.Engagement)) private readonly e: Queue,
  ) {}
  async counts(): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const q of [this.a, this.b, this.c, this.d, this.e]) out[q.name] = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed').catch(() => ({}));
    return out;
  }
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();
    res.once('finish', () => this.metrics.record(req.method, (req.route?.path as string | undefined) ?? 'unmatched', res.statusCode, Number(process.hrtime.bigint() - start) / 1e9));
    return next.handle();
  }
}

@ApiExcludeController()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService, @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>, private readonly moduleQueues: QueueRegistry) {}

  /** Prometheus scrape target. Does not exist unless METRICS_TOKEN is set; then it needs `Authorization: Bearer <token>`. */
  @Get() @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8') @Header('Cache-Control', 'no-store')
  async scrape(@Headers('authorization') auth?: string) {
    if (!this.cfg.metricsToken) throw new NotFoundException();
    const presented = /^Bearer (.+)$/.exec(auth ?? '')?.[1] ?? '';
    if (!safeEqual(presented, this.cfg.metricsToken)) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid metrics token' });
    return this.metrics.render(await this.moduleQueues.counts());
  }
}

@Global()
@Module({
  imports: [QueueModule],
  controllers: [MetricsController],
  providers: [
    MetricsService, QueueRegistry, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: ErrorReporter, inject: [appConfig.KEY], useFactory: (c: ConfigType<typeof appConfig>): ErrorReporter => (c.sentryDsn ? new SentryErrorReporter(c) : new NoopErrorReporter()) },
  ],
  exports: [ErrorReporter, MetricsService],
})
export class MonitoringModule {}
