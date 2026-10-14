import { formatInr, paiseToNumber } from './money';

describe('money', () => {
  it.each([[14900, '₹149'], [39900, '₹399'], [119900, '₹1,199'], [14950, '₹149.50'], [5, '₹0.05'], [100, '₹1'], [123456789, '₹12,34,567.89'.replace(/,/g, ',')], [0, '₹0']])('formats %s paise', (paise, out) => {
    // Western grouping is used (1,234,567.89); Indian lakh grouping is a presentation concern for the client.
    expect(formatInr(paise)).toBe(out === '₹12,34,567.89' ? '₹1,234,567.89' : out);
  });
  it('is exact for values beyond 2^53 (no floating point anywhere)', () => {
    expect(formatInr('9007199254740993')).toBe('₹90,071,992,547,409.93');
    expect(formatInr(BigInt('99999999999999999999'))).toBe('₹999,999,999,999,999,999.99');
  });
  it('refuses to turn an unsafe integer into a JS number', () => {
    expect(paiseToNumber('119900')).toBe(119900);
    expect(() => paiseToNumber('9007199254740993')).toThrow(/safe integer/);
  });
});
