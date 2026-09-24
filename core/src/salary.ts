/**
 * Reads a posted salary into an annual range. Deliberately conservative: anything it
 * cannot read confidently returns null, and a null never filters a role out. A missed
 * filter costs a glance; a wrong filter silently throws away a good job.
 */
export interface SalaryRange { min: number; max: number; hourly: boolean }

const HOURS_PER_YEAR = 2080;

export function parseSalary(text: string | null | undefined): SalaryRange | null {
  if (!text) return null;
  const s = text.toLowerCase().replace(/,/g, '');
  const hourly = /(\/\s*h(ou)?r|per hour|an hour|hourly)/.test(s);

  const nums: number[] = [];
  for (const m of s.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/g)) {
    let n = Number(m[1]);
    if (m[2] === 'k') n *= 1_000;
    if (m[2] === 'm') n *= 1_000_000;
    nums.push(n);
  }
  if (nums.length === 0) return null;

  let vals = nums.slice(0, 2).map((n) => (hourly ? n * HOURS_PER_YEAR : n));
  // Anything outside a plausible salary band is more likely a year, a count, or a
  // percentage than pay, so the whole reading is discarded rather than guessed at.
  if (vals.some((v) => v < 10_000 || v > 2_000_000)) return null;
  if (vals.length === 1) vals = [vals[0], vals[0]];
  const [a, b] = vals;
  return { min: Math.min(a, b), max: Math.max(a, b), hourly };
}

/** The line of a JD most likely to state pay, so a salary buried in the description can
 * still be read without scanning every number in the text. */
export function extractPayLine(jd: string | null | undefined): string | null {
  if (!jd) return null;
  const line = jd.split(/\n|(?<=\.)\s/).find((l) =>
    /(salary|compensation|pay range|base pay|\$\s*\d)/i.test(l) && /\$\s*\d/.test(l));
  return line ?? null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** "$175,000 - $250,000", or null when there is nothing numeric to show. */
export function formatRange(min?: number | null, max?: number | null, per?: string | null): string | null {
  const lo = typeof min === 'number' && min > 0 ? min : null;
  const hi = typeof max === 'number' && max > 0 ? max : null;
  if (lo == null && hi == null) return null;
  const range = lo != null && hi != null && lo !== hi ? `${money(lo)} - ${money(hi)}` : money((lo ?? hi)!);
  return per && /hour/i.test(per) ? `${range} / hour` : range;
}

// A line has to say it is about pay, and not about money the company has, before its numbers
// are shown as the salary: "manages a $300k budget" is not a $300,000 salary.
const PAY_WORDS = /\b(salary|salaries|compensation|pay|base|wage|hourly|per hour|\/\s*hr|ote|annual(ly)?|range)\b/i;
const NOT_PAY = /\b(raised|funding|funded|revenue|budget|assets|valuation|arr|aum|million|billion|series [a-f])\b/i;

/** The salary a JD states, as the dashboard shows it ("$120,000 - $150,000"), or null. Used to
 * fill the salary column when the source gave none; the scorer reads the same line. */
export function salaryFromJd(jd: string | null | undefined): string | null {
  if (!jd) return null;
  for (const line of jd.split(/\n|(?<=\.)\s/)) {
    if (!/\$\s*\d/.test(line) || !PAY_WORDS.test(line) || NOT_PAY.test(line)) continue;
    const r = parseSalary(line);
    if (!r) continue;
    return r.hourly
      ? formatRange(r.min / HOURS_PER_YEAR, r.max / HOURS_PER_YEAR, 'hour')
      : formatRange(r.min, r.max);
  }
  return null;
}
