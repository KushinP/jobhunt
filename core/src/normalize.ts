/**
 * The dedupe key. Computed here rather than as a generated column because SQLite has no
 * regex; the UNIQUE constraint on the column is still what enforces uniqueness.
 * Must stay byte-identical across every writer, so both Workers import this one function.
 */
export function normalizeKey(title: string, company: string): string {
  const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${strip(title)}|${strip(company)}`;
}

/** Regex metacharacters are stripped, not escaped, so a mistyped config term degrades
 * instead of throwing. Terms shorter than 2 characters after cleaning are ignored. */
function cleanTerm(term: string): string | null {
  const clean = term.toLowerCase().replace(/[[\](){}.*+?^$|\\]/g, '');
  return clean.length >= 2 ? clean : null;
}

/**
 * Word-boundary term matching. A plain substring test makes "intern" match
 * "International" and "ai" match "email", "domain" and "available", which silently
 * throws away good roles and keeps bad ones.
 */
export function countHits(haystack: string, terms: readonly string[]): number {
  const hay = haystack.toLowerCase();
  let n = 0;
  for (const raw of terms ?? []) {
    const clean = cleanTerm(raw);
    if (!clean) continue;
    if (new RegExp(`\\b${clean}\\b`).test(hay)) n++;
  }
  return n;
}

export function hasHit(haystack: string, terms: readonly string[]): boolean {
  return countHits(haystack, terms) > 0;
}

/**
 * Whether any term matches somewhere that is not inside a match of a shield term. Used so
 * a word inside a target title is not read as something else: "chief" in "Chief of Staff"
 * is not a C-suite claim, "manager" in "Implementation Manager" is not a management level,
 * and "engineer" in "Customer Solutions Engineer" is not a software engineering job. Spans
 * are found independently on the original text, so overlapping target phrases ("customer
 * solutions" and "solutions engineer") cannot hide a word from each other.
 */
export function hitOutside(haystack: string, terms: readonly string[], shields: readonly string[]): boolean {
  const hay = haystack.toLowerCase();
  const spans: [number, number][] = [];
  for (const raw of shields ?? []) {
    const clean = cleanTerm(raw);
    if (!clean) continue;
    for (const m of hay.matchAll(new RegExp(`\\b${clean}\\b`, 'g'))) spans.push([m.index!, m.index! + m[0].length]);
  }
  for (const raw of terms ?? []) {
    const clean = cleanTerm(raw);
    if (!clean) continue;
    for (const m of hay.matchAll(new RegExp(`\\b${clean}\\b`, 'g'))) {
      const a = m.index!, b = a + m[0].length;
      if (!spans.some(([x, y]) => x <= a && b <= y)) return true;
    }
  }
  return false;
}
