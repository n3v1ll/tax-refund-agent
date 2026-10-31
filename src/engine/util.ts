/** Round to cents, half away from zero. */
export function cents(n: number): number {
  const s = Math.sign(n);
  return (s * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

export function sum(ns: number[]): number {
  return cents(ns.reduce((a, b) => a + b, 0));
}

/** Add whole calendar years to an ISO date (29 Feb maps to 28 Feb). */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const ty = y + years;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${ty}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso + 'T00:00:00Z') + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Held for at least 12 months, excluding the day of acquisition and the day
 * of disposal. Bought 1 Jan 2024, the earliest discount sale date is 2 Jan 2025.
 */
export function discountEligible(acquired: string, disposed: string): boolean {
  return disposed > addYears(acquired, 1);
}

export function inRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}
