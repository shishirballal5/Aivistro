import { DomainCode } from './constants/error-codes';
import { badRequest } from './errors';

export interface Page<T> { items: T[]; nextCursor: string | null }

export const clampLimit = (limit: number | undefined, def = 20, max = 50): number => Math.min(Math.max(limit ?? def, 1), max);

/** Opaque cursors: clients cannot (and must not) build them. Anything malformed is a 400, never a silent restart. */
export const encodeCursor = (data: Record<string, string | number>): string => Buffer.from(JSON.stringify(data)).toString('base64url');
export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined, keys: (keyof T)[]): T | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
    if (!keys.every((k) => parsed[k] !== undefined && ['string', 'number'].includes(typeof parsed[k]))) throw new Error('shape');
    return parsed;
  } catch {
    throw badRequest(DomainCode.InvalidCursor, 'Invalid cursor');
  }
}
