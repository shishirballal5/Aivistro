import { HttpException, HttpStatus } from '@nestjs/common';

/** An HttpException that carries a stable domain `code` (see all-exceptions.filter). */
export class DomainException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra?: Record<string, unknown>) {
    super({ code, message, ...extra }, status);
  }
}
export const unauthorized = (code: string, message: string) => new DomainException(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (code: string, message: string) => new DomainException(HttpStatus.FORBIDDEN, code, message);
export const badRequest = (code: string, message: string, extra?: Record<string, unknown>) => new DomainException(HttpStatus.BAD_REQUEST, code, message, extra);
export const conflict = (code: string, message: string) => new DomainException(HttpStatus.CONFLICT, code, message);
export const unavailable = (code: string, message: string) => new DomainException(HttpStatus.SERVICE_UNAVAILABLE, code, message);
