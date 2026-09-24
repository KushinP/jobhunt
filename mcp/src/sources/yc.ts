import type { RawJob } from '@jobhunt/core';

/**
 * Y Combinator's public job board (ycombinator.com/jobs, the logged-out face of Work at a
 * Startup). There is no API, but each page embeds its postings as JSON in a `data-page`
 * attribute, and each posting's own page embeds the full description, so no login and no
 * scraping of rendered HTML is needed.
 *
 * Observed 2026-09-18: role pages hold at most 50 postings and do not paginate. For cities
 * YC does not treat as a first-class location (Boston, New York), the role filter is ignored
 * and every role page returns the same 50 postings for that city, so a repeat is detected
 * and the remaining role pages for that city are skipped.
 */

const BASE = 'https://www.ycombinator.com';
const UA = 'Mozilla/5.0 (jobhunt-mcp; personal job search)';

/** Workers on the free plan may make 50 outbound requests per invocation. */
const FETCH_BUDGET = 45;

export const YC_ROLES = ['operations', 'product-manager', 'sales-manager', 'finance', 'support'] as const;

export interface YcPosting {
  id: number;
  title: string;
  url: string;
  location: string;
  salaryRange: string | null;
  minExperience: string | null;
  visa: string | null;
  role: string;
  /** "Full-time", "Part-time", "Contract" or "Internship" */
  type: string | null;
  companyName: string;
  companyBatchName: string | null;
  companyOneLiner: string | null;
  createdAt: string | null;
}

export interface YcListResult {
  postings: YcPosting[];
  pages: { path: string; count: number; skipped?: string }[];
  errors: { path: string; error: string }[];
  fetches: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** The Inertia page props embedded in a YC page. */
export function parseDataPage(html: string): Record<string, unknown> | null {
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return null;
  try {
    const page = JSON.parse(decodeEntities(m[1])) as { props?: Record<string, unknown> };
    return page.props ?? null;
  } catch {
    return null;
  }
}

async function getPage(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(BASE + path, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const props = parseDataPage(await res.text());
  if (!props) throw new Error('no embedded job data (YC may have changed the page)');
  return props;
}

/** YC's location slug for a target city name: "New York City" -> "new-york". */
export function ycLocationSlug(city: string): string {
  return city.toLowerCase().replace(/\bcity\b/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Whether a YC location string could be worked from the US. YC lists remote roles as
 * "Remote (US)", "Remote (IN; Pune, ...)" or bare "Remote"; the score's remote check would
 * otherwise accept a remote role restricted to another country.
 */
export function usEligible(location: string): boolean {
  return location.split(' / ').some((seg) => {
    const s = seg.trim();
    if (/^remote$/i.test(s)) return true;
    return /(,\s*US$)|\(US[;)]|\bUS\)|United States/.test(s);
  });
}

/** "3+ years" -> 3, "Any (new grads ok)" -> 0, unknown -> null. */
export function minYears(minExperience: string | null | undefined): number | null {
  if (!minExperience) return null;
  if (/any|new grad/i.test(minExperience)) return 0;
  const m = minExperience.match(/(\d+)\s*\+?\s*year/i);
  return m ? Number(m[1]) : null;
}

export async function listYcPostings(roles: readonly string[], locations: readonly string[]): Promise<YcListResult> {
  const out: YcListResult = { postings: [], pages: [], errors: [], fetches: 0 };
  const seen = new Set<number>();

  for (const loc of locations) {
    let firstIds: string | null = null;
    for (const role of roles) {
      const path = `/jobs/role/${role}/${loc}`;
      if (out.fetches >= FETCH_BUDGET) { out.pages.push({ path, count: 0, skipped: 'fetch budget' }); continue; }
      out.fetches++;
      let props: Record<string, unknown>;
      try {
        props = await getPage(path);
      } catch (e) {
        out.errors.push({ path, error: String(e) });
        continue;
      }
      const postings = (props.jobPostings as YcPosting[] | undefined) ?? [];
      const ids = postings.map((p) => p.id).sort().join(',');
      if (firstIds === null) {
        firstIds = ids;
      } else if (ids === firstIds && ids !== '') {
        // YC ignored the role for this city: every other role page will be the same list.
        out.pages.push({ path, count: postings.length, skipped: 'same list as the previous role; city pages ignore the role here' });
        break;
      }
      out.pages.push({ path, count: postings.length });
      for (const p of postings) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.postings.push(p);
      }
    }
  }
  return out;
}

/** Markdown to plain text, enough for scoring and for a person to read. */
function mdToText(md: string): string {
  return md
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The posting's full description, prefixed with the structured fields YC keeps separately. */
export async function fetchYcJob(p: YcPosting): Promise<RawJob> {
  const props = await getPage(p.url);
  const job = (props.job ?? {}) as { description?: string | null; interview_process?: string | null };
  const header = [
    `${p.companyName}${p.companyBatchName ? ` (YC ${p.companyBatchName})` : ''}${p.companyOneLiner ? `: ${p.companyOneLiner.trim()}` : ''}`,
    `Location: ${p.location}`,
    p.salaryRange ? `Salary: ${p.salaryRange}` : '',
    p.minExperience ? `Experience: ${p.minExperience}` : '',
    p.visa ? `Visa: ${p.visa}` : '',
  ].filter(Boolean).join('\n');
  const body = [job.description, job.interview_process ? `Interview process\n${job.interview_process}` : '']
    .filter(Boolean).map((s) => mdToText(s as string)).join('\n\n');
  return toRawJob(p, body ? `${header}\n\n${body}` : null);
}

export function toRawJob(p: YcPosting, jd: string | null): RawJob {
  return {
    title: p.title.trim(),
    company: p.companyName.trim(),
    location: p.location,
    salary: p.salaryRange || null,
    url: BASE + p.url,
    source: 'yc',
    source_job_id: String(p.id),
    posted_at: null,
    jd_text: jd,
  };
}

export { FETCH_BUDGET };
