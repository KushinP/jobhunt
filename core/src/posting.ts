import { htmlToText } from './html.ts';
import { closingDateFromJd, toIsoDate } from './dates.ts';
import { formatRange, salaryFromJd } from './salary.ts';

/**
 * Turns a job posting link into a role: title, company, location, salary and the full
 * description, so adding a role is pasting a link rather than retyping a posting.
 *
 * In order of trust: the applicant-tracking system's own API (Greenhouse, Lever), YC's
 * embedded page data, then the schema.org JobPosting block most career pages embed for
 * Google Jobs (LinkedIn, Ashby and company career sites all do). Only if none of those exist
 * does it fall back to the page title and raw page text.
 * Observed 2026-09-20: Indeed answers 401 to any automated fetch.
 */

export interface ResolvedPosting {
  ok: boolean;
  /** why nothing usable came back, in words the person can act on */
  reason?: string;
  via: 'greenhouse' | 'lever' | 'linkedin' | 'yc' | 'schema' | 'page' | 'none';
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  jd_text: string | null;
  posted_at?: string | null;
  /** the application deadline; closes_source says whether the posting stated it */
  closes_at?: string | null;
  closes_source?: 'stated' | 'listing' | null;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Board slug -> the display name already used for that company, so a role added from a
 * link dedupes against the same company's board postings ("Canary Technologies", not
 * Lever's "Canary Technologies Corp"). */
export type BoardNames = Record<string, string>;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return t || null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}


// ---- recognising links -------------------------------------------------------------------

export function greenhouseRef(raw: string): { slug: string | null; id: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (/(^|\.)greenhouse\.io$/.test(u.hostname) && m && m[1] !== 'embed') return { slug: m[1], id: m[2] };
  const token = u.searchParams.get('gh_jid') ?? (u.pathname.includes('job_app') ? u.searchParams.get('token') : null);
  if (token && /^\d+$/.test(token)) return { slug: u.searchParams.get('for'), id: token };
  return null;
}

export function leverRef(raw: string): { slug: string; id: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.hostname !== 'jobs.lever.co') return null;
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  return m ? { slug: m[1], id: m[2] } : null;
}

/** LinkedIn's job id from any of its link shapes: /jobs/view/123, /comm/jobs/view/123 (alert
 * emails), /jobs/view/some-title-at-company-123, or ?currentJobId=123 on a search page. */
export function linkedinJobId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
  return m?.[1] ?? u.searchParams.get('currentJobId');
}

/** Sites that refuse a server's request outright (observed 2026-09-21: 403 for both), so
 * nothing is spent fetching them. Their roles need a connector or the person's browser. */
export function blockedForServer(raw: string): string | null {
  try {
    const h = new URL(raw).hostname;
    if (/(^|\.)indeed\.com$/.test(h)) return 'Indeed';
    if (/(^|\.)ziprecruiter\.com$/.test(h)) return 'ZipRecruiter';
  } catch { /* not a url */ }
  return null;
}

export function isYcJob(raw: string): boolean {
  try {
    const u = new URL(raw);
    return /(^|\.)ycombinator\.com$/.test(u.hostname) && /^\/companies\/[^/]+\/jobs\//.test(u.pathname);
  } catch { return false; }
}

/** A careers site's Greenhouse slug is usually its brand: careers.formlabs.com -> formlabs. */
export function slugGuesses(raw: string): string[] {
  try {
    const parts = new URL(raw).hostname.split('.').filter((p) => !['www', 'careers', 'jobs', 'boards', 'job-boards', 'apply'].includes(p));
    return [...new Set(parts.slice(0, -1))];
  } catch { return []; }
}

// ---- parsing pages -----------------------------------------------------------------------

/** The schema.org JobPosting a page embeds for search engines, if any. */
export function jobPostingFromHtml(html: string): Omit<ResolvedPosting, 'ok' | 'via' | 'url'> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const items: unknown[] = Array.isArray(data) ? data
      : (data && typeof data === 'object' && Array.isArray((data as { '@graph'?: unknown[] })['@graph']))
        ? (data as { '@graph': unknown[] })['@graph'] : [data];
    for (const it of items) {
      const p = it as Record<string, any>;
      const type = p?.['@type'];
      if (!(type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting')))) continue;
      const org = p.hiringOrganization;
      const locs = Array.isArray(p.jobLocation) ? p.jobLocation : p.jobLocation ? [p.jobLocation] : [];
      const places = locs.map((l: any) => {
        const a = l?.address ?? {};
        return [a.addressLocality, a.addressRegion].filter(Boolean).join(', ') || clean(a.addressCountry?.name ?? a.addressCountry);
      }).filter(Boolean);
      const remote = /telecommute/i.test(String(p.jobLocationType ?? ''));
      const location = [...new Set(places)].join(' / ') + (remote ? (places.length ? ' / Remote' : 'Remote') : '');
      const v = p.baseSalary?.value ?? {};
      const salary = typeof v === 'object'
        ? formatRange(Number(v.minValue ?? v.value) || null, Number(v.maxValue) || null, v.unitText)
        : null;
      // validThrough is when the listing expires, which boards set themselves (LinkedIn: 30
      // days after posting), so it is kept apart from a deadline the posting states.
      const closes = toIsoDate(p.validThrough);
      return {
        title: clean(p.title),
        company: clean(typeof org === 'string' ? org : org?.name),
        location: location || null,
        salary,
        jd_text: htmlToText(decodeEntities(String(p.description ?? ''))) || null,
        posted_at: toIsoDate(p.datePosted),
        closes_at: closes,
        closes_source: closes ? 'listing' as const : null,
      };
    }
  }
  return null;
}

