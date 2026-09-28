import type { D1Like } from './repo.ts';

/**
 * Outreach: the messages sent to a person about a role, and what came back.
 *
 * Nothing here sends anything, and nothing here can. A touch is drafted, the person sends it
 * themselves, and then says so. Sent, Accepted, Replied and Meeting are human-only for the
 * same reason Applied is: a tracker that can fake them tells you nothing about whether any of
 * this works. The cadence rules live here rather than in a prompt so they cannot drift
 * between runs, and every refusal names the rule it hit.
 */

export type TouchKind = 'connect_note' | 'follow_up' | 'backup' | 'nudge' | 'create_role';
export type OutreachStatus = 'Drafted' | 'Sent' | 'Accepted' | 'Replied' | 'Meeting' | 'No reply' | 'Closed';
export type Channel = 'linkedin' | 'email' | 'other';
export type ContactType = 'dm_post' | 'function_lead' | 'founder' | 'recruiter' | 'referral';
export type HookType = 'origin_story' | 'contact_post' | 'company_event' | 'referral' | 'other';
export type OutreachActor = 'you' | 'automation';

export const TOUCH_KINDS: TouchKind[] = ['connect_note', 'follow_up', 'backup', 'nudge', 'create_role'];
export const OUTREACH_STATUSES: OutreachStatus[] = ['Drafted', 'Sent', 'Accepted', 'Replied', 'Meeting', 'No reply', 'Closed'];
export const CHANNELS: Channel[] = ['linkedin', 'email', 'other'];
export const CONTACT_TYPES: ContactType[] = ['dm_post', 'function_lead', 'founder', 'recruiter', 'referral'];
export const HOOK_TYPES: HookType[] = ['origin_story', 'contact_post', 'company_event', 'referral', 'other'];

/** Statuses that mean a person did something in the world. Automation may never set these. */
export const OUTREACH_HUMAN_ONLY: OutreachStatus[] = ['Sent', 'Accepted', 'Replied', 'Meeting'];
/** A role must have reached one of these before a touch about it can be marked Sent. */
export const APPLIED_STATUSES = ['Applied', 'Interviewing', 'Offer'];
/** Cold contact: the first approach and its one nudge. A follow-up after the person replied
 * is a conversation, not a cold touch, so it does not count toward the cap. */
const COLD_KINDS: TouchKind[] = ['connect_note', 'create_role', 'backup', 'nudge'];

const BACKUP_AFTER_DAYS = 3;
const NUDGE_AFTER_DAYS = 7;
const NO_REPLY_AFTER_DAYS = 5;
const FOLLOW_UP_AFTER_DAYS = 3;

/** A cadence rule said no. `rule` is the letter from the spec, so the message can name it. */
export class OutreachRuleError extends Error {
  rule: string;
  constructor(rule: string, message: string) {
    super(message);
    this.name = 'OutreachRuleError';
    this.rule = rule;
  }
}

// ---- company and contact identity -------------------------------------------------------

