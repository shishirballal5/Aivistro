/** Formats integer paise as rupees using only integer arithmetic (no floating point). 14900 -> "₹149", 14950 -> "₹149.50". */
export function formatInr(paise: number | string | bigint): string {
  const p = BigInt(paise);
  const rupees = p / 100n;
  const rem = p % 100n;
  const whole = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₹${whole}${rem ? `.${rem.toString().padStart(2, '0')}` : ''}`;
}

/** Parses a DB BIGINT string to a JS number, refusing values that would lose precision. */
export function paiseToNumber(v: string | number): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Amount ${v} is not a safe integer`);
  return n;
}
