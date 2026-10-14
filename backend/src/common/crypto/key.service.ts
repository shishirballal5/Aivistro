import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { authConfig } from '../../config/auth.config';
import { deriveKey } from './crypto.util';

/** Purpose-separated keys. Compromising one derived key does not reveal the master secret or the others. */
@Injectable()
export class KeyService {
  readonly viewerJwt: Buffer;
  readonly adminJwt: Buffer;
  readonly adminMfaJwt: Buffer;
  readonly signupJwt: Buffer;
  readonly otp: Buffer;
  readonly mfaEncryption: Buffer;
  readonly mediaEncryption: Buffer;
  readonly mediaSigning: Buffer;

  constructor(@Inject(authConfig.KEY) cfg: ConfigType<typeof authConfig>) {
    this.viewerJwt = deriveKey(cfg.secret, 'jwt:viewer');
    this.adminJwt = deriveKey(cfg.secret, 'jwt:admin');
    this.adminMfaJwt = deriveKey(cfg.secret, 'jwt:admin-mfa');
    this.signupJwt = deriveKey(cfg.secret, 'jwt:signup');
    this.otp = deriveKey(cfg.secret, 'otp-hmac');
    this.mfaEncryption = deriveKey(cfg.secret, 'mfa-secret-encryption');
    this.mediaEncryption = deriveKey(cfg.secret, 'media-key-encryption');
    this.mediaSigning = deriveKey(cfg.secret, 'media-url-signing');
  }
}

@Global()
@Module({ providers: [KeyService], exports: [KeyService] })
export class CryptoModule {}
