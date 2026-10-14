import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { DomainCode } from '../../../common/constants/error-codes';
import { unauthorized, unavailable } from '../../../common/errors';
import { authConfig } from '../../../config/auth.config';
import { IdentityProvider } from '../../../database/entities/index';

export interface VerifiedIdentity { subject: string; email: string | null; emailVerified: boolean; name: string | null }
export const JWKS_OVERRIDE = Symbol('JWKS_OVERRIDE');

const PROVIDERS = {
  [IdentityProvider.Google]: { issuers: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  [IdentityProvider.Apple]: { issuers: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys' },
};

/**
 * Verifies a Google/Apple ID token the client obtained: signature against the provider's published keys,
 * issuer, audience (must be one of OUR client IDs), expiry, and optionally the nonce. A provider with no
 * configured client ID is disabled. Nothing from the client is trusted before this passes.
 */
@Injectable()
export class SocialTokenVerifier {
  private readonly remote = new Map<string, JWTVerifyGetKey>();

  constructor(
    @Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>,
    @Optional() @Inject(JWKS_OVERRIDE) private readonly override?: (provider: IdentityProvider) => JWTVerifyGetKey,
  ) {}

  isEnabled(provider: IdentityProvider): boolean { return this.clientIds(provider).length > 0; }

  async verify(provider: IdentityProvider, idToken: string, nonce?: string): Promise<VerifiedIdentity> {
    const audiences = this.clientIds(provider);
    if (!audiences.length) throw unavailable(DomainCode.ProviderNotConfigured, `${provider} sign-in is not configured`);
    try {
      const { payload } = await jwtVerify(idToken, this.keyFor(provider), { issuer: PROVIDERS[provider].issuers, audience: audiences, algorithms: ['RS256', 'ES256'] });
      if (!payload.sub) throw new Error('no subject');
      if (nonce && payload.nonce !== nonce) throw new Error('nonce mismatch');
      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
      return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null, emailVerified, name: typeof payload.name === 'string' ? payload.name : null };
    } catch {
      throw unauthorized(DomainCode.InvalidToken, `Could not verify ${provider} sign-in`);
    }
  }

  private clientIds(provider: IdentityProvider): string[] { return provider === IdentityProvider.Google ? this.cfg.googleClientIds : this.cfg.appleClientIds; }

  private keyFor(provider: IdentityProvider): JWTVerifyGetKey {
    if (this.override) return this.override(provider);
    let key = this.remote.get(provider);
    if (!key) { key = createRemoteJWKSet(new URL(PROVIDERS[provider].jwks), { cooldownDuration: 30_000, timeoutDuration: 5000 }); this.remote.set(provider, key); }
    return key;
  }
}
