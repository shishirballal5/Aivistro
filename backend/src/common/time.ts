/** Adds calendar months in UTC, clamping to the last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/**
 * End of the uninterrupted run of access that is live at `now`: stacked periods are chained while each one starts at or before
 * the previous one's end. Returns null if nothing covers `now`.
 */
export function contiguousEnd(periods: { startsAt: Date; endsAt: Date }[], now: Date): Date | null {
  const sorted = [...periods].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let end: Date | null = null;
  for (const p of sorted) {
    if (end === null) { if (p.startsAt <= now && p.endsAt > now) end = p.endsAt; }
    else if (p.startsAt <= end && p.endsAt > end) end = p.endsAt;
  }
  return end;
}
