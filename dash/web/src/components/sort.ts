import { useEffect, useState } from 'react';
import type { Job } from '../api.ts';

/** What a list of roles can be ordered by. Shared by the board and the All roles table, so
 * "Highest salary" means the same thing on both. */
export type SortKey =
  | 'score' | 'rating' | 'salary' | 'closes' | 'created_at' | 'applied_at' | 'status_changed_at'
  | 'company' | 'title' | 'family' | 'status' | 'location' | 'source' | 'docs'
  /** the document build's order: star rating (unrated last), then score, then oldest */
  | 'build';

export interface Sort { key: SortKey; desc: boolean }

export const SORT_PRESETS: { key: string; label: string; sort: Sort }[] = [
  { key: 'best', label: 'Best match', sort: { key: 'score', desc: true } },
  { key: 'rating', label: 'Your rating', sort: { key: 'rating', desc: true } },
  { key: 'salary', label: 'Highest salary', sort: { key: 'salary', desc: true } },
  { key: 'closing', label: 'Closing soonest', sort: { key: 'closes', desc: false } },
  { key: 'newest', label: 'Newest found', sort: { key: 'created_at', desc: true } },
  { key: 'oldest', label: 'Oldest found', sort: { key: 'created_at', desc: false } },
  { key: 'applied', label: 'Recently applied', sort: { key: 'applied_at', desc: true } },
  { key: 'moved', label: 'Recently moved', sort: { key: 'status_changed_at', desc: true } },
  { key: 'company', label: 'Company A-Z', sort: { key: 'company', desc: false } },
  { key: 'title', label: 'Role A-Z', sort: { key: 'title', desc: false } },
];

/** The presets that make sense inside a board column. */
export const BOARD_PRESETS = SORT_PRESETS.filter((p) =>
  ['best', 'newest', 'salary', 'closing', 'rating', 'moved'].includes(p.key));

export const presetFor = (s: Sort) =>
  SORT_PRESETS.find((p) => p.sort.key === s.key && p.sort.desc === s.desc)?.key ?? '';

/** Which way a column sorts on its first click: text A-Z, deadlines soonest, everything else
 * biggest or newest first. */
export const firstDirection = (key: SortKey) =>
  !['title', 'company', 'family', 'location', 'source', 'status', 'closes'].includes(key);

/**
 * A posted salary as one annual number to sort by: the top of the range, hourly pay times
 * 2080. Mirrors parseSalary on the server; anything unreadable is null and sorts last.
 */
export function salaryValue(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.toLowerCase().replace(/,/g, '');
  const hourly = /(\/\s*h(ou)?r|per hour|an hour|hourly)/.test(s);
  const nums: number[] = [];
  for (const m of s.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/g)) {
    let n = Number(m[1]);
    if (m[2] === 'k') n *= 1_000;
    if (m[2] === 'm') n *= 1_000_000;
    nums.push(hourly ? n * 2080 : n);
  }
  const vals = nums.slice(0, 2);
  if (!vals.length || vals.some((v) => v < 10_000 || v > 2_000_000)) return null;
  return Math.max(...vals);
}

/** Today as YYYY-MM-DD in the viewer's time zone, which is what a deadline is read against. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from today to a YYYY-MM-DD date; negative once it has passed. */
export function daysUntil(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = today().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

/** Statuses in pipeline order, so sorting by status reads left to right like the board. */
const STATUS_ORDER = ['New', 'Generate', 'Complete', 'Applied', 'Interviewing', 'Offer', 'Rejected',
  'Unverified', 'Skip', 'Discarded', 'Dead link'];

function value(j: Job, key: SortKey, familyName: (id: number | null) => string): string | number | null {
  switch (key) {
    case 'score': return j.score;
    case 'rating': return j.rating;
    case 'salary': return salaryValue(j.salary);
    case 'closes': return j.closes_at ?? null;
    case 'created_at': return j.created_at;
    case 'applied_at': return j.applied_at;
    case 'status_changed_at': return j.status_changed_at ?? null;
    case 'company': return j.company.toLowerCase();
    case 'title': return j.title.toLowerCase();
    case 'family': return familyName(j.archetype) || null;
    case 'status': { const i = STATUS_ORDER.indexOf(j.status); return i < 0 ? STATUS_ORDER.length : i; }
    case 'location': return j.location?.toLowerCase() || null;
    case 'source': return j.source;
    case 'docs': return j.resume_count + j.cl_count || null;
    case 'build': return null;
  }
}

/** Sorts a copy. A missing value always sorts last, whichever way the column is turned, and
 * ties fall back to the score. "Closing soonest" puts deadlines still ahead first, soonest at
 * the top, then roles with no date, then deadlines already passed. */
export function sortJobs(list: Job[], sort: Sort, familyName: (id: number | null) => string = () => ''): Job[] {
  const dir = sort.desc ? -1 : 1;
  const now = today();
  if (sort.key === 'build') {
    return [...list].sort((a, b) => (a.rating == null ? 1 : 0) - (b.rating == null ? 1 : 0)
      || (b.rating ?? 0) - (a.rating ?? 0) || (b.score ?? 0) - (a.score ?? 0)
      || a.created_at.localeCompare(b.created_at));
  }
  return [...list].sort((a, b) => {
    const av = value(a, sort.key, familyName);
    const bv = value(b, sort.key, familyName);
    if (sort.key === 'closes' && !sort.desc) {
      const rank = (v: string | number | null) => (v == null ? 1 : String(v) >= now ? 0 : 2);
      const ra = rank(av); const rb = rank(bv);
      if (ra !== rb) return ra - rb;
      if (av !== bv && av != null && bv != null) return ra === 2 ? (av > bv ? -1 : 1) : (av > bv ? 1 : -1);
      return (b.score ?? 0) - (a.score ?? 0);
    }
    if (av === bv) return (b.score ?? 0) - (a.score ?? 0);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av > bv ? dir : -dir;
  });
}

/** State remembered in this browser only (a sort, a filter). Storage can be missing or
 * blocked, so every read and write is allowed to fail and the default is used instead. */
export function usePersisted<T extends object>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initial : { ...initial, ...JSON.parse(raw) } as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* not remembered */ }
  }, [key, state]);
  return [state, setState];
}
