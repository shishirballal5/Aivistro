import { ageInYears, assertMinAge, MIN_AGE_YEARS } from './age';

const now = new Date(Date.UTC(2026, 9, 13, 12)); // 13 Oct 2026

describe('minimum age rule', () => {
  it('is 14', () => expect(MIN_AGE_YEARS).toBe(14));

  it('counts whole years, birthday inclusive', () => {
    expect(ageInYears('2012-10-13', now)).toBe(14); // 14th birthday is today
    expect(ageInYears('2012-10-14', now)).toBe(13); // tomorrow
    expect(ageInYears('2012-11-01', now)).toBe(13);
    expect(ageInYears('2000-02-29', now)).toBe(26);
  });

  it('accepts someone exactly 14 today and anyone older', () => {
    expect(assertMinAge('2012-10-13', now)).toBe('2012-10-13');
    expect(assertMinAge('1990-05-20', now)).toBe('1990-05-20');
  });

  it('rejects someone one day short of 14, and younger', () => {
    for (const dob of ['2012-10-14', '2015-01-01', '2026-10-13']) expect(() => assertMinAge(dob, now)).toThrow(/at least 14/);
  });

  it('rejects malformed, impossible, future and implausible dates', () => {
    for (const dob of ['', 'abc', '2000-13-01', '2000-02-30', '2001-02-29', '2027-01-01', '1899-12-31', '13/10/2000', '2000-1-1']) expect(() => assertMinAge(dob, now)).toThrow(/valid date of birth/);
  });
});
