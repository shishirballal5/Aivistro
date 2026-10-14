import { ArgumentsHost, BadRequestException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter, ErrorResponseBody } from './all-exceptions.filter';

function run(exception: unknown, isProduction: boolean) {
  const reply = jest.fn();
  const logger = { error: jest.fn() };
  const reporter = { capture: jest.fn() };
  const filter = new AllExceptionsFilter({ httpAdapter: { reply } } as unknown as HttpAdapterHost, logger as never, { isProduction } as never, reporter as never);
  const host = { switchToHttp: () => ({ getRequest: () => ({ id: 'req-1', url: '/api/v1/x' }), getResponse: () => ({}) }) } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  const [, body, status] = reply.mock.calls[0] as [unknown, ErrorResponseBody, number];
  return { body, status, logger, reporter };
}

describe('AllExceptionsFilter', () => {
  it('maps HttpExceptions to the common shape with a stable code and the request id', () => {
    const { body, status } = run(new NotFoundException('Series not found'), true);
    expect(status).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Series not found', requestId: 'req-1', path: '/api/v1/x' });
    expect(typeof body.timestamp).toBe('string');
  });

  it('keeps an explicit domain code (used later for SUBSCRIPTION_REQUIRED etc.)', () => {
    const { body, status } = run(new ForbiddenException({ code: 'SUBSCRIPTION_REQUIRED', message: 'Subscribe to watch' }), true);
    expect(status).toBe(403);
    expect(body.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(body.message).toBe('Subscribe to watch');
  });

  it('reports validation failures as VALIDATION_FAILED with the list of problems', () => {
    const { body, status } = run(new BadRequestException(['email must be an email', 'phone must be a string']), true);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual(['email must be an email', 'phone must be a string']);
  });

  it('turns a duplicate-key database error into 409 without exposing SQL', () => {
    const err = new QueryFailedError('INSERT INTO users ...', [], Object.assign(new Error("Duplicate entry 'a@b.c'"), { code: 'ER_DUP_ENTRY' }));
    const { body, status } = run(err, true);
    expect(status).toBe(409);
    expect(body.code).toBe('CONFLICT');
    expect(JSON.stringify(body)).not.toMatch(/INSERT|a@b\.c/);
  });

  it('hides internals of unexpected errors in production and logs them instead', () => {
    const { body, status, logger } = run(new Error('connection string mysql://root:hunter2@db'), true);
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(body.stack).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('reports unexpected 5xx errors to the error reporter with the request id, and never reports expected 4xx errors', () => {
    const boom = run(new Error('db exploded'), true);
    expect(boom.reporter.capture).toHaveBeenCalledWith(expect.any(Error), { requestId: 'req-1', path: '/api/v1/x' });
    expect(run(new NotFoundException(), true).reporter.capture).not.toHaveBeenCalled();
    expect(run(new ForbiddenException(), true).reporter.capture).not.toHaveBeenCalled();
  });

  it('includes the stack trace outside production to help development', () => {
    expect(run(new Error('boom'), false).body.stack).toContain('boom');
  });

  it('does not log expected 4xx errors as errors', () => {
    expect(run(new NotFoundException(), false).logger.error).not.toHaveBeenCalled();
  });

  describe('health-probe details', () => {
    const unhealthy = () => new ServiceUnavailableException({ status: 'error', details: { database: { status: 'up' }, redis: { status: 'down', message: 'connect ECONNREFUSED 10.0.0.5:6379' } } });

    it('shows which dependency is down, with messages, outside production', () => {
      const { body, status } = run(unhealthy(), false);
      expect(status).toBe(503);
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.details).toMatchObject({ redis: { status: 'down', message: expect.stringContaining('ECONNREFUSED') } });
    });

    it('keeps only the status per dependency in production (no internal hosts)', () => {
      const { body } = run(unhealthy(), true);
      expect(body.details).toEqual({ database: { status: 'up' }, redis: { status: 'down' } });
      expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    });
  });

  it('handles non-Error throwables', () => {
    expect(run('a string', true).status).toBe(500);
    expect(run(new HttpException('teapot', 418), true).body.code).toBe('HTTP_418');
  });
});
