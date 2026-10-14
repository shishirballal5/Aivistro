import { normalizePhone } from './otp.service';
import { PasswordsService } from './passwords.service';
import { sanitize } from '../audit-logs/audit.service';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'], ['98765 43210', '+919876543210'], ['09876543210', '+919876543210'], ['+91 98765-43210', '+919876543210'], ['+14155552671', '+14155552671'],
  ])('%s -> %s', (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each(['12345', 'abcdefghij', '+0123456789', '5876543210', '', '+91'])('rejects %s', (input) => expect(normalizePhone(input)).toBeNull());
});

describe('PasswordsService', () => {
  const svc = new PasswordsService();
  it('hashes with argon2id and verifies', async () => {
    const hash = await svc.hash('a-long-enough-password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(hash, 'a-long-enough-password')).toBe(true);
    expect(await svc.verify(hash, 'another-password-x')).toBe(false);
    expect(await svc.verify(null, 'anything')).toBe(false); // unknown account still does the work
  });
  it('enforces the password policy', () => {
    expect(() => svc.assertStrong('short')).toThrow();
    expect(() => svc.assertStrong('1234567890123')).toThrow();
    expect(() => svc.assertStrong('Password123')).toThrow();
    expect(() => svc.assertStrong('x'.repeat(129))).toThrow();
    expect(() => svc.assertStrong('correct-horse-battery')).not.toThrow();
  });
});

describe('audit sanitize', () => {
  it('redacts anything that looks like a credential, recursively', () => {
    const out = sanitize({ title: 'ok', password: 'p', newPassword: 'p', nested: { accessToken: 't', refreshToken: 'r', otp: '123456', code: '1', apiKey: 'k', storageKey: 's', signature: 'x', mfaSecret: 'm', fine: 1 }, list: [{ authorization: 'Bearer x', name: 'n' }] }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/"p"|"t"|"r"|123456|"k"|"s"|"x"|"m"|Bearer/);
    expect(out.title).toBe('ok');
    expect((out.nested as Record<string, unknown>).fine).toBe(1);
    expect(((out.list as Record<string, unknown>[])[0]).name).toBe('n');
  });
  it('truncates huge values and deep nesting', () => {
    expect((sanitize('x'.repeat(2000)) as string).length).toBeLessThan(600);
    let deep: Record<string, unknown> = { v: 1 }; for (let i = 0; i < 10; i++) deep = { d: deep };
    expect(JSON.stringify(sanitize(deep))).toContain('[truncated]');
  });
});
