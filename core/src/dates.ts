/**
 * Application deadlines. Only a date the posting ties to applying counts: "Apply by
 * October 2, 2026", "Application deadline: 10/2/2026". A posted date, a start date or a year
 * the company was founded is never read as a deadline, so a missing date is common and a
 * wrong one should be rare.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY = '(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\\s+)?';

const DEADLINE = [
  'apply by', 'apply before', 'apply no later than',
  'application deadline', 'applications? (?:are |is )?due', 'applications? (?:will )?close',
  'deadline to apply', 'deadline for applications', 'closing date',
  '(?:job )?posting (?:will )?close[sd]?', '(?:job )?posting end date',
  '(?:we are |we\'re )?accepting applications (?:until|through)',
  'applications (?:will be )?accepted (?:until|through)',
].join('|');
// What may sit between the phrase and the date: "is", "on", a colon, "no later than", "the".
const GAP = '(?:\\s|[:\\-\\u2013\\u2014,]|\\bis\\b|\\bon\\b|\\bthe\\b|\\bno later than\\b|\\bby\\b|\\bend of day\\b|\\beod\\b)*';

const FORMS = [
  `${WEEKDAY}${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
  `(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH},?(?:\\s+(\\d{4}))?`,
  '(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})(?!\\d)',
  '(\\d{4})-(\\d{2})-(\\d{2})',
];

const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A date with no year is the next time that day comes round, allowing a month's grace for a
 * posting read shortly after its deadline. */
function withYear(m: number, d: number, now: Date): string | null {
  const y = now.getUTCFullYear();
  for (const year of [y, y + 1]) {
    const iso = valid(year, m, d);
    if (iso && Date.parse(iso) >= now.getTime() - 31 * 86_400_000) return iso;
  }
  return null;
}

/** Reads one date in any of the supported forms from the start of `text`. */
function dateAt(text: string, now: Date): string | null {
  const t = text.toLowerCase();
  let m = t.match(new RegExp(`^${FORMS[0]}`));
  if (m) {
    const mon = MONTHS[m[1].replace('.', '')];
    return m[3] ? valid(Number(m[3]), mon, Number(m[2])) : withYear(mon, Number(m[2]), now);
  }
  m = t.match(new RegExp(`^${FORMS[1]}`));
  if (m) {
    const mon = MONTHS[m[2].replace('.', '')];
    return m[3] ? valid(Number(m[3]), mon, Number(m[1])) : withYear(mon, Number(m[1]), now);
  }
  m = t.match(new RegExp(`^${FORMS[2]}`));
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, Number(m[1]), Number(m[2]));
  }
  m = t.match(new RegExp(`^${FORMS[3]}`));
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** The application deadline a JD states, as YYYY-MM-DD, or null. */
export function closingDateFromJd(jd: string | null | undefined, now = new Date()): string | null {
  if (!jd) return null;
  const re = new RegExp(`\\b(?:${DEADLINE})\\b${GAP}`, 'gi');
  for (const m of jd.matchAll(re)) {
    const iso = dateAt(jd.slice(m.index! + m[0].length, m.index! + m[0].length + 40), now);
    if (iso) return iso;
  }
  return null;
}

/** A date from a source or a person, as YYYY-MM-DD: ISO dates and datetimes, "9/30/2026",
 * "September 30, 2026". Anything else is null rather than a guess. */
export function toIsoDate(value: unknown, now = new Date()): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return dateAt(s, now);
}
