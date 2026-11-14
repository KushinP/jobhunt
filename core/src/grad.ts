import { jdSentences } from './score.ts';

/**
 * Postings that require a graduation the person can no longer meet: on 2026-11-11 the sweep
 * found BRG ("expected graduation date between December 2026 and May 2027"), Guggenheim,
 * Houlihan Lokey, Charles River Associates and Ankura in Queued, all for students graduating
 * after the person already had. A later START date is fine and is not read here.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // a season names when a class graduates
  spring: 5, summer: 8, fall: 12, autumn: 12, winter: 12,
};
const WHEN = String.raw`(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|spring|summer|fall|autumn|winter)\.?,?\s+(20\d\d)`;

const month = (word: string, year: string) => Number(year) * 12 + (MONTHS[word.slice(0, 3)] ?? MONTHS[word] ?? 6);
const parseGraduated = (s: string) => {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? Number(m[2]) * 12 + Number(m[1]) : null;
};

/** The graduation phrase that rules the person out, and why; null when nothing does. */
export function gradWindowConflict(jd: string | null | undefined, graduated: string | null | undefined): string | null {
  const grad = graduated ? parseGraduated(graduated) : null;
  if (!jd || grad == null) return null;
  const gradLabel = graduated!.trim();
  for (const s of jdSentences(jd)) {
    // "graduation date between December 2026 and May 2027", "graduated between May 2026 and June 2027"
    const between = new RegExp(String.raw`\bgraduat\w*(?:\s+date)?\s+(?:between|from)\s+${WHEN}\s+(?:and|to|through|-|–)\s+${WHEN}`).exec(s);
    if (between) {
      const start = month(between[1], between[2]);
      if (start > grad) return `${between[0]} vs graduated ${gradLabel}`;
      continue;
    }
    // "graduating in Spring 2027", "expected graduation in December 2026", "on track to receive
    // a bachelor's degree in December 2026 or Spring 2027": the earliest date offered
    const single = new RegExp(String.raw`\b(?:graduat\w*|on track to (?:receive|complete|earn)[^.]{0,60}?)(?:\s+date)?\s+(?:in|of|by)?\s*${WHEN}`).exec(s);
    if (single) {
      const dates = [...s.slice(single.index).matchAll(new RegExp(WHEN, 'g'))].map((m) => month(m[1], m[2]));
      const earliest = Math.min(...dates);
      if (earliest > grad && !/\bor (?:earlier|before)\b/.test(s)) return `${single[0]} vs graduated ${gradLabel}`;
      continue;
    }
    const cls = /\bclass of (20\d\d)\b/.exec(s);
    if (cls && Number(cls[1]) * 12 + 5 > grad) return `${cls[0]} vs graduated ${gradLabel}`;
    // current enrollment, unless a recent graduate is also welcome
    // about a degree, not a charter: "currently pursuing the CFA designation" (Aristotle) is not
    // enrollment, "currently pursuing a bachelor's or master's degree" (Kroll) is
    const enrolled = /\b(?:currently|must be)\s+(?:pursuing|enrolled)\b/.exec(s);
    const about = enrolled ? s.slice(enrolled.index, enrolled.index + 90) : '';
    const degree = /\b(?:degree|bachelor|master|undergraduate|graduate program|university|college|school|mba|phd|student)/.test(about)
      && !/\b(?:cfa|caia|frm|cpa|charter|certification|certificate|designation|license)\b/.test(about);
    if (enrolled && degree && !/\bor\s+(?:have\s+)?(?:recently\s+)?(?:completed|graduated|obtained|earned)\b/.test(s)) {
      return `${s.slice(enrolled.index, enrolled.index + 80).trim()} vs graduated ${gradLabel}`;
    }
  }
  return null;
}
