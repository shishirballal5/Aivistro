import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const TOTP_STEP_SECONDS = 30;
export const generateTotpSecret = (): string => base32Encode(randomBytes(20)); // 160 bits

/** RFC 6238 TOTP (HMAC-SHA1). `digits` is 6 for authenticator apps. */
export function totpAt(secretBase32: string, timeMs: number, digits = 6): string {
  return hotp(base32Decode(secretBase32), Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS), digits);
}
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Checks the code against the current step ±1 (clock drift). Returns the matching step, or null. */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  const key = base32Decode(secretBase32);
  for (let i = -window; i <= window; i++) if (hotp(key, step + i) === code) return step + i;
  return null;
}

export const otpauthUri = (issuer: string, account: string, secret: string): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
