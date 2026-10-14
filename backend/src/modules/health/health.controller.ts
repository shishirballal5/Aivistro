import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness: the process is up and serving. Used by the container orchestrator to decide on restarts. */
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe (no dependencies checked)' })
  live() {
    return this.health.check([]);
  }

  /** Readiness: MySQL and Redis are reachable. Used by load balancers to decide whether to route traffic. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (MySQL and Redis)' })
  ready() {
    return this.health.check([() => this.db.pingCheck('database', { timeout: 3000 }), () => this.redis.isHealthy('redis')]);
  }
}