/** "Acme Group, Inc." and "Acme US" are one company for the once-a-day rule. */
export function normalizeCompany(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|us|usa|corp|corporation|group|ltd|limited)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const contactKey = (company: string, name: string) =>
  `${normalizeCompany(company)}|${(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

// ---- business days ----------------------------------------------------------------------

/** The calendar day in New York, which is the day the person is working in. */
export function etDay(value?: string | Date | null): string {
  const d = value instanceof Date ? value
    : value ? new Date(`${String(value).replace(' ', 'T')}${/[Z+]|\d-\d\d:\d\d$/.test(String(value)) ? '' : 'Z'}`)
      : new Date();
  if (Number.isNaN(d.getTime())) return etDay(new Date());
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

const shiftDay = (day: string, by: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};
const isWeekend = (day: string): boolean => {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
};

/** Weekends do not count. Holidays do, deliberately: a holiday calendar is a maintenance
 * burden for a rule whose whole job is "do not pester someone the next morning". */
export function addBusinessDays(day: string, n: number): string {
  let out = day;
  for (let left = n; left > 0; left--) {
    do { out = shiftDay(out, 1); } while (isWeekend(out));
  }
  return out;
}

export function businessDaysBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = from; d < to;) {
    d = shiftDay(d, 1);
    if (!isWeekend(d)) n++;
  }
  return n;
}

// ---- rows ---------------------------------------------------------------------------------

export interface OutreachRow {
  id: string;
  job_id: string | null;
  company: string;
  contact_name: string;
  contact_role: string | null;
  contact_type: ContactType | null;
  channel: Channel;
  contact_url: string | null;
  contact_email: string | null;
  hook_type: HookType | null;
  hook: string | null;
  touch_kind: TouchKind;
  parent_id: string | null;
  body: string;
  status: OutreachStatus;
  status_set_by: OutreachActor | null;
  drafted_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  replied_at: string | null;
  follow_up_due: string | null;
  notes: string | null;
}

export interface LogOutreachInput {
  job_id?: string | null;
  company: string;
  contact_name: string;
  contact_role?: string | null;
  contact_type?: ContactType | null;
  channel: Channel;
  contact_url?: string | null;
  contact_email?: string | null;
  hook_type?: HookType | null;
  hook?: string | null;
  touch_kind: TouchKind;
  parent_id?: string | null;
  body: string;
  notes?: string | null;
}

const FIELDS = `id, job_id, company, contact_name, contact_role, contact_type, channel,
  contact_url, contact_email, hook_type, hook, touch_kind, parent_id, body, status,
  status_set_by, drafted_at, sent_at, accepted_at, replied_at, follow_up_due, notes`;

const byId = async (db: D1Like, id: string): Promise<OutreachRow> => {
  const row = await db.prepare(`SELECT ${FIELDS} FROM outreach WHERE id = ?`).bind(id).first<OutreachRow>();
  if (!row) throw new Error(`no outreach touch with id ${id}`);
  return row;
};

/** Every touch aimed at the same person at the same company, this one included. */
async function contactTouches(db: D1Like, company: string, contact: string): Promise<OutreachRow[]> {
  const { results } = await db.prepare(
    `SELECT ${FIELDS} FROM outreach WHERE lower(trim(contact_name)) = ? ORDER BY drafted_at`,
  ).bind((contact ?? '').toLowerCase().trim()).all<OutreachRow>();
  const key = contactKey(company, contact);
  return results.filter((r) => contactKey(r.company, r.contact_name) === key);
}

const replied = (r: OutreachRow) => r.replied_at != null || r.status === 'Replied' || r.status === 'Meeting';

// ---- writing ------------------------------------------------------------------------------

/**
 * Records a draft. Nothing is sent: the person sends the message and then marks it Sent,
 * which is where the cadence rules are checked.
 */
export async function logOutreach(db: D1Like, i: LogOutreachInput): Promise<{ id: string; status: OutreachStatus }> {
  for (const [field, value] of [['company', i.company], ['contact_name', i.contact_name], ['body', i.body]] as const) {
    if (!String(value ?? '').trim()) throw new Error(`${field} is required`);
  }
  if (!CHANNELS.includes(i.channel)) throw new Error(`channel must be one of ${CHANNELS.join(', ')}`);
  if (!TOUCH_KINDS.includes(i.touch_kind)) throw new Error(`touch_kind must be one of ${TOUCH_KINDS.join(', ')}`);
  if (i.touch_kind !== 'create_role' && !i.job_id) {
    throw new Error('job_id is required unless touch_kind is "create_role" (a role that does not exist yet)');
  }
  if (i.job_id) {
    const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(i.job_id).first();
    if (!job) throw new Error(`no role with id ${i.job_id}`);
  }
  if (i.parent_id) await byId(db, i.parent_id);

  const touches = await contactTouches(db, i.company, i.contact_name);
  const cold = touches.filter((t) => COLD_KINDS.includes(t.touch_kind));
  if (COLD_KINDS.includes(i.touch_kind)) {
    if (cold.length >= 2) {
      throw new OutreachRuleError('d', `Rule d: ${i.contact_name} at ${i.company} already has `
        + `${cold.length} touches (the first approach and its nudge). A third is not logged.`);
    }
    if (i.touch_kind === 'nudge' && cold.some((t) => t.touch_kind === 'nudge')) {
      throw new OutreachRuleError('d', `Rule d: ${i.contact_name} has already been nudged once.`);
    }
  }
  // A follow-up belongs to a conversation that started; otherwise it is a third cold touch.
  if (i.touch_kind === 'follow_up' && !touches.some((t) => t.status === 'Accepted' || replied(t))) {
    throw new OutreachRuleError('d', `Rule d: a follow_up is for a contact who accepted or replied. `
      + `${i.contact_name} has not yet, so this would be a third cold touch. Use a nudge.`);
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO outreach (id, job_id, company, contact_name, contact_role, contact_type, channel,
       contact_url, contact_email, hook_type, hook, touch_kind, parent_id, body, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Drafted', ?)`,
  ).bind(
    id, i.job_id ?? null, i.company.trim(), i.contact_name.trim(), i.contact_role ?? null,
    i.contact_type ?? null, i.channel, i.contact_url ?? null, i.contact_email ?? null,
    i.hook_type ?? null, i.hook ?? null, i.touch_kind, i.parent_id ?? null, i.body, i.notes ?? null,
  ).run();
  return { id, status: 'Drafted' };
}

