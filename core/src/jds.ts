import type { Config, JobStatus } from './types.ts';
import type { D1Like } from './repo.ts';
import { attachJd } from './repo.ts';
import { RATE_LIMITED, blockedForServer, linkedinJobId, resolvePosting } from './posting.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface JdFetchResult {
  attached: { id: string; title: string; company: string; score: number; from: JobStatus; to: JobStatus; via: string }[];
  /** read and failed here; retried by the server after three days */
  failed: { id: string; title: string; company: string; url: string; reason: string }[];
  /** on a site that refuses servers (Indeed, ZipRecruiter): a connector or the browser has to read these */
  needs_connector: { id: string; title: string; company: string; source: string; site: string; score: number }[];
  /** roles still waiting for a JD that this call did not reach */
  remaining: number;
  /** LinkedIn stopped answering part way; the rest are untouched and the next call retries them */
  rate_limited: boolean;
  dry_run: boolean;
}

const MIN_JD = 800;
const RETRY_AFTER = "datetime('now', '-3 days')";

/**
 * Reads missing job descriptions on the server, where a posting page is fetched like a
 * browser would rather than through Claude's fetcher (which obeys robots.txt and cannot open
 * LinkedIn). LinkedIn goes through its public job endpoint; Greenhouse, Lever, YC and
 * schema.org pages as in add_role. Indeed and ZipRecruiter refuse servers, so they are
 * listed for a connector instead of being fetched. Raw page text is never attached: scoring
 * a role on a site's navigation would move it on noise.
 */
export async function fetchMissingJds(db: D1Like, cfg: Config, opts: {
  ids?: string[]; limit?: number; dryRun?: boolean; fetcher?: Fetcher;
  /** pause between LinkedIn reads, and the back-off step after a 429 */
  gapMs?: number; retryMs?: number;
} = {}): Promise<JdFetchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const gap = opts.gapMs ?? 2500;
  const out: JdFetchResult = {
    attached: [], failed: [], needs_connector: [], remaining: 0, rate_limited: false, dry_run: !!opts.dryRun,
  };
  const missing = '(jd_text IS NULL OR length(jd_text) < 800) AND url IS NOT NULL';
  type Row = { id: string; title: string; company: string; url: string; source: string; score: number; status: JobStatus };

  const rows = opts.ids?.length
    ? (await db.prepare(
      `SELECT id, title, company, url, source, score, status FROM jobs
       WHERE id IN (${opts.ids.map(() => '?').join(', ')}) AND ${missing}`,
    ).bind(...opts.ids).all<Row>()).results
    : (await db.prepare(
      `SELECT id, title, company, url, source, score, status FROM jobs
       WHERE status IN ('New', 'Generate') AND ${missing}
         AND (jd_fetch_failed_at IS NULL OR jd_fetch_failed_at < ${RETRY_AFTER})
       ORDER BY status = 'Generate' DESC, score DESC LIMIT 300`,
    ).bind().all<Row>()).results;

  let fetched = 0;
  let lastWasLinkedIn = false;
  for (const r of rows) {
    const site = blockedForServer(r.url);
    if (site) {
      if (out.needs_connector.length < 25) {
        out.needs_connector.push({ id: r.id, title: r.title, company: r.company, source: r.source, site, score: r.score });
      }
      continue;
    }
    const isLinkedIn = linkedinJobId(r.url) !== null;
    if (fetched >= limit || (out.rate_limited && isLinkedIn)) { out.remaining++; continue; }
    fetched++;
    if (isLinkedIn && lastWasLinkedIn && gap) await new Promise((res) => setTimeout(res, gap));
    lastWasLinkedIn = isLinkedIn;
    let reason: string | null = null;
    try {
      const p = await resolvePosting(r.url, opts.fetcher ?? fetch, {}, { retryMs: opts.retryMs });
      if (!p.ok && p.reason === RATE_LIMITED) {
        // throttled, not unreadable: leave it untouched for the next call
        out.rate_limited = true;
        out.remaining++;
        continue;
      }
      if (!p.ok) reason = p.reason ?? 'no posting found';
      else if (p.via === 'page') reason = 'no structured posting on the page; open it and attach_jd the description';
      else if ((p.jd_text ?? '').length < MIN_JD) reason = 'the posting text is too short to be the full description';
      else if (!opts.dryRun) {
        await db.prepare(
          `UPDATE jobs SET salary = COALESCE(NULLIF(salary, ''), ?), location = COALESCE(location, ?),
             posted_at = COALESCE(posted_at, ?), jd_fetch_failed_at = NULL WHERE id = ?`,
        ).bind(p.salary, p.location, p.posted_at ?? null, r.id).run();
        const a = await attachJd(db, cfg, r.id, p.jd_text!, true);
        out.attached.push({ id: r.id, title: r.title, company: r.company, score: a.score.score, from: a.from, to: a.to, via: p.via });
      } else {
        out.attached.push({ id: r.id, title: r.title, company: r.company, score: r.score, from: r.status, to: r.status, via: p.via });
      }
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      // Workers cap requests per call; stop cleanly and leave the rest for the next call
      if (/too many subrequests/i.test(reason)) { out.remaining += 1; break; }
    }
    if (reason) {
      out.failed.push({ id: r.id, title: r.title, company: r.company, url: r.url, reason });
      if (!opts.dryRun) {
        await db.prepare("UPDATE jobs SET jd_fetch_failed_at = datetime('now') WHERE id = ?").bind(r.id).run();
      }
    }
  }
  return out;
}
