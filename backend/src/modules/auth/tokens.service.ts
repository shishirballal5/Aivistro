import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import { AUDIENCE, ISSUER } from '../../common/auth/auth.types';
import { DomainCode } from '../../common/constants/error-codes';
import { KeyService } from '../../common/crypto/key.service';
import { unauthorized } from '../../common/errors';
import { authConfig } from '../../config/auth.config';

export interface AccessClaims { sub: string; sid: string }
export interface AdminAccessClaims extends AccessClaims { amr: string[] }
export type MfaPurpose = 'verify' | 'setup';

/** Signs and verifies JWTs (HS256). Viewer and admin tokens use different keys AND audiences, so one can never pass as the other. */
@Injectable()
export class TokensService {
  constructor(private readonly keys: KeyService, @Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>) {}

  get accessTtlSeconds(): number { return this.cfg.accessTokenTtlSeconds; }

  signViewerAccess(userId: string, sessionId: string): Promise<string> {
    return this.sign({ sid: sessionId }, userId, AUDIENCE.viewer, this.keys.viewerJwt, this.cfg.accessTokenTtlSeconds);
  }
  verifyViewerAccess(token: string): Promise<AccessClaims> { return this.verify<AccessClaims>(token, this.keys.viewerJwt, AUDIENCE.viewer); }

  /** `amr` records how the admin authenticated; only sessions that passed MFA are ever issued a token. */
  signAdminAccess(adminId: string, sessionId: string): Promise<string> {
    return this.sign({ sid: sessionId, amr: ['pwd', 'otp'] }, adminId, AUDIENCE.admin, this.keys.adminJwt, this.cfg.accessTokenTtlSeconds);
  }
  verifyAdminAccess(token: string): Promise<AdminAccessClaims> { return this.verify<AdminAccessClaims>(token, this.keys.adminJwt, AUDIENCE.admin); }

  /** Short-lived token proving the password step passed; it only unlocks the MFA endpoints. */
  /** Proves a phone number passed OTP verification but still needs profile details. Single purpose, 15 minutes. */
  signSignupToken(phone: string): Promise<string> { return this.sign({}, phone, AUDIENCE.signup, this.keys.signupJwt, 900); }
  async verifySignupToken(token: string): Promise<string> { return (await this.verify<{ sub: string }>(token, this.keys.signupJwt, AUDIENCE.signup)).sub; }
  signMfaToken(adminId: string, purpose: MfaPurpose): Promise<string> { return this.sign({ purpose }, adminId, AUDIENCE.adminMfa, this.keys.adminMfaJwt, 600); }
  async verifyMfaToken(token: string, purpose: MfaPurpose): Promise<string> {
    const claims = await this.verify<{ sub: string; purpose: MfaPurpose }>(token, this.keys.adminMfaJwt, AUDIENCE.adminMfa);
    if (claims.purpose !== purpose) throw unauthorized(DomainCode.InvalidToken, 'Invalid or expired token');
    return claims.sub;
  }

  private sign(claims: Record<string, unknown>, subject: string, audience: string, key: Buffer, ttlSeconds: number): Promise<string> {
    return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject(subject).setAudience(audience).setIssuer(ISSUER).setIssuedAt().setExpirationTime(`${ttlSeconds}s`).sign(key);
  }

  private async verify<T extends object>(token: string, key: Buffer, audience: string): Promise<T> {
    try {
      const { payload } = await jwtVerify(token, key, { audience, issuer: ISSUER, algorithms: ['HS256'] });
      return payload as unknown as T;
    } catch {
      throw unauthorized(DomainCode.InvalidToken, 'Invalid or expired token');
    }
  }
}