export function pageTitle(html: string): string | null {
  return clean(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{2,300})["']/i)?.[1]
    ?? html.match(/<title[^>]*>([^<]{2,300})<\/title>/i)?.[1]);
}

// ---- resolving ---------------------------------------------------------------------------

async function getJson(fetcher: Fetcher, url: string): Promise<any | null> {
  const res = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  return res.ok ? res.json() : null;
}

async function viaGreenhouse(fetcher: Fetcher, url: string, names: BoardNames): Promise<ResolvedPosting | null> {
  const ref = greenhouseRef(url);
  if (!ref) return null;
  for (const slug of ref.slug ? [ref.slug] : slugGuesses(url)) {
    const j = await getJson(fetcher,
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${ref.id}?pay_transparency=true`);
    if (!j?.title) continue;
    const pay = Array.isArray(j.pay_input_ranges) ? j.pay_input_ranges[0] : null;
    return {
      ok: true, via: 'greenhouse', url: j.absolute_url ?? url,
      title: clean(j.title), company: names[slug.toLowerCase()] ?? clean(j.company_name) ?? slug,
      location: clean(j.location?.name),
      salary: pay ? formatRange(pay.min_cents / 100, pay.max_cents / 100) : null,
      jd_text: htmlToText(j.content) || null,
      posted_at: toIsoDate(j.first_published ?? j.updated_at),
    };
  }
  return null;
}

async function viaLever(fetcher: Fetcher, url: string, names: BoardNames): Promise<ResolvedPosting | null> {
  const ref = leverRef(url);
  if (!ref) return null;
  const j = await getJson(fetcher, `https://api.lever.co/v0/postings/${encodeURIComponent(ref.slug)}/${ref.id}`);
  if (!j?.text) return null;
  // Lever's API has no company name; its page title reads "Company - Role".
  let company: string | null = null;
  try {
    const page = await fetcher(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
    const t = page.ok ? pageTitle(await page.text()) : null;
    if (t && t.includes(' - ')) company = t.slice(0, t.indexOf(' - ')).trim();
  } catch { /* the slug will do */ }
  const lists = (j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
  const s = j.salaryRange;
  return {
    ok: true, via: 'lever', url: j.hostedUrl ?? url,
    title: clean(j.text), company: names[ref.slug.toLowerCase()] ?? company ?? ref.slug,
    location: [clean(j.categories?.location), j.workplaceType === 'remote' ? 'Remote' : null].filter(Boolean).join(' / ') || null,
    salary: s ? formatRange(s.min, s.max, s.interval) : null,
    jd_text: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n').trim() || null,
    posted_at: typeof j.createdAt === 'number' ? new Date(j.createdAt).toISOString().slice(0, 10) : null,
  };
}

/** LinkedIn's public job endpoint: the posting alone, without the login wall its job pages show
 * to a server. Its markup is stable class names rather than structured data. */
async function viaLinkedIn(fetcher: Fetcher, url: string, retryMs: number): Promise<ResolvedPosting | null> {
  const id = linkedinJobId(url);
  if (!id) return null;
  // From Cloudflare's network LinkedIn answers 429 to requests close together (observed
  // 2026-09-21); a short back-off usually gets the posting on a second try.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, retryMs * attempt));
    const res = await fetcher(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`,
      { headers: { 'user-agent': UA, accept: 'text/html' } });
    if (res.status === 429) continue;
    if (!res.ok) return null;
    return linkedinFromHtml(await res.text(), `https://www.linkedin.com/jobs/view/${id}/`);
  }
  return {
    ok: false, via: 'none', url, reason: RATE_LIMITED,
    title: null, company: null, location: null, salary: null, jd_text: null,
  };
}

/** The reason a LinkedIn read gives when LinkedIn is throttling: temporary, not a dead posting. */
export const RATE_LIMITED = 'LinkedIn is rate-limiting requests right now (429); try again later';

export function linkedinFromHtml(html: string, url: string): ResolvedPosting | null {
  const pick = (re: RegExp) => clean(htmlToText(html.match(re)?.[1] ?? ''));
  const title = pick(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/);
  const body = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>\s*(?:<button|<\/section>)/)?.[1]
    ?? html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1];
  if (!title || !body) return null;
  const criteria = [...html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => `${clean(m[1])}: ${clean(m[2])}`).join('\n');
  const pay = pick(/compensation__salary[^>]*>([\s\S]*?)<\/div>/);
  return {
    ok: true, via: 'linkedin', url,
    title,
    company: pick(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/) ?? pick(/topcard__flavor[^>]*>([\s\S]*?)<\/span>/),
    location: pick(/topcard__flavor topcard__flavor--bullet"[^>]*>([\s\S]*?)<\/span>/),
    salary: pay && /\$\s*\d/.test(pay) ? pay : null,
    jd_text: [htmlToText(decodeEntities(body)), criteria].filter(Boolean).join('\n\n') || null,
  };
}

function viaYc(html: string, url: string): ResolvedPosting | null {
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return null;
  let props: any;
  try { props = JSON.parse(decodeEntities(m[1])).props; } catch { return null; }
  const job = props?.job;
  if (!job?.title) return null;
  const header = [job.minExperience ? `Experience: ${job.minExperience}` : '', job.visa ? `Visa: ${job.visa}` : '']
    .filter(Boolean).join('\n');
  return {
    ok: true, via: 'yc', url,
    title: clean(job.title), company: clean(job.companyName ?? props.company?.name),
    location: clean(job.location), salary: clean(job.salaryRange),
    jd_text: [header, job.description, job.interview_process].filter(Boolean).join('\n\n')
      .replace(/\*\*|__/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\\([*_#-])/g, '$1') || null,
  };
}

export async function resolvePosting(
  url: string, fetcher: Fetcher = fetch, names: BoardNames = {}, opts: { retryMs?: number } = {},
): Promise<ResolvedPosting> {
  return withDetails(await resolveRaw(url, fetcher, names, opts.retryMs ?? 4000));
}

/** Pay and a deadline the description states, when the source's own fields had none. A
 * deadline the posting states outranks a listing's expiry. */
function withDetails(r: ResolvedPosting): ResolvedPosting {
  if (!r.ok || !r.jd_text) return r;
  const stated = closingDateFromJd(r.jd_text);
  return {
    ...r,
    salary: r.salary ?? salaryFromJd(r.jd_text),
    closes_at: stated ?? r.closes_at ?? null,
    closes_source: stated ? 'stated' : r.closes_source ?? null,
  };
}

async function resolveRaw(url: string, fetcher: Fetcher, names: BoardNames, retryMs: number): Promise<ResolvedPosting> {
  const empty = { title: null, company: null, location: null, salary: null, jd_text: null };
  let target: URL;
  try {
    target = new URL(url.trim());
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    return { ok: false, via: 'none', url, reason: 'That does not look like a link.', ...empty };
  }
  const href = target.toString();

  try {
    const gh = await viaGreenhouse(fetcher, href, names);
    if (gh) return gh;
    const lv = await viaLever(fetcher, href, names);
    if (lv) return lv;
    const li = await viaLinkedIn(fetcher, href, retryMs);
    if (li) return li;
  } catch { /* fall through to the page itself */ }

  let res: Response;
  try {
    res = await fetcher(href, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' });
  } catch (e) {
    return { ok: false, via: 'none', url: href, reason: `Could not reach the page (${String(e)}).`, ...empty };
  }
  if (!res.ok) {
    const blocked = [401, 403, 429, 999].includes(res.status);
    return {
      ok: false, via: 'none', url: href, ...empty,
      reason: blocked
        ? `${target.hostname} blocks automated reading (it answered ${res.status}). Paste the job description instead.`
        : `The page answered ${res.status}.`,
    };
  }
  const html = (await res.text()).slice(0, 1_500_000);

  if (isYcJob(href)) {
    const yc = viaYc(html, href);
    if (yc) return yc;
  }
  const schema = jobPostingFromHtml(html);
  if (schema?.title) return { ok: true, via: 'schema', url: href, ...schema };

  // Last resort: the page's own title and text. The title often reads "Role at Company" or
  // "Role @ Company", which is worth splitting; anything else the person corrects.
  const t = pageTitle(html);
  const split = t?.match(/^(.+?)\s+(?:at|@|-|\|)\s+(.+?)(?:\s+[|-]\s+.*)?$/i);
  const text = htmlToText(html);
  return {
    ok: text.length > 200, via: 'page', url: href,
    reason: text.length > 200 ? undefined : 'The page had no readable posting. It may need JavaScript; paste the description instead.',
    title: split ? split[1].trim() : t, company: split ? split[2].trim() : null,
    location: null, salary: null, jd_text: text ? text.slice(0, 20_000) : null,
  };
}

/** Display names from the target_boards config ("slug" or "slug:Display Name"). */
export function boardNames(boards: { greenhouse?: string[]; lever?: string[]; ashby?: string[] } | undefined): BoardNames {
  const out: BoardNames = {};
  for (const list of [boards?.greenhouse, boards?.lever, boards?.ashby]) {
    for (const entry of list ?? []) {
      const i = entry.indexOf(':');
      if (i > 0) out[entry.slice(0, i).trim().toLowerCase()] = entry.slice(i + 1).trim();
    }
  }
  return out;
}