export interface OutreachPatch {
  status?: OutreachStatus;
  notes?: string | null;
  body?: string;
  follow_up_due?: string | null;
}

/**
 * Changes a touch. `actor` is how the change was made: "you" is a dashboard click or the
 * person's own words quoted in a chat; "automation" is a run. The cadence rules are checked
 * here, so the same answer comes back whichever door the change came through.
 */
export async function updateOutreach(
  db: D1Like, id: string, patch: OutreachPatch, actor: OutreachActor, now = new Date(),
): Promise<OutreachRow> {
  const row = await byId(db, id);
  const today = etDay(now);
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (patch.status && patch.status !== row.status) {
    const to = patch.status;
    if (!OUTREACH_STATUSES.includes(to)) throw new Error(`status must be one of ${OUTREACH_STATUSES.join(', ')}`);

    if (actor === 'automation') {
      // Rule g, bounded by rule h: the only status a run may set, and only on a touch that
      // has had no answer at all. Anything further along was a person's judgement.
      if (to !== 'No reply') {
        throw new OutreachRuleError('a', `Rule a: "${to}" means something happened in the world, so `
          + 'only you can set it. Automation may only set "No reply".');
      }
      if (row.status !== 'Sent') {
        throw new OutreachRuleError('h', `Rule h: this touch is ${row.status}, which you set. `
          + 'Automation does not overwrite it.');
      }
      if (row.touch_kind !== 'nudge') {
        throw new OutreachRuleError('g', 'Rule g: automation marks No reply on a nudge that went unanswered, '
          + `not on a ${row.touch_kind}.`);
      }
      const waited = row.sent_at ? businessDaysBetween(etDay(row.sent_at), today) : 0;
      if (waited < NO_REPLY_AFTER_DAYS) {
        throw new OutreachRuleError('g', `Rule g: the nudge went out ${waited} business days ago; `
          + `No reply is set after ${NO_REPLY_AFTER_DAYS}.`);
      }
    } else if (OUTREACH_HUMAN_ONLY.includes(to)) {
      // Rule a's other half is enforced at the callers: the MCP tool demands the person's own
      // words, the dashboard demands a click. Both arrive here as actor "you".
      if (to === 'Sent') await checkSendable(db, row, today);
    }

    sets.push('status = ?', 'status_set_by = ?');
    binds.push(to, actor);
    if (to === 'Sent' && !row.sent_at) {
      sets.push("sent_at = datetime('now')", 'follow_up_due = ?');
      binds.push(addBusinessDays(today, FOLLOW_UP_AFTER_DAYS));
    }
    if (to === 'Accepted' && !row.accepted_at) sets.push("accepted_at = datetime('now')");
    // A meeting is a reply, whatever order they were recorded in.
    if ((to === 'Replied' || to === 'Meeting') && !row.replied_at) sets.push("replied_at = datetime('now')");
  }

  if (patch.notes !== undefined) { sets.push('notes = ?'); binds.push(patch.notes); }
  if (patch.body !== undefined) {
    if (actor !== 'you') throw new OutreachRuleError('a', 'Rule a: only you edit the message.');
    if (!patch.body.trim()) throw new Error('body cannot be emptied');
    sets.push('body = ?'); binds.push(patch.body);
  }
  if (patch.follow_up_due !== undefined) { sets.push('follow_up_due = ?'); binds.push(patch.follow_up_due); }
  if (!sets.length) throw new Error('nothing to change');

  await db.prepare(`UPDATE outreach SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...binds, id).run();
  return byId(db, id);
}

/** Rules b, c and d, at the moment a touch is claimed to have gone out. */
async function checkSendable(db: D1Like, row: OutreachRow, today: string): Promise<void> {
  if (row.touch_kind !== 'create_role') {
    const job = row.job_id
      ? await db.prepare('SELECT id, title, status FROM jobs WHERE id = ?').bind(row.job_id)
        .first<{ id: string; title: string; status: string }>()
      : null;
    if (!job) {
      throw new OutreachRuleError('b', 'Rule b: this touch has no role attached, so there is nothing to '
        + 'have applied to. Only a create_role touch may go out without one.');
    }
    if (!APPLIED_STATUSES.includes(job.status)) {
      throw new OutreachRuleError('b', `Rule b: outreach goes out after the application. "${job.title}" is `
        + `${job.status}, not ${APPLIED_STATUSES.join(', ')}.`);
    }
  }

  const { results: sentToday } = await db.prepare(
    `SELECT ${FIELDS} FROM outreach WHERE sent_at IS NOT NULL AND id <> ?`,
  ).bind(row.id).all<OutreachRow>();
  const clash = sentToday.find((t) => etDay(t.sent_at) === today
    && normalizeCompany(t.company) === normalizeCompany(row.company));
  if (clash) {
    throw new OutreachRuleError('c', `Rule c: you already sent to ${clash.contact_name} at `
      + `${clash.company} today. One message per company per day.`);
  }

  if (COLD_KINDS.includes(row.touch_kind)) {
    const cold = (await contactTouches(db, row.company, row.contact_name))
      .filter((t) => t.id !== row.id && t.sent_at && COLD_KINDS.includes(t.touch_kind));
    if (cold.length >= 2) {
      throw new OutreachRuleError('d', `Rule d: ${row.contact_name} has already had two touches. `
        + 'A third is not sent.');
    }
  }
}

/** Rule g as a sweep: nudges that went unanswered long enough to call it. */
export async function sweepNoReply(db: D1Like, now = new Date()): Promise<{ marked: string[] }> {
  const today = etDay(now);
  const { results } = await db.prepare(
    `SELECT ${FIELDS} FROM outreach WHERE status = 'Sent' AND touch_kind = 'nudge' AND replied_at IS NULL`,
  ).bind().all<OutreachRow>();
  const marked: string[] = [];
  for (const r of results) {
    if (!r.sent_at || businessDaysBetween(etDay(r.sent_at), today) < NO_REPLY_AFTER_DAYS) continue;
    await db.prepare(
      `UPDATE outreach SET status = 'No reply', status_set_by = 'automation',
         updated_at = datetime('now') WHERE id = ? AND status = 'Sent'`,
    ).bind(r.id).run();
    marked.push(r.id);
  }
  return { marked };
}

// ---- reading ------------------------------------------------------------------------------

export interface OutreachFilters {
  status?: OutreachStatus;
  job_id?: string;
  company?: string;
  since_days?: number;
  limit?: number;
}

/** Touches with the role they are about, newest first. */
export async function listOutreach(db: D1Like, f: OutreachFilters = {}): Promise<Record<string, unknown>[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.status) { where.push('o.status = ?'); binds.push(f.status); }
  if (f.job_id) { where.push('o.job_id = ?'); binds.push(f.job_id); }
  if (f.company) { where.push('lower(o.company) LIKE ?'); binds.push(`%${f.company.toLowerCase()}%`); }
  if (f.since_days != null) { where.push("o.drafted_at >= datetime('now', '-' || ? || ' days')"); binds.push(f.since_days); }
  const { results } = await db.prepare(
    `SELECT o.id, o.job_id, o.company, o.contact_name, o.contact_role, o.contact_type, o.channel,
            o.contact_url, o.contact_email, o.hook_type, o.hook, o.touch_kind, o.parent_id, o.body,
            o.status, o.status_set_by, o.drafted_at, o.sent_at, o.accepted_at, o.replied_at,
            o.follow_up_due, o.notes,
            j.title AS job_title, j.status AS job_status, j.rating AS job_rating, j.archetype AS job_archetype
     FROM outreach o LEFT JOIN jobs j ON j.id = o.job_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(o.sent_at, o.drafted_at) DESC LIMIT ?`,
  ).bind(...binds, Math.min(Math.max(f.limit ?? 50, 1), 200)).all();
  return results;
}

export interface DueItem {
  reason: 'backup due' | 'nudge due' | 'accepted, follow-up not sent' | 'mark no reply';
  detail: string;
  id: string;
  job_id: string | null;
  company: string;
  contact_name: string;
  touch_kind: TouchKind;
  status: OutreachStatus;
  sent_at: string | null;
  business_days_waited: number;
}

/**
 * Everything outreach needs from you today, each row saying why. Runs the No reply sweep
 * first, so a nudge that timed out is already settled rather than listed as work.
 */
export async function outreachDue(db: D1Like, now = new Date()): Promise<{ swept: string[]; due: DueItem[] }> {
  const { marked } = await sweepNoReply(db, now);
  const today = etDay(now);
  const { results: all } = await db.prepare(`SELECT ${FIELDS} FROM outreach`).bind().all<OutreachRow>();

  const byContact = new Map<string, OutreachRow[]>();
  for (const r of all) {
    const k = contactKey(r.company, r.contact_name);
    byContact.set(k, [...(byContact.get(k) ?? []), r]);
  }
  const due: DueItem[] = [];
  const add = (r: OutreachRow, reason: DueItem['reason'], detail: string, waited: number) => due.push({
    reason, detail, id: r.id, job_id: r.job_id, company: r.company, contact_name: r.contact_name,
    touch_kind: r.touch_kind, status: r.status, sent_at: r.sent_at, business_days_waited: waited,
  });

  for (const [, touches] of byContact) {
    const answered = touches.some(replied);
    const closed = touches.some((t) => t.status === 'Closed');
    const first = touches.filter((t) => t.sent_at && COLD_KINDS.includes(t.touch_kind))
      .sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))[0];
    if (closed) continue;

    // An accepted connection with nothing sent into it is the most wasteful state there is:
    // the hard part worked and the message was never written.
    const accepted = touches.find((t) => t.status === 'Accepted');
    if (accepted && !touches.some((t) => t.touch_kind === 'follow_up' && t.sent_at)) {
      add(accepted, 'accepted, follow-up not sent', `${accepted.contact_name} accepted; nothing sent since.`,
        accepted.accepted_at ? businessDaysBetween(etDay(accepted.accepted_at), today) : 0);
      continue;
    }
    if (!first || answered) continue;

    const waited = businessDaysBetween(etDay(first.sent_at), today);
    const nudge = touches.find((t) => t.touch_kind === 'nudge');
    if (nudge?.sent_at && nudge.status === 'Sent'
      && businessDaysBetween(etDay(nudge.sent_at), today) >= NO_REPLY_AFTER_DAYS) {
      // the sweep could not settle it, which means a person set this status
      add(nudge, 'mark no reply', `Nudged ${businessDaysBetween(etDay(nudge.sent_at), today)} business days `
        + 'ago with no answer.', businessDaysBetween(etDay(nudge.sent_at), today));
      continue;
    }
    if (!nudge && waited >= NUDGE_AFTER_DAYS) {
      add(first, 'nudge due', `${first.contact_name} has not answered in ${waited} business days.`, waited);
      continue;
    }
    if (waited >= BACKUP_AFTER_DAYS && !touches.some((t) => t.touch_kind === 'backup')) {
      const sameCompany = all.filter((t) => normalizeCompany(t.company) === normalizeCompany(first.company));
      if (!sameCompany.some((t) => t.touch_kind === 'backup')) {
        add(first, 'backup due', `No answer from ${first.contact_name} in ${waited} business days; `
          + 'try a second person at the company.', waited);
      }
    }
  }
  const order: DueItem['reason'][] = ['accepted, follow-up not sent', 'mark no reply', 'nudge due', 'backup due'];
  due.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || b.business_days_waited - a.business_days_waited);
  return { swept: marked, due };
}

/** The most advanced thing that has happened to a role's outreach, for the pipeline list. */
export const OUTREACH_STATUS_SQL = (jobId: string) => `(
  SELECT CASE MAX(CASE WHEN o.status IN ('Replied', 'Meeting') THEN 3
                       WHEN o.sent_at IS NOT NULL THEN 2
                       WHEN o.status = 'Drafted' THEN 1 ELSE 0 END)
         WHEN 3 THEN 'replied' WHEN 2 THEN 'sent' WHEN 1 THEN 'drafted' ELSE 'none' END
  FROM outreach o WHERE o.job_id = ${jobId})`;

export interface OutreachMetrics {
  sent: number; accepted: number; replied: number; meeting: number;
  accept_rate: number | null; reply_rate: number | null;
  by_hook_type: { key: string; sent: number; replies: number; reply_rate: number | null }[];
  by_contact_type: { key: string; sent: number; replies: number; reply_rate: number | null }[];
  by_archetype: { key: string; sent: number; replies: number; reply_rate: number | null }[];
  interview_rate: {
    with_outreach: { applied: number; interviewed: number; rate: number | null };
    without_outreach: { applied: number; interviewed: number; rate: number | null };
  };
  warning: boolean;
  warning_text?: string;
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

/** Does any of this work? Reply rate is the number that answers it; the breakdowns say which
 * hook and which kind of contact earns the replies. */
export async function outreachMetrics(db: D1Like): Promise<OutreachMetrics> {
  const totals = await db.prepare(
    `SELECT COUNT(CASE WHEN sent_at IS NOT NULL THEN 1 END) AS sent,
            COUNT(CASE WHEN accepted_at IS NOT NULL OR status IN ('Accepted', 'Replied', 'Meeting') THEN 1 END) AS accepted,
            COUNT(CASE WHEN replied_at IS NOT NULL OR status = 'Replied' THEN 1 END) AS replied,
            COUNT(CASE WHEN status = 'Meeting' THEN 1 END) AS meeting
     FROM outreach WHERE sent_at IS NOT NULL`,
  ).first<{ sent: number; accepted: number; replied: number; meeting: number }>();

  const sent = totals?.sent ?? 0;
  const meeting = totals?.meeting ?? 0;
  // a meeting is a reply that went further; count it once, in both the numerator and its own column
  const replied = Math.max((totals?.replied ?? 0) - meeting, 0);

  const cut = async (column: string) => {
    const { results } = await db.prepare(
      `SELECT COALESCE(${column}, 'unset') AS key, COUNT(*) AS sent,
              COUNT(CASE WHEN o.replied_at IS NOT NULL OR o.status IN ('Replied', 'Meeting') THEN 1 END) AS replies
       FROM outreach o LEFT JOIN jobs j ON j.id = o.job_id
       WHERE o.sent_at IS NOT NULL GROUP BY COALESCE(${column}, 'unset') ORDER BY sent DESC`,
    ).bind().all<{ key: string; sent: number; replies: number }>();
    return results.map((r) => ({ ...r, reply_rate: rate(r.replies, r.sent) }));
  };

  const funnel = await db.prepare(
    `SELECT EXISTS (SELECT 1 FROM outreach o WHERE o.job_id = j.id AND o.sent_at IS NOT NULL) AS with_outreach,
            COUNT(*) AS applied,
            COUNT(CASE WHEN j.status IN ('Interviewing', 'Offer')
                        OR EXISTS (SELECT 1 FROM interviews i WHERE i.job_id = j.id) THEN 1 END) AS interviewed
     FROM jobs j WHERE EXISTS (SELECT 1 FROM submissions s WHERE s.job_id = j.id)
     GROUP BY with_outreach`,
  ).bind().all<{ with_outreach: number; applied: number; interviewed: number }>();
  const side = (want: number) => {
    const r = funnel.results.find((x) => Number(x.with_outreach) === want);
    return { applied: r?.applied ?? 0, interviewed: r?.interviewed ?? 0, rate: rate(r?.interviewed ?? 0, r?.applied ?? 0) };
  };

  const replyRate = rate(replied + meeting, sent);
  const warning = sent >= 15 && replyRate !== null && replyRate < 0.15;
  return {
    sent, accepted: totals?.accepted ?? 0, replied, meeting,
    accept_rate: rate(totals?.accepted ?? 0, sent),
    reply_rate: replyRate,
    by_hook_type: await cut('o.hook_type'),
    by_contact_type: await cut('o.contact_type'),
    by_archetype: await cut('j.archetype'),
    interview_rate: { with_outreach: side(1), without_outreach: side(0) },
    warning,
    ...(warning ? { warning_text: `${sent} messages sent and a ${Math.round((replyRate ?? 0) * 100)}% reply rate. `
      + 'The message or the targeting is not working; change one of them before sending more.' } : {}),
  };
}
