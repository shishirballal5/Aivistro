import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { authConfig } from '../../config/auth.config';
import { DomainCode } from '../../common/constants/error-codes';
import { hmacSha256Hex, safeEqual } from '../../common/crypto/crypto.util';
import { KeyService } from '../../common/crypto/key.service';
import { badRequest, DomainException } from '../../common/errors';
import { addSeconds } from '../../common/time';
import { OtpChallenge, OtpPurpose } from '../../database/entities/index';
import { SmsSender } from '../../util/thirdparty/sms-email/senders';


export const OTP_TTL_SECONDS = 300;
export const OTP_COOLDOWN_SECONDS = 30;
export const OTP_MAX_PER_DESTINATION_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 20;
export const OTP_MAX_ATTEMPTS = 5;

/** Normalises to E.164. A bare 10-digit number is treated as Indian (+91). Returns null if it cannot be valid. */
export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s()-]/g, '');
  const e164 = /^\+/.test(cleaned) ? cleaned : /^[6-9]\d{9}$/.test(cleaned) ? `+91${cleaned}` : /^0?[6-9]\d{9}$/.test(cleaned) ? `+91${cleaned.slice(-10)}` : cleaned;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(OtpChallenge) private readonly repo: Repository<OtpChallenge>,
    private readonly keys: KeyService,
    private readonly sms: SmsSender,
    @Inject(authConfig.KEY) private readonly cfg: ConfigType<typeof authConfig>,
  ) {
    if (cfg.devFixedOtp) new Logger(OtpService.name).warn('DEV_FIXED_OTP is set: every phone OTP is a known code. Development only.');
  }

  get enabled(): boolean { return this.sms.enabled; }

  private codeHash(challengeId: string, code: string): string { return hmacSha256Hex(this.keys.otp, `${challengeId}:${code}`); }

  /** Issues a code. Cooldown and hourly caps (per number and per IP) stop SMS-bombing and cost abuse. */
  async request(phone: string, ip: string | null): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
    const now = new Date();
    const hourAgo = addSeconds(now, -3600);
    const latest = await this.repo.findOne({ where: { destination: phone }, order: { createdAt: 'DESC' } });
    if (latest && latest.createdAt > addSeconds(now, -OTP_COOLDOWN_SECONDS)) {
      throw new DomainException(HttpStatus.TOO_MANY_REQUESTS, DomainCode.OtpCooldown, 'Please wait before requesting another code', { retryAfterSeconds: OTP_COOLDOWN_SECONDS });
    }
    const perDest = await this.repo.count({ where: { destination: phone, createdAt: MoreThan(hourAgo) } });
    const perIp = ip ? await this.repo.count({ where: { ipAddress: ip, createdAt: MoreThan(hourAgo) } }) : 0;
    const ipCap = OTP_MAX_PER_IP_PER_HOUR * Math.max(1, Number(process.env.AUTH_RATE_LIMIT_SCALE || 1)); // scaled only in tests
    if (perDest >= OTP_MAX_PER_DESTINATION_PER_HOUR || perIp >= ipCap) {
      throw new DomainException(HttpStatus.TOO_MANY_REQUESTS, DomainCode.OtpRateLimited, 'Too many code requests. Try again later.');
    }

    const code = this.cfg.devFixedOtp ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await this.repo.save({ destination: phone, purpose: OtpPurpose.Login, codeHash: 'pending', attempts: 0, maxAttempts: OTP_MAX_ATTEMPTS, expiresAt: addSeconds(now, OTP_TTL_SECONDS), consumedAt: null, ipAddress: ip });
    await this.repo.update(row.id, { codeHash: this.codeHash(row.id, code) });
    try {
      await this.sms.send(phone, `${code} is your AIVISTRO verification code. It expires in 5 minutes. Do not share it.`);
    } catch (err) {
      await this.repo.update(row.id, { consumedAt: new Date() }); // an undeliverable code must not count as a live challenge
      throw err;
    }
    return { expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_COOLDOWN_SECONDS };
  }

  /**
   * Verifies the newest live code for this number. The attempt is counted atomically BEFORE comparing, so parallel guesses
   * cannot exceed the limit, and a code is consumed with a conditional UPDATE so it can only be used once.
   */
  async verify(phone: string, code: string): Promise<void> {
    const fail = () => badRequest(DomainCode.InvalidOtp, 'Invalid or expired code');
    const challenge = await this.repo.findOne({ where: { destination: phone, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) }, order: { createdAt: 'DESC' } });
    if (!challenge || challenge.consumedAt) throw fail();

    const counted = await this.repo.createQueryBuilder().update().set({ attempts: () => 'attempts + 1' }).where('id = :id AND consumed_at IS NULL AND attempts < max_attempts AND expires_at > :now', { id: challenge.id, now: new Date() }).execute();
    if (!counted.affected) throw fail();

    if (!safeEqual(this.codeHash(challenge.id, code), challenge.codeHash)) throw fail();
    const used = await this.repo.createQueryBuilder().update().set({ consumedAt: new Date() }).where('id = :id AND consumed_at IS NULL', { id: challenge.id }).execute();
    if (!used.affected) throw fail(); // lost a race with a parallel request using the same code
  }
}
