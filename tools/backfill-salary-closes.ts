/**
 * Fills salary and application deadline on roles stored before they were read from the JD.
 * Only empty fields are filled, and a listing expiry is replaced only by a deadline the JD
 * states; a date set in the dashboard is never touched. Safe to run twice.
 *
 *   node tools/backfill-salary-closes.ts                 production (CLOUDFLARE_API_TOKEN)
 *   node tools/backfill-salary-closes.ts --sqlite FILE   a local D1 file, e.g. .wrangler-audit
 *   add --dry-run to count without writing
 */
import { DatabaseSync } from 'node:sqlite';
import type { D1Like } from '../core/src/repo.ts';
import { salaryFromJd } from '../core/src/salary.ts';
import { closingDateFromJd } from '../core/src/dates.ts';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const file = args.includes('--sqlite') ? args[args.indexOf('--sqlite') + 1] : null;

function local(path: string): D1Like {
  const raw = new DatabaseSync(path);
  return {
    prepare(sql: string) {
      const make = (params: unknown[]) => ({
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...params as never[]).changes) } }; },
        async all<T>() { return { results: raw.prepare(sql).all(...params as never[]) as T[] }; },
        async first<T>() { return (raw.prepare(sql).get(...params as never[]) ?? null) as T | null; },
      });
      return { ...make([]), bind: (...v: unknown[]) => make(v) };
    },
  };
}

const db: D1Like = file ? local(file) : (await import('./d1http.ts')).d1;

type Row = { id: string; created_at: string; salary: string | null; jd_text: string; closes_at: string | null; closes_source: string | null };
let salaries = 0;
let deadlines = 0;
let seen = 0;
// Paged by id, not offset: rows this run fills drop out of the filter, which would shift an
// offset and skip rows.
for (let after = ''; ;) {
  const { results } = await db.prepare(
    `SELECT id, created_at, salary, jd_text, closes_at, closes_source FROM jobs
     WHERE id > ? AND jd_text IS NOT NULL AND length(jd_text) > 200
       AND (salary IS NULL OR salary = '' OR closes_at IS NULL OR closes_source = 'listing')
     ORDER BY id LIMIT 200`,
  ).bind(after).all<Row>();
  if (!results.length) break;
  after = results[results.length - 1].id;
  seen += results.length;
  for (const r of results) {
    const pay = !r.salary?.trim() ? salaryFromJd(r.jd_text) : null;
    // A deadline without a year is read against when the role was found, not today.
    const found = new Date(`${r.created_at.replace(' ', 'T')}Z`);
    const closes = (!r.closes_at || r.closes_source === 'listing')
      ? closingDateFromJd(r.jd_text, Number.isNaN(found.getTime()) ? new Date() : found) : null;
    if (!pay && !closes) continue;
    if (pay) salaries++;
    if (closes) deadlines++;
    if (dry) continue;
    await db.prepare(
      `UPDATE jobs SET salary = COALESCE(NULLIF(salary, ''), ?),
         closes_at = CASE WHEN ? IS NOT NULL AND COALESCE(closes_source, '') <> 'you' THEN ? ELSE closes_at END,
         closes_source = CASE WHEN ? IS NOT NULL AND COALESCE(closes_source, '') <> 'you' THEN 'stated' ELSE closes_source END
       WHERE id = ?`,
    ).bind(pay, closes, closes, closes, r.id).run();
  }
}
console.log(`${dry ? '[dry run] ' : ''}${seen} roles checked: ${salaries} salaries and ${deadlines} deadlines read from the JD.`);
