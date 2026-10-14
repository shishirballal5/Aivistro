import { decryptString, deriveKey, encryptString, hmacSha256Hex, randomToken, safeEqual, sha256Hex } from './crypto.util';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from './totp';

describe('crypto utilities', () => {
  const key = deriveKey('a'.repeat(40), 'test');
  it('derives different keys per purpose, deterministically', () => {
    expect(deriveKey('s'.repeat(40), 'a').equals(deriveKey('s'.repeat(40), 'a'))).toBe(true);
    expect(deriveKey('s'.repeat(40), 'a').equals(deriveKey('s'.repeat(40), 'b'))).toBe(false);
    expect(deriveKey('s'.repeat(40), 'a').equals(deriveKey('t'.repeat(40), 'a'))).toBe(false);
  });
  it('AES-GCM round-trips and rejects tampering or the wrong key', () => {
    const ct = encryptString(key, 'secret value ₹');
    expect(decryptString(key, ct)).toBe('secret value ₹');
    expect(encryptString(key, 'x')).not.toBe(encryptString(key, 'x')); // fresh IV each time
    const [v, iv, tag, body] = ct.split('.');
    expect(() => decryptString(key, [v, iv, tag, Buffer.from('tampered').toString('base64url')].join('.'))).toThrow();
    expect(() => decryptString(deriveKey('z'.repeat(40), 'test'), ct)).toThrow();
    expect(() => decryptString(key, 'garbage')).toThrow();
    void body;
  });
  it('hashes and compares in constant-time helpers', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmacSha256Hex('k', 'd')).toHaveLength(64);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken(32).length).toBeGreaterThanOrEqual(43);
  });
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const rfcKey = Buffer.from('12345678901234567890');
  it('matches the RFC 4226 HOTP test vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(rfcKey, counter)).toBe(code));
  });
  it('matches the RFC 6238 SHA-1 vector at T=59s (8 digits: 94287082)', () => {
    expect(hotp(rfcKey, Math.floor(59 / 30), 8)).toBe('94287082');
  });
  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(rfcKey)).equals(rfcKey)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
  it('accepts the current step and one step of clock drift, but not more', () => {
    const secret = base32Encode(rfcKey);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpAt(secret, now), now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, now - 30000), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30000), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, now - 90000), now)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
  it('builds an otpauth URI for authenticator apps', () => {
    expect(otpauthUri('AIVISTRO', 'a@b.co', 'ABC')).toBe('otpauth://totp/AIVISTRO:a%40b.co?secret=ABC&issuer=AIVISTRO&algorithm=SHA1&digits=6&period=30');
  });
});
