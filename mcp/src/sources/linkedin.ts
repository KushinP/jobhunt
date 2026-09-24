import type { RawJob } from '@jobhunt/core';

/**
 * LinkedIn has no job-search API, so this goes through an Apify actor on the user's own
 * account.
 *
 * valig/linkedin-jobs-scraper since 2026-09-18: $0.0004 per result plus $0.001 per start,
 * no minimum, full descriptions. The previous actor (cheap_scraper) refused fewer than 150
 * results a call, which made every search cost ~$0.11 and forced LinkedIn down to two
 * queries a day. This one costs about a cent a call, so every query can run daily.
 * `limit` is passed to the actor AND enforced on the way out, and a charge cap bounds spend
 * even if the actor ignores its own limit.
 */
export async function searchLinkedIn(opts: {
  token: string;
  actor?: string;
  query: string;
  location: string;
  limit?: number;
  days?: 1 | 7;
}): Promise<{ jobs: RawJob[]; error?: string }> {
  const actor = (opts.actor ?? 'valig~linkedin-jobs-scraper').replace('/', '~');
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const maxCharge = (0.002 + limit * 0.0004 * 1.2).toFixed(4);

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`
    + `?token=${encodeURIComponent(opts.token)}&timeout=120&memory=1024`
    + `&maxTotalChargeUsd=${maxCharge}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: opts.query,
        location: opts.location.toLowerCase() === 'remote' ? 'United States' : opts.location,
        ...(opts.location.toLowerCase() === 'remote' ? { urlParam: [{ key: 'f_WT', value: '2' }] } : {}),
        // Dropped before they are billed: every one of these is excluded by scoring anyway.
        titleExclude: ['senior', 'sr', 'director', 'vice president', 'head of', 'principal',
          'intern', 'internship', 'co-op'],
        datePosted: (opts.days ?? 1) === 1 ? 'r86400' : 'r604800',
        limit,
      }),
    });
    if (!res.ok) return { jobs: [], error: `apify ${res.status}: ${await res.text()}` };

    const items = await res.json() as Record<string, unknown>[];
    const jobs = items.slice(0, limit).map((it) => ({
      title: str(it.title ?? it.jobTitle),
      company: str(it.companyName ?? it.company),
      location: str(it.location) || null,
      url: str(it.url ?? it.jobUrl) || null,
      salary: salary(it.salary ?? it.salaryInfo),
      source: 'linkedin',
      source_job_id: str(it.id ?? it.jobId) || null,
      posted_at: toDate(it.postedDate ?? it.publishedAt),
      jd_text: str(it.description ?? it.jobDescription) || null,
    })).filter((j) => j.title && j.company);

    return { jobs };
  } catch (e) {
    return { jobs: [], error: String(e) };
  }
}

function salary(v: unknown): string | null {
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(' - ') || null;
  return str(v) || null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}

function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
