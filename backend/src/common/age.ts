import { badRequest } from './errors';

/** Accounts may only be created by people at least this old. Change here only: the API, the website form and the tests read it. */
export const MIN_AGE_YEARS = 14;

/** Whole years between `dob` (YYYY-MM-DD) and `now`, in UTC. */
export function ageInYears(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

/**
 * Validates a date of birth and enforces the minimum age. Returns the normalised value.
 * Rejects malformed or impossible dates (2026-02-30), future dates and implausible ages, before anything is created.
 */
export function assertMinAge(dob: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob ?? '');
  const real = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !real || real.getUTCFullYear() !== +m[1] || real.getUTCMonth() !== +m[2] - 1 || real.getUTCDate() !== +m[3] || real > now || +m[1] < 1900) {
    throw badRequest('INVALID_DATE_OF_BIRTH', 'Enter a valid date of birth.');
  }
  if (ageInYears(dob, now) < MIN_AGE_YEARS) throw badRequest('UNDER_MIN_AGE', `You must be at least ${MIN_AGE_YEARS} years old to create an account.`);
  return dob;
}
