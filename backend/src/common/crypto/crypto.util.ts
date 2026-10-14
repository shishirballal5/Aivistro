import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const hmacSha256Hex = (key: Buffer | string, data: string | Buffer): string => createHmac('sha256', key).update(data).digest('hex');
/** URL-safe random token. 32 bytes = 256 bits of entropy. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison (length is not secret here; contents are). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Derives an independent 256-bit key for one purpose from the master secret (HKDF-SHA256). */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'aivistro-v1', purpose, 32));
}

/** AES-256-GCM, output "v1.<iv>.<tag>.<ciphertext>" (base64url). Used for MFA secrets and HLS keys at rest. */
export function encryptString(key: Buffer, plaintext: string | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptToBuffer(key: Buffer, payload: string): Buffer {
  const [version, iv, tag, ct] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
}
export const decryptString = (key: Buffer, payload: string): string => decryptToBuffer(key, payload).toString('utf8');
