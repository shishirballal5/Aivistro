import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DomainCode } from '../../common/constants/error-codes';
import { badRequest } from '../../common/errors';

const COMMON = new Set(['password', 'password1', 'password123', '1234567890', 'qwertyuiop', 'letmein123', 'iloveyou123', 'admin12345', 'aivistro123']);

/** Argon2id with OWASP-recommended minimum parameters (19 MiB, 2 passes, 1 lane). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordsService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> { return argon2.hash(password, OPTIONS); }

  async verify(hash: string | null, password: string): Promise<boolean> {
    // Always do the same amount of work, so response time does not reveal whether an account exists.
    if (!hash) { await argon2.verify(await this.getDummy(), password).catch(() => false); return false; }
    return argon2.verify(hash, password).catch(() => false);
  }

  needsRehash(hash: string): boolean { return argon2.needsRehash(hash, OPTIONS); }

  assertStrong(password: string): void {
    if (password.length < 10 || password.length > 128) throw badRequest(DomainCode.PasswordTooWeak, 'Password must be 10 to 128 characters');
    if (/^\d+$/.test(password) || COMMON.has(password.toLowerCase())) throw badRequest(DomainCode.PasswordTooWeak, 'Choose a less common password');
  }

  private getDummy(): Promise<string> { return (this.dummyHash ??= argon2.hash('dummy-password-for-timing', OPTIONS)); }
}
