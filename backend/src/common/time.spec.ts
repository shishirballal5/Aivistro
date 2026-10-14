import { addDays, addMonthsUtc, addSeconds } from './time';

describe('addMonthsUtc', () => {
  const d = (s: string) => new Date(s);
  it('adds calendar months', () => {
    expect(addMonthsUtc(d('2026-01-15T10:00:00Z'), 1).toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(addMonthsUtc(d('2026-01-15T10:00:00Z'), 3).toISOString()).toBe('2026-04-15T10:00:00.000Z');
    expect(addMonthsUtc(d('2026-10-09T10:00:00Z'), 12).toISOString()).toBe('2027-10-09T10:00:00.000Z');
  });
  it('clamps to the last day of a shorter month (no rollover into the next month)', () => {
    expect(addMonthsUtc(d('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsUtc(d('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z'); // leap year
    expect(addMonthsUtc(d('2026-08-31T00:00:00Z'), 1).toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(addMonthsUtc(d('2024-02-29T00:00:00Z'), 12).toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });
  it('crosses year boundaries and does not mutate its input', () => {
    const input = d('2026-11-30T23:59:59Z');
    expect(addMonthsUtc(input, 3).toISOString()).toBe('2027-02-28T23:59:59.000Z');
    expect(input.toISOString()).toBe('2026-11-30T23:59:59.000Z');
  });
  it('has simple second/day helpers', () => {
    expect(addSeconds(d('2026-01-01T00:00:00Z'), 90).toISOString()).toBe('2026-01-01T00:01:30.000Z');
    expect(addDays(d('2026-01-01T00:00:00Z'), 2).toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
});
