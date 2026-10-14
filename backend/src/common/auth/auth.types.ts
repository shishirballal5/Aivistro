import { Request } from 'express';

export interface UserContext { userId: string; sessionId: string }
export interface AdminContext { adminId: string; sessionId: string; email: string; permissions: Set<string>; roles: string[] }

export type AuthedRequest = Request & { user?: UserContext; admin?: AdminContext };

/** pino-http's request id (see logger.module) as a string. */
export const requestIdOf = (req: Request): string | null => ((req as { id?: unknown }).id != null ? String((req as { id?: unknown }).id) : null);

export const AUDIENCE = { viewer: 'viewer', admin: 'admin', adminMfa: 'admin-mfa', signup: 'signup' } as const;
export const ISSUER = 'aivistro';
