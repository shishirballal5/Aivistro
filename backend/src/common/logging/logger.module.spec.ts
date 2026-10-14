import { resolveRequestId } from './logger.module';

describe('resolveRequestId', () => {
  it('reuses a safe incoming correlation id', () => {
    expect(resolveRequestId('trace-abc-12345')).toBe('trace-abc-12345');
  });
  it('mints a UUID when none is supplied', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it.each(['short', 'has spaces in it', 'x'.repeat(200), 'inject\r\nSet-Cookie: a=b', '<script>alert(1)</script>'])('replaces an unsafe id: %s', (bad) => {
    const id = resolveRequestId(bad);
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['first-valid-id', 'second-valid-id'])).toBe('first-valid-id');
  });
});
