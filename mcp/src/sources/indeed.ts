import type { RawJob } from '@jobhunt/core';

/**
 * Indeed through an Apify actor on the user's own account. Claude's Indeed connector failed
 * to connect after OAuth (2026-09-18), and a dead connector looks exactly like a quiet day,
 * so Indeed goes through the same APIFY_TOKEN as LinkedIn instead.
 *
 * valig/indeed-jobs-scraper was chosen on 2026-09-18: ~$0.0001 per result plus $0.001 per
 * start (borderline/indeed-scraper is $0.005 per result, 50x more), 30k users, 4.7 stars,
 * and it returns the full description and the employer's own apply URL.
 */
export async function searchIndeed(opts: {
  token: string;
  actor?: string;
  query: string;
  location: string;
  limit?: number;
  days?: 1 | 3 | 7 | 14;
}): Promise<{ jobs: RawJob[]; error?: string }> {
  const actor = (opts.actor ?? 'valig~indeed-jobs-scraper').replace('/', '~');
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const maxCharge = (0.001 + limit * 0.0001 * 1.1 + 0.001).toFixed(4);

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`
    + `?token=${encodeURIComponent(opts.token)}&timeout=120&memory=512`
    + `&maxTotalChargeUsd=${maxCharge}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        country: 'us', title: opts.query, location: opts.location,
        limit, datePosted: String(opts.days ?? 1),
      }),
    });
    if (!res.ok) return { jobs: [], error: `apify ${res.status}: ${await res.text()}` };

    const items = await res.json() as Record<string, any>[];
    const jobs = items.slice(0, limit).map((it) => ({
      title: str(it.title),
      company: str(it.employer?.name ?? it.companyName),
      location: [str(it.location?.city), str(it.location?.admin1Code)].filter(Boolean).join(', ') || null,
      url: str(it.url ?? it.jobUrl) || null,
      salary: salary(it.baseSalary),
      source: 'indeed',
      source_job_id: str(it.key) || null,
      posted_at: toDate(it.datePublished ?? it.dateOnIndeed),
      jd_text: str(it.description?.text) || null,
    })).filter((j) => j.title && j.company);

    return { jobs };
  } catch (e) {
    return { jobs: [], error: String(e) };
  }
}

function salary(s: any): string | null {
  if (!s || (s.min == null && s.max == null)) return null;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const range = [s.min, s.max].filter((n) => n != null).map(fmt).join(' - ');
  const unit = str(s.unitOfWork).toUpperCase();
  return unit && unit !== 'YEAR' ? `${range} per ${unit.toLowerCase()}` : range;
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
