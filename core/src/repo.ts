import type {
  Actor, ClosesSource, Config, IngestResult, JobStatus, RawJob, ScoreResult,
} from './types.ts';
import { HUMAN_ONLY_STATUSES } from './types.ts';
import { mergeConfig } from './config.ts';
import { dedupeKeys, normalizeKey } from './normalize.ts';
import { scoreJob, statusForScore } from './score.ts';
import { salaryFromJd } from './salary.ts';
import { closingDateFromJd, toIsoDate } from './dates.ts';

/** Minimal shape of the D1 binding, so core stays testable against a fake. */
export interface D1Statement {
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Like {
  prepare(sql: string): D1Statement & {
    bind(...values: unknown[]): D1Statement;
  };
}

/** A role rated this many stars or fewer is never queued or built: the person does not want it. */
export const LOW_RATING = 2;

export class HumanOnlyStatusError extends Error {
  constructor(status: JobStatus) {
    super(`status "${status}" is human-only; automation may not set it`);
    this.name = 'HumanOnlyStatusError';
  }
}

export async function loadConfig(db: D1Like): Promise<Config> {
  const { results } = await db.prepare('SELECT key, value FROM config').all<{ key: string; value: string }>();
  return mergeConfig(results);
}

export async function putConfig(db: D1Like, key: string, value: unknown, note?: string): Promise<void> {
  await db.prepare(
    `INSERT INTO config (key, value, note, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       note = COALESCE(excluded.note, config.note), updated_at = datetime('now')`,
  ).bind(key, JSON.stringify(value), note ?? null).run();
}

/** The deadline to store for a role: one the source or person gives, else one the JD states,
 * else the listing's expiry. A stated deadline outranks a listing's expiry. */
export function closesFor(raw: Pick<RawJob, 'closes_at' | 'closes_source' | 'jd_text'>): {
  at: string | null; source: ClosesSource | null;
} {
  const given = toIsoDate(raw.closes_at);
  const givenSource: ClosesSource = raw.closes_source ?? 'stated';
  if (given && givenSource !== 'listing') return { at: given, source: givenSource };
  const fromJd = closingDateFromJd(raw.jd_text);
  if (fromJd) return { at: fromJd, source: 'stated' };
  return given ? { at: given, source: 'listing' } : { at: null, source: null };
}

// Replaces the stored deadline only when there is none, or the stored one is a listing's
// expiry and this one is stated. One the person set is never replaced. Binds: at, source, at,
// source (the expressions read the row as it was before the update).
const CLOSES_SET = `
  closes_at = CASE WHEN ? IS NOT NULL AND (closes_at IS NULL OR (closes_source = 'listing' AND ? = 'stated'))
                   THEN ? ELSE closes_at END,
  closes_source = CASE WHEN ? IS NOT NULL AND (closes_at IS NULL OR (closes_source = 'listing' AND ? = 'stated'))
                   THEN ? ELSE closes_source END`;
const closesBinds = (c: { at: string | null; source: ClosesSource | null }) =>
  [c.at, c.source, c.at, c.at, c.source, c.source];

/**
 * The single write path for every source adapter. Idempotent on the dedupe key:
 * a repost under a new URL enriches the existing row and never re-statuses it, so a
 * role the human already marked Skip does not come back as New tomorrow.
 */
export async function ingestJobs(
  db: D1Like, cfg: Config, source: string, jobs: RawJob[],
): Promise<IngestResult> {
  const out: IngestResult = {
    found: 0, kept: 0, auto_generate: 0, duplicates: 0, discarded: 0,
    errors: [], inserted: [],
  };

  for (const raw of jobs ?? []) {
    out.found++;
    const title = (raw?.title ?? '').trim();
    const company = (raw?.company ?? '').trim();
    if (!title || !company) {
      out.errors.push({ reason: 'missing title or company', raw });
      continue;
    }

    const key = normalizeKey(title, company);
    const existing = await findExisting(db, title, company, raw.source ?? source, raw.source_job_id);

    const salary = raw.salary?.trim() || salaryFromJd(raw.jd_text);
    const closes = closesFor(raw);

    if (existing) {
      out.duplicates++;
      await db.prepare(
        `UPDATE jobs SET
           jd_text       = COALESCE(jd_text, ?),
           jd_fetched_at = CASE WHEN jd_text IS NULL AND ? IS NOT NULL
                                THEN datetime('now') ELSE jd_fetched_at END,
           salary        = COALESCE(salary, ?),
           posted_at     = COALESCE(posted_at, ?),
           url           = COALESCE(url, ?),
           ${CLOSES_SET},
           updated_at    = datetime('now')
         WHERE id = ?`,
      ).bind(
        raw.jd_text ?? null, raw.jd_text ?? null, salary,
        toIsoDate(raw.posted_at) ?? raw.posted_at ?? null, raw.url ?? null,
        ...closesBinds(closes), existing.id,
      ).run();
      // A role held for its JD that another source now supplies one for is judged on it, the
      // same as attach_jd; otherwise it would sit in New with a JD and never be scored on it.
      if (existing.needs_jd && (raw.jd_text ?? '').trim().length >= 800) {
        await attachJd(db, cfg, existing.id, raw.jd_text!, true);
      }
      continue;
    }

    const sc: ScoreResult = scoreJob(cfg, {
      title, company, location: raw.location, jd: raw.jd_text, salary,
    });
    const status = statusForScore(sc);
    const id = crypto.randomUUID();

    try {
      await db.prepare(
        `INSERT INTO jobs (
           id, title, company, location, salary, url, source, source_job_id,
           posted_at, jd_text, jd_fetched_at, archetype, score, score_breakdown,
           status, status_changed_at, drop_reason, normalized_key, closes_at, closes_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`,
      ).bind(
        id, title, company, raw.location ?? null, salary, raw.url ?? null,
        raw.source ?? source, raw.source_job_id ?? null, toIsoDate(raw.posted_at) ?? raw.posted_at ?? null,
        raw.jd_text ?? null, raw.jd_text ? new Date().toISOString() : null,
        sc.archetype, sc.score, JSON.stringify(sc.breakdown), status, sc.drop_reason, key,
        closes.at, closes.source,
      ).run();
    } catch (err) {
      // The UNIQUE index is the real guard; this catches a race between the
      // SELECT above and this INSERT.
      if (String(err).includes('UNIQUE')) { out.duplicates++; continue; }
      out.errors.push({ reason: String(err), raw });
      continue;
    }

    if (status === 'Discarded') {
      out.discarded++;
    } else {
      out.kept++;
      if (status === 'Generate') out.auto_generate++;
      out.inserted.push({ id, title, company, score: sc.score, status, needs_jd: sc.needs_jd });
    }
  }

  return out;
}

/**
 * The row a sighting belongs to, if any. The source's own job id is checked first: one LinkedIn
 * posting arrived twice under two titles ("Financial Analyst" and "Financial Analyst
 * *Full-time, Day* (Hanford)"). Then the title and company key, in its current form and the
 * form older rows were stored under.
 */
async function findExisting(
  db: D1Like, title: string, company: string, source: string, sourceJobId: string | null | undefined,
): Promise<{ id: string; needs_jd: number } | null> {
  const cols = 'id, jd_text IS NULL OR length(jd_text) < 800 AS needs_jd';
  if (sourceJobId) {
    const bySource = await db.prepare(`SELECT ${cols} FROM jobs WHERE source = ? AND source_job_id = ? LIMIT 1`)
      .bind(source, sourceJobId).first<{ id: string; needs_jd: number }>();
    if (bySource) return bySource;
  }
  return db.prepare(`SELECT ${cols} FROM jobs WHERE normalized_key IN (?, ?) LIMIT 1`)
    .bind(...dedupeKeys(title, company)).first<{ id: string; needs_jd: number }>();
}

/** Status writes go through here so the actor rule is enforced in one place. */
export async function setStatus(
  db: D1Like, jobId: string, status: JobStatus, actor: Actor, note?: string,
): Promise<{ id: string; from: JobStatus; to: JobStatus }> {
  if (actor === 'automation' && HUMAN_ONLY_STATUSES.includes(status)) {
    throw new HumanOnlyStatusError(status);
  }
  const row = await db.prepare('SELECT status FROM jobs WHERE id = ?')
    .bind(jobId).first<{ status: JobStatus }>();
  if (!row) throw new Error(`no such job ${jobId}`);
  // The mirror image of the rule above: an Applied role moved to Skip by a run would silently
  // drop out of follow-ups and metrics.
  if (actor === 'automation' && HUMAN_ONLY_STATUSES.includes(row.status) && row.status !== status) {
    throw new Error(`the role is ${row.status}, which a person set; automation may not change it`);
  }
  // A role the person rated 1 or 2 stars is one they do not want built, so it cannot be queued.
  if (status === 'Generate' && row.status !== 'Generate') {
    const r = await db.prepare('SELECT rating FROM jobs WHERE id = ?').bind(jobId).first<{ rating: number | null }>();
    if (r?.rating != null && r.rating <= LOW_RATING) {
      throw new Error(`You rated this role ${r.rating} star${r.rating === 1 ? '' : 's'}, so it is not built. `
        + 'Raise the rating to 3 or more to queue it.');
    }
  }
  // Ready (Complete) promises a built resume; the board and the build run both rely on it.
  if (status === 'Complete' && row.status !== 'Complete') {
    const resume = await db.prepare("SELECT 1 AS x FROM documents WHERE job_id = ? AND kind = 'resume' LIMIT 1")
      .bind(jobId).first();
    if (!resume) {
      throw new Error('Ready means the resume is built, and this role has none yet. Queue it '
        + '(Generate) to have the documents built.');
    }
  }

  // A "not a fit" verdict belongs to the Skip it came with: restoring the role withdraws it.
  await db.prepare(
    `UPDATE jobs SET status = ?, status_changed_at = datetime('now'),
       updated_at = datetime('now'), notes = COALESCE(?, notes),
       not_fit_reason = CASE WHEN ? = 'Skip' THEN not_fit_reason END WHERE id = ?`,
  ).bind(status, note ?? null, status, jobId).run();

  await db.prepare(
    `INSERT INTO status_history (job_id, from_status, to_status, actor)
     VALUES (?, ?, ?, ?)`,
  ).bind(jobId, row.status, status, actor).run();

  return { id: jobId, from: row.status, to: status };
}

/** Who put a role in its current status: "you" (the person, in the dashboard or in their own
 * words in a chat), "automation", or null when the scorer set it on arrival (ingest writes no
 * history row). Automation must not undo a "you". */
export async function statusSetBy(db: D1Like, jobId: string): Promise<'you' | 'automation' | null> {
  const row = await db.prepare(
    `SELECT h.actor FROM status_history h JOIN jobs j ON j.id = h.job_id
     WHERE h.job_id = ? AND h.to_status = j.status ORDER BY h.id DESC LIMIT 1`,
  ).bind(jobId).first<{ actor: string }>();
  return !row ? null : row.actor === 'automation' ? 'automation' : 'you';
}

export async function rescoreJob(db: D1Like, cfg: Config, jobId: string): Promise<ScoreResult> {
  const job = await db.prepare(
    'SELECT title, company, location, jd_text, salary FROM jobs WHERE id = ?',
  ).bind(jobId).first<{ title: string; company: string; location: string | null;
    jd_text: string | null; salary: string | null }>();
  if (!job) throw new Error(`no such job ${jobId}`);

  const sc = scoreJob(cfg, { ...job, jd: job.jd_text });
  // Score and archetype are refreshed; status is deliberately left alone so a human
  // decision already recorded is never overwritten by a re-score.
  await db.prepare(
    `UPDATE jobs SET score = ?, score_breakdown = ?, archetype = ?, drop_reason = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(sc.score, JSON.stringify(sc.breakdown), sc.archetype, sc.drop_reason, jobId).run();
  return sc;
}

/**
 * Fields on a role the person can correct by hand: a salary the source never gave, a location
 * written as a code, a link that goes to the wrong place. Title and company are deliberately
 * not here: the duplicate key is built from them, so changing one would split a role in two.
 * An empty string clears a field; a field left out is untouched.
 */
export async function updateJobDetails(db: D1Like, jobId: string, patch: {
  salary?: string | null; location?: string | null; url?: string | null;
}): Promise<{ salary: string | null; location: string | null; url: string | null }> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const field of ['salary', 'location', 'url'] as const) {
    const v = patch[field];
    if (v === undefined) continue;
    const clean = typeof v === 'string' ? v.trim() : null;
    if (field === 'url' && clean && !/^https?:\/\/\S+$/.test(clean)) throw new Error('the link must start with http:// or https://');
    sets.push(`${field} = ?`);
    binds.push(clean || null);
  }
  if (!sets.length) throw new Error('nothing to change');
  const row = await db.prepare(
    `UPDATE jobs SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?
     RETURNING salary, location, url`,
  ).bind(...binds, jobId).first<{ salary: string | null; location: string | null; url: string | null }>();
  if (!row) throw new Error(`no such job ${jobId}`);
  return row;
}

/** Your own 1-5 rating. Kept separate from `score` so the two can be compared: if they
 * never disagree the rubric adds nothing, and if they always disagree the weights are wrong. */
export async function setRating(
  db: D1Like, jobId: string, rating: number | null, actor: Actor = 'human',
): Promise<{ moved_to: JobStatus | null }> {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new Error('rating must be an integer from 1 to 5, or null to clear it');
  }
  const res = await db.prepare(
    `UPDATE jobs SET rating = ?, rated_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(rating, rating, jobId).run() as { meta?: { changes?: number } };
  if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no such job ${jobId}`);
  // Rating a queued role 1 or 2 stars takes it out of the build queue, back to New.
  if (rating !== null && rating <= LOW_RATING) {
    const row = await db.prepare('SELECT status FROM jobs WHERE id = ?').bind(jobId).first<{ status: JobStatus }>();
    if (row?.status === 'Generate') {
      await setStatus(db, jobId, 'New', actor, `Rated ${rating} star${rating === 1 ? '' : 's'}: taken out of Queued, not built`);
      return { moved_to: 'New' };
    }
  }
  return { moved_to: null };
}

/** YC hosts: Work at a Startup and the ycombinator.com company job pages. */
const YC_URL = /^https?:\/\/(www\.)?(workatastartup\.com\/jobs\/|ycombinator\.com\/companies\/[^/]+\/jobs\/)/i;

/**
 * A role added by hand keeps the board it came from when the link says so: a YC posting
 * pasted in is still a YC role, so source-level yield counts it there. Anything else stays
 * 'manual'.
 */
export function sourceForManual(source: string, url: string | null): string {
  if (source === 'manual' && url && YC_URL.test(url)) return 'yc';
  return source;
}

/**
 * A role entered by hand: a referral, something found while browsing, a company you
 * decided to target. Goes through the same scoring and dedupe as an automated find, so a
 * manual entry cannot skip the rules or silently duplicate an existing row.
 */
export async function addManualJob(
  db: D1Like, cfg: Config, job: RawJob & { rating?: number | null },
): Promise<{ id: string; score: number; status: JobStatus; duplicate: boolean }> {
  const before = await db.prepare('SELECT id, status, score FROM jobs WHERE normalized_key IN (?, ?)')
    .bind(...dedupeKeys(job.title ?? '', job.company ?? '')).first<
      { id: string; status: JobStatus; score: number }>();
  if (before) {
    return { id: before.id, score: before.score, status: before.status, duplicate: true };
  }

  const source = sourceForManual(job.source ?? 'manual', job.url ?? null);
  const r = await ingestJobs(db, cfg, source, [{ ...job, source }]);
  if (r.errors.length) throw new Error(r.errors[0].reason);

  const row = await db.prepare('SELECT id, score, status FROM jobs WHERE normalized_key IN (?, ?)')
    .bind(...dedupeKeys(job.title ?? '', job.company ?? '')).first<
      { id: string; score: number; status: JobStatus }>();
  if (!row) throw new Error('the role was not stored');

  if (job.rating != null) await setRating(db, row.id, job.rating);
  return { ...row, duplicate: false };
}

/**
 * Stores a fetched job description and re-scores the role. A role automation parked in New
 * because it had no JD is then moved to wherever the real score puts it: Generate,
 * Discarded, or still New. A status a human has set is never changed.
 */
export async function attachJd(
  db: D1Like, cfg: Config, jobId: string, jdText: string, verified = true,
): Promise<{ score: ScoreResult; from: JobStatus; to: JobStatus; moved: boolean }> {
  const closes = closesFor({ jd_text: jdText });
  await db.prepare(
    `UPDATE jobs SET jd_text = ?, jd_fetched_at = datetime('now'),
       verified_at = CASE WHEN ? THEN datetime('now') ELSE verified_at END,
       salary = COALESCE(salary, ?),
       ${CLOSES_SET},
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(jdText, verified ? 1 : 0, salaryFromJd(jdText), ...closesBinds(closes), jobId).run();

  const sc = await rescoreJob(db, cfg, jobId);
  const row = await db.prepare('SELECT status FROM jobs WHERE id = ?')
    .bind(jobId).first<{ status: JobStatus }>();
  const from = row!.status;

  const humanTouched = await db.prepare(
    "SELECT 1 AS x FROM status_history WHERE job_id = ? AND actor <> 'automation' LIMIT 1",
  ).bind(jobId).first();
  const rated = await db.prepare('SELECT rating FROM jobs WHERE id = ?').bind(jobId).first<{ rating: number | null }>();
  const lowRated = rated?.rating != null && rated.rating <= LOW_RATING;
  const to = statusForScore(sc) === 'Generate' && lowRated ? 'New' : statusForScore(sc);

  if (from === 'New' && !humanTouched && to !== from) {
    await setStatus(db, jobId, to, 'automation',
      to === 'Discarded' ? sc.drop_reason ?? undefined : 'scored on its full job description');
    return { score: sc, from, to, moved: true };
  }
  return { score: sc, from, to: from, moved: false };
}

/**
 * Records that a role closed (the employer stopped taking applications or filled it), or
 * reopens it. Closing does not change the status, so an application that went out still
 * counts as one; it takes the role out of the build queue and the active board, and closes
 * any follow-up still open on it. Automation may close a role, since a closed posting is a
 * fact it can read, but only the person reopens one.
 */
export async function setRoleClosed(
  db: D1Like, jobId: string, closed: boolean, actor: Actor, note?: string,
): Promise<{ id: string; role_closed_at: string | null }> {
  const row = await db.prepare('SELECT role_closed_at FROM jobs WHERE id = ?')
    .bind(jobId).first<{ role_closed_at: string | null }>();
  if (!row) throw new Error(`no such job ${jobId}`);
  if (!closed && actor === 'automation') {
    throw new Error('only the person reopens a closed role');
  }
  await db.prepare(
    `UPDATE jobs SET role_closed_at = CASE WHEN ? THEN COALESCE(role_closed_at, datetime('now')) END,
       notes = CASE WHEN ? IS NULL THEN notes
                    WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(closed ? 1 : 0, note ?? null, note ?? null, note ?? null, jobId).run();
  if (closed) {
    await db.prepare(
      "UPDATE follow_ups SET done = 1, done_at = datetime('now'), notes = COALESCE(notes, 'role closed') "
      + 'WHERE job_id = ? AND done = 0',
    ).bind(jobId).run();
  }
  const after = await db.prepare('SELECT role_closed_at FROM jobs WHERE id = ?')
    .bind(jobId).first<{ role_closed_at: string | null }>();
  return { id: jobId, role_closed_at: after?.role_closed_at ?? null };
}

/** Why a role should never have reached the person. The keys are what the weekly review counts. */
export const NOT_FIT_REASONS = {
  too_senior: 'Too senior or too many years',
  wrong_function: 'Wrong kind of role',
  missing_skill: 'Needs a skill I do not have',
  location: 'Wrong location',
  pay: 'Pays too little',
  agency: 'Agency or no named employer',
  other: 'Other',
} as const;
export type NotFitReason = keyof typeof NOT_FIT_REASONS;

/**
 * The person's verdict that a role is not a fit: it goes to Skip, like any pass, and keeps the
 * reason so the weekly review can say what the scorer keeps letting through. Only the person
 * gives this verdict; a run that removes a role uses Skip with its own note.
 */
export async function markNotAFit(
  db: D1Like, jobId: string, reason: NotFitReason, actor: Actor, note?: string,
): Promise<{ id: string; from: JobStatus; to: JobStatus; reason: NotFitReason }> {
  if (actor === 'automation') throw new Error('only the person marks a role not a fit; a run uses Skip');
  if (!(reason in NOT_FIT_REASONS)) {
    throw new Error(`reason must be one of: ${Object.keys(NOT_FIT_REASONS).join(', ')}`);
  }
  const row = await db.prepare('SELECT status FROM jobs WHERE id = ?').bind(jobId).first<{ status: JobStatus }>();
  if (!row) throw new Error(`no such job ${jobId}`);
  if (HUMAN_ONLY_STATUSES.includes(row.status)) {
    throw new Error(`the role is ${row.status}; an application already went out, so mark it Rejected or Closed instead`);
  }
  const text = [`Not a fit: ${NOT_FIT_REASONS[reason]}`, note?.trim()].filter(Boolean).join('. ');
  const r = await setStatus(db, jobId, 'Skip', actor, text);
  await db.prepare('UPDATE jobs SET not_fit_reason = ? WHERE id = ?').bind(reason, jobId).run();
  return { ...r, reason };
}

/** Not-a-fit verdicts by reason, and how many were taken out of the build queue: those are
 * roles the scorer judged good enough to spend documents on. */
export async function notFitMetrics(db: D1Like): Promise<{
  total: number; from_queue: number;
  by_reason: { reason: string; label: string; n: number; from_queue: number }[];
}> {
  const { results } = await db.prepare(
    `SELECT j.not_fit_reason AS reason, COUNT(*) AS n,
       SUM(EXISTS (SELECT 1 FROM status_history h WHERE h.job_id = j.id
                   AND h.to_status = 'Skip' AND h.from_status = 'Generate')) AS from_queue
     FROM jobs j WHERE j.not_fit_reason IS NOT NULL GROUP BY j.not_fit_reason ORDER BY n DESC`,
  ).all<{ reason: string; n: number; from_queue: number }>();
  const by_reason = results.map((r) => ({
    ...r, label: NOT_FIT_REASONS[r.reason as NotFitReason] ?? r.reason, from_queue: Number(r.from_queue ?? 0),
  }));
  return {
    total: by_reason.reduce((a, r) => a + r.n, 0),
    from_queue: by_reason.reduce((a, r) => a + r.from_queue, 0),
    by_reason,
  };
}

export interface RescoreMove {
  id: string; title: string; company: string; from: JobStatus; to: JobStatus; reason: string;
}

/**
 * Re-scores roles already in the pipeline after the scoring rules change, and moves the ones
 * the new rules rule out. Only demotes (Queued to New or Discarded, New to Discarded): promoting
 * would refill the queue the change was meant to empty. A role the person has touched (any
 * status they set, or a rating) is re-scored but never moved. One page per call, by id, so a
 * large pipeline stays inside a Worker's query budget: pass `next` back as `after`.
 */
export async function rescorePipeline(db: D1Like, cfg: Config, opts: {
  statuses: ('Generate' | 'New')[]; dryRun: boolean; limit: number; after?: string | null;
}): Promise<{ scanned: number; moved: RescoreMove[]; held_by_person: number; next: string | null }> {
  const statuses = opts.statuses.length ? opts.statuses : ['Generate'];
  const { results } = await db.prepare(
    `SELECT j.id, j.title, j.company, j.location, j.jd_text, j.salary, j.status, j.rating,
       EXISTS (SELECT 1 FROM status_history h WHERE h.job_id = j.id AND h.actor <> 'automation') AS touched
     FROM jobs j WHERE j.status IN (${statuses.map(() => '?').join(', ')}) AND j.id > ?
     ORDER BY j.id LIMIT ?`,
  ).bind(...statuses, opts.after ?? '', opts.limit).all<{
    id: string; title: string; company: string; location: string | null; jd_text: string | null;
    salary: string | null; status: JobStatus; rating: number | null; touched: number;
  }>();

  const moved: RescoreMove[] = [];
  let held = 0;
  for (const r of results) {
    const sc = scoreJob(cfg, { ...r, jd: r.jd_text });
    const target = statusForScore(sc);
    const demotes = (r.status === 'Generate' && target !== 'Generate')
      || (r.status === 'New' && target === 'Discarded');
    if (!opts.dryRun) {
      await db.prepare(
        `UPDATE jobs SET score = ?, score_breakdown = ?, archetype = ?, drop_reason = ?,
           updated_at = datetime('now') WHERE id = ?`,
      ).bind(sc.score, JSON.stringify(sc.breakdown), sc.archetype, sc.drop_reason, r.id).run();
    }
    if (!demotes) continue;
    if (r.touched || r.rating != null) { held++; continue; }
    const reason = sc.drop_reason
      ?? (sc.breakdown.missing_skill ? `requires ${sc.breakdown.missing_skill}, which you cannot be tested on`
        : 'no longer meets the queue threshold');
    moved.push({ id: r.id, title: r.title, company: r.company, from: r.status, to: target, reason });
    if (!opts.dryRun) await setStatus(db, r.id, target, 'automation', `Re-scored: ${reason}`);
  }
  return {
    scanned: results.length, moved, held_by_person: held,
    next: results.length === opts.limit ? results[results.length - 1].id : null,
  };
}

export async function listQueue(db: D1Like, limit = 25) {
  // Build order is the person's star rating first (5 down to 1, unrated after every rated role),
  // then score, then oldest first. queued_by: "you" when the person moved it to Generate
  // themselves, which the build run honours over its fit check; "automation" otherwise.
  const { results } = await db.prepare(
    `SELECT id, title, company, location, url, score, rating, archetype, jd_text IS NOT NULL AS has_jd,
            EXISTS (SELECT 1 FROM documents d WHERE d.job_id = jobs.id AND d.kind = 'resume') AS has_resume,
            EXISTS (SELECT 1 FROM documents d WHERE d.job_id = jobs.id AND d.kind = 'cover_letter') AS has_cover_letter,
            CASE WHEN (SELECT h.actor FROM status_history h
                       WHERE h.job_id = jobs.id AND h.to_status = 'Generate'
                       ORDER BY h.id DESC LIMIT 1) = 'human' THEN 'you' ELSE 'automation' END AS queued_by
     FROM jobs WHERE status = 'Generate' AND COALESCE(rating, 3) > 2
       AND role_closed_at IS NULL
       -- a role whose cover letter failed after the resume saved stays queued, not stuck
       AND NOT (id IN (SELECT job_id FROM documents WHERE kind = 'resume')
                AND id IN (SELECT job_id FROM documents WHERE kind = 'cover_letter'))
     ORDER BY rating IS NULL, rating DESC, score DESC, created_at ASC LIMIT ?`,
  ).bind(limit).all();
  return results;
}

export async function saveDocument(db: D1Like, doc: {
  job_id: string; kind: 'resume' | 'cover_letter'; content: Uint8Array; filename: string;
  base_resume?: string | null; word_count?: number | null; page_count?: number | null;
  page_count_verified?: boolean; sha256?: string | null; spec?: unknown;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO documents (id, job_id, kind, content, byte_size, filename, base_resume,
       word_count, page_count, page_count_verified, sha256, spec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, doc.job_id, doc.kind, doc.content, doc.content.byteLength, doc.filename,
    doc.base_resume ?? null, doc.word_count ?? null, doc.page_count ?? null,
    doc.page_count_verified ? 1 : 0, doc.sha256 ?? null,
    doc.spec ? JSON.stringify(doc.spec) : null,
  ).run();
  return id;
}

/**
 * Deletes a built resume or cover letter. A file that went out with an application is
 * refused: it is the record of what the employer has, and interview prep reads it. A role left
 * marked Ready with no resume goes back to New, so the board never promises documents that
 * are gone; Generate queues it again.
 */
export async function deleteDocument(db: D1Like, id: string): Promise<{ job_id: string; status: JobStatus }> {
  const doc = await db.prepare('SELECT id, job_id FROM documents WHERE id = ?')
    .bind(id).first<{ id: string; job_id: string }>();
  if (!doc) throw new Error('no such document');
  const sent = await db.prepare(
    'SELECT 1 AS x FROM submissions WHERE resume_document_id = ? OR cover_letter_document_id = ?',
  ).bind(id, id).first();
  if (sent) {
    throw new Error('This file went out with your application, so it is kept: interview prep '
      + 'reads it to know what the employer has.');
  }
  await db.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();

  const job = await db.prepare('SELECT status FROM jobs WHERE id = ?')
    .bind(doc.job_id).first<{ status: JobStatus }>();
  const left = await db.prepare("SELECT COUNT(*) AS n FROM documents WHERE job_id = ? AND kind = 'resume'")
    .bind(doc.job_id).first<{ n: number }>();
  let status = job?.status ?? 'New';
  if (status === 'Complete' && (left?.n ?? 0) === 0) {
    await setStatus(db, doc.job_id, 'New', 'human', 'Documents deleted');
    status = 'New';
  }
  return { job_id: doc.job_id, status };
}

/** D1 hands BLOBs back as an ArrayBuffer or as a plain byte array depending on driver. */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error('document content is not binary');
}

export async function getDocument(db: D1Like, id: string): Promise<{
  filename: string; kind: string; bytes: Uint8Array; sha256: string | null;
} | null> {
  const row = await db.prepare(
    'SELECT filename, kind, content, sha256 FROM documents WHERE id = ?',
  ).bind(id).first<{ filename: string; kind: string; content: unknown; sha256: string | null }>();
  if (!row) return null;
  return {
    filename: row.filename, kind: row.kind, sha256: row.sha256,
    bytes: toBytes(row.content),
  };
}

/** Human-only by construction: this is what unlocks the Applied status in the DB. */
export async function recordSubmission(db: D1Like, s: {
  job_id: string; portal_url?: string | null; method?: string | null; notes?: string | null;
}): Promise<{ submission_id: string }> {
  const docs = await db.prepare(
    `SELECT id, kind, sha256 FROM documents WHERE job_id = ?
     ORDER BY generated_at DESC`,
  ).bind(s.job_id).all<{ id: string; kind: string; sha256: string | null }>();

  const pick = (k: string) => docs.results.find((d) => d.kind === k);
  const resume = pick('resume');
  const cl = pick('cover_letter');
  const id = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO submissions (id, job_id, portal_url, resume_document_id,
       cover_letter_document_id, resume_sha256, cover_letter_sha256, method, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       portal_url = COALESCE(excluded.portal_url, submissions.portal_url),
       notes = COALESCE(excluded.notes, submissions.notes)`,
  ).bind(
    id, s.job_id, s.portal_url ?? null, resume?.id ?? null, cl?.id ?? null,
    resume?.sha256 ?? null, cl?.sha256 ?? null, s.method ?? null, s.notes ?? null,
  ).run();

  return { submission_id: id };
}

export async function logRun(db: D1Like, run: {
  kind: string; found?: number; kept?: number; duplicates?: number; dropped?: number;
  sources_used?: string[]; sources_unavailable?: string[]; errors?: unknown[]; summary?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO runs (id, kind, finished_at, sources_used, sources_unavailable,
       found, kept, duplicates, dropped, errors, summary)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, run.kind, JSON.stringify(run.sources_used ?? []),
    JSON.stringify(run.sources_unavailable ?? []), run.found ?? 0, run.kept ?? 0,
    run.duplicates ?? 0, run.dropped ?? 0, JSON.stringify(run.errors ?? []),
    run.summary ?? null,
  ).run();
  return id;
}

/** Applied with no movement for N days becomes a surfaced follow-up. */
export async function refreshFollowUps(db: D1Like, cfg: Config): Promise<number> {
  const days = cfg.follow_up_rules.no_response_days;
  const { results } = await db.prepare(
    `SELECT j.id, date(s.applied_at, '+' || ? || ' days') AS due
     FROM jobs j JOIN submissions s ON s.job_id = j.id
     WHERE j.status = 'Applied' AND j.role_closed_at IS NULL
       AND date(s.applied_at, '+' || ? || ' days') <= date('now')`,
  ).bind(days, days).all<{ id: string; due: string }>();

  let created = 0;
  for (const r of results) {
    const res = await db.prepare(
      `INSERT INTO follow_ups (id, job_id, kind, due_at) VALUES (?, ?, 'no_response', ?)
       ON CONFLICT(job_id, kind, due_at) DO NOTHING`,
    ).bind(crypto.randomUUID(), r.id, r.due).run() as { meta?: { changes?: number } };
    if ((res?.meta?.changes ?? 1) > 0) created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Base resumes, goals, and the onboarding checklist
// ---------------------------------------------------------------------------

export interface BaseResumeMeta {
  id: string; label: string; archetype: number | null; filename: string;
  byte_size: number; sha256: string | null; active: number; uploaded_at: string;
  has_text: number;
}

export async function saveBaseResume(db: D1Like, r: {
  label: string; archetype?: number | null; filename: string;
  content: Uint8Array; sha256?: string | null; extracted_text?: string | null;
}): Promise<{ id: string; replaced: boolean }> {
  const existing = await db.prepare('SELECT id FROM base_resumes WHERE label = ?')
    .bind(r.label).first<{ id: string }>();

  if (existing) {
    // Replacing in place keeps the archetype mapping and any references stable.
    await db.prepare(
      `UPDATE base_resumes SET archetype = ?, filename = ?, content = ?, byte_size = ?,
         sha256 = ?, extracted_text = ?, active = 1, updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      r.archetype ?? null, r.filename, r.content, r.content.byteLength,
      r.sha256 ?? null, r.extracted_text ?? null, existing.id,
    ).run();
    return { id: existing.id, replaced: true };
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO base_resumes (id, label, archetype, filename, content, byte_size,
       sha256, extracted_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, r.label, r.archetype ?? null, r.filename, r.content, r.content.byteLength,
    r.sha256 ?? null, r.extracted_text ?? null,
  ).run();
  return { id, replaced: false };
}

export async function listBaseResumes(db: D1Like): Promise<BaseResumeMeta[]> {
  const { results } = await db.prepare(
    `SELECT id, label, archetype, filename, byte_size, sha256, active, uploaded_at,
            CASE WHEN extracted_text IS NULL OR extracted_text = '' THEN 0 ELSE 1 END AS has_text
     FROM base_resumes ORDER BY archetype, label`,
  ).all<BaseResumeMeta>();
  return results;
}

export async function getBaseResume(db: D1Like, idOrLabel: string): Promise<{
  id: string; label: string; archetype: number | null; filename: string;
  bytes: Uint8Array; extracted_text: string | null;
} | null> {
  const row = await db.prepare(
    `SELECT id, label, archetype, filename, content, extracted_text
     FROM base_resumes WHERE id = ? OR label = ?`,
  ).bind(idOrLabel, idOrLabel).first<{
    id: string; label: string; archetype: number | null; filename: string;
    content: unknown; extracted_text: string | null;
  }>();
  if (!row) return null;
  return { ...row, bytes: toBytes(row.content) };
}

/** Picks the master to tailor from. Falls back to the archetype map in config, then to
 * any active resume, so a missing mapping degrades instead of stopping a run. */
export async function baseResumeForArchetype(
  db: D1Like, cfg: Config, archetype: number | null,
): Promise<BaseResumeMeta | null> {
  if (archetype != null) {
    const byArchetype = await db.prepare(
      'SELECT id, label, archetype, filename, byte_size, sha256, active, uploaded_at, 1 AS has_text '
      + 'FROM base_resumes WHERE archetype = ? AND active = 1 LIMIT 1',
    ).bind(archetype).first<BaseResumeMeta>();
    if (byArchetype) return byArchetype;
  }
  const mapped = cfg.base_resume_map[String(archetype ?? '')] ?? cfg.base_resume_map.fallback;
  const byFilename = await db.prepare(
    'SELECT id, label, archetype, filename, byte_size, sha256, active, uploaded_at, 1 AS has_text '
    + 'FROM base_resumes WHERE filename = ? AND active = 1 LIMIT 1',
  ).bind(mapped).first<BaseResumeMeta>();
  if (byFilename) return byFilename;

  const any = await db.prepare(
    'SELECT id, label, archetype, filename, byte_size, sha256, active, uploaded_at, 1 AS has_text '
    + 'FROM base_resumes WHERE active = 1 ORDER BY archetype LIMIT 1',
  ).first<BaseResumeMeta>();
  return any ?? null;
}

export async function deleteBaseResume(db: D1Like, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM base_resumes WHERE id = ?').bind(id).run() as { meta?: { changes?: number } };
  if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no base resume with id ${id}`);
}

export type GoalKind =
  | 'weekly_applications' | 'weekly_outreach' | 'total_applications'
  | 'interviews' | 'offer_by' | 'target_comp' | 'custom';

/** Creates a goal, or edits one when `id` is given. An edit is partial: a field left out
 * keeps its value and an explicit null clears it, so closing a goal out does not wipe its
 * target and due date. */
export async function upsertGoal(db: D1Like, g: {
  id?: string; kind?: GoalKind; title?: string; target_value?: number | null;
  unit?: string | null; due_at?: string | null; status?: string; notes?: string | null;
}): Promise<string> {
  if (g.id) {
    const sets: string[] = [];
    const binds: unknown[] = [];
    for (const f of ['kind', 'title', 'target_value', 'unit', 'due_at', 'status', 'notes'] as const) {
      if (g[f] === undefined) continue;
      if ((f === 'kind' || f === 'title' || f === 'status') && g[f] === null) continue;
      sets.push(`${f} = ?`);
      binds.push(g[f]);
    }
    const res = await db.prepare(
      `UPDATE goals SET ${[...sets, "updated_at = datetime('now')"].join(', ')} WHERE id = ?`,
    ).bind(...binds, g.id).run() as { meta?: { changes?: number } };
    if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no goal with id ${g.id}`);
    return g.id;
  }
  if (!g.kind || !g.title?.trim()) throw new Error('a new goal needs a kind and a title');
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO goals (id, kind, title, target_value, unit, due_at, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'active'), ?)`,
  ).bind(
    id, g.kind, g.title, g.target_value ?? null, g.unit ?? null, g.due_at ?? null,
    g.status ?? null, g.notes ?? null,
  ).run();
  return id;
}

export async function listGoals(db: D1Like, includeClosed = false) {
  const sql = includeClosed
    ? 'SELECT * FROM v_goal_progress ORDER BY status, due_at'
    : "SELECT * FROM v_goal_progress WHERE status = 'active' ORDER BY due_at";
  const { results } = await db.prepare(sql).bind().all();
  return results;
}

export async function deleteGoal(db: D1Like, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM goals WHERE id = ?').bind(id).run() as { meta?: { changes?: number } };
  if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no goal with id ${id}`);
}
