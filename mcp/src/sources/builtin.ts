import type { RawJob } from '@jobhunt/core';

/**
 * Built In (builtin.com, including Built In Boston) through an Apify actor.
 *
 * solidcode/builtin-scraper, chosen 2026-09-18: ~$0.00095 per result, full descriptions,
 * and filters for location, experience level and posted date. A test without the level
 * filter returned 18 of 18 Senior/Director roles, so the level filter is not optional.
 * It takes a single level per run, so entry-level and junior are two runs.
 */
export async function searchBuiltIn(opts: {
  token: string;
  queries: string[];
  location: string;
  perQuery?: number;
  days?: 1 | 3 | 7;
}): Promise<{ jobs: RawJob[]; error?: string; warnings?: string[] }> {
  const perQuery = Math.min(Math.max(opts.perQuery ?? 15, 1), 50);
  const all: RawJob[] = [];
  const errors: string[] = [];

  for (const level of ['entry-level', 'junior']) {
    const cap = (0.001 + opts.queries.length * perQuery * 0.00095 * 1.3).toFixed(4);
    const url = 'https://api.apify.com/v2/acts/solidcode~builtin-scraper/run-sync-get-dataset-items'
      + `?token=${encodeURIComponent(opts.token)}&timeout=240&memory=1024&maxTotalChargeUsd=${cap}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          searchQueries: opts.queries, location: opts.location, experienceLevel: level,
          postedWithinDays: String(opts.days ?? 3), maxResultsPerQuery: perQuery,
          fetchDescription: true,
        }),
      });
      if (!res.ok) { errors.push(`${level}: apify ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
      const items = await res.json() as Record<string, unknown>[];
      for (const it of items) {
        const min = Number(it.salaryMin); const max = Number(it.salaryMax);
        const period = str(it.salaryPeriod).toLowerCase();
        const pay = Number.isFinite(max) && max > 0 && (!period || period.startsWith('year') || period === 'annually')
          ? `$${Math.round(min || max).toLocaleString('en-US')} - $${Math.round(max).toLocaleString('en-US')}`
          : str(it.salaryText) || null;
        all.push({
          title: str(it.title), company: str(it.company),
          location: str(it.location) || null, url: str(it.jobUrl) || null, salary: pay,
          source: 'builtin', source_job_id: str(it.jobId) || null,
          posted_at: str(it.postedDate).slice(0, 10) || null,
          jd_text: str(it.description) || null,
        });
      }
    } catch (e) {
      errors.push(`${level}: ${String(e)}`);
    }
  }

  const seen = new Set<string>();
  const jobs = all.filter((j) => j.title && j.company && !seen.has(j.source_job_id ?? `${j.title}|${j.company}`)
    && seen.add(j.source_job_id ?? `${j.title}|${j.company}`));
  // All runs failing is an error; one level failing while the other returned jobs is a warning
  // the caller reports, so a half-broken source is not mistaken for a quiet day.
  return jobs.length
    ? { jobs, warnings: errors.length ? errors : undefined }
    : { jobs, error: errors.length ? errors.join('; ') : undefined };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}
