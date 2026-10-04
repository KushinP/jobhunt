import type { D1Like } from './repo.ts';
import type { Config } from './types.ts';
import { refreshFollowUps } from './repo.ts';
import { etDay, outreachDue } from './outreach.ts';

/**
 * The to-do list: one place that says what the person owes today. Most of it is worked out from
 * tables that already exist (follow-ups, outreach, interviews, deadlines, built documents); the
 * `todos` table holds only what nothing else can know, like a HireVue invite and its deadline.
 */

export type TodoKind = 'assessment' | 'interview' | 'application' | 'outreach' | 'other';
export const TODO_KINDS: TodoKind[] = ['assessment', 'interview', 'application', 'outreach', 'other'];
export type TodoActor = 'you' | 'claude';

export interface TodoInput {
  title: string;
  kind?: string;
  job_id?: string | null;
  /** YYYY-MM-DD */
  due_at?: string | null;
  url?: string | null;
  notes?: string | null;
}

export interface TodoRow {
  id: string; title: string; kind: TodoKind; job_id: string | null; due_at: string | null;
  url: string | null; notes: string | null; created_by: TodoActor; created_at: string;
  done_at: string | null; job_title: string | null; company: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function clean(i: TodoInput): Required<Omit<TodoInput, 'kind'>> & { kind: TodoKind } {
  const title = (i.title ?? '').trim();
  if (!title) throw new Error('A to-do needs a title.');
  if (title.length > 300) throw new Error('Keep the title under 300 characters; put the rest in notes.');
  const kind = (i.kind ?? 'other') as TodoKind;
  if (!TODO_KINDS.includes(kind)) throw new Error(`kind must be one of ${TODO_KINDS.join(', ')}.`);
  const due = i.due_at ? i.due_at.trim().slice(0, 10) : null;
  if (due && !DAY.test(due)) throw new Error('due_at must be a date, YYYY-MM-DD.');
  const url = i.url?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://.');
  return { title, kind, job_id: i.job_id || null, due_at: due, url, notes: i.notes?.trim() || null };
}

export async function addTodo(db: D1Like, input: TodoInput, actor: TodoActor): Promise<{ id: string }> {
  const t = clean(input);
  if (t.job_id) {
    const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(t.job_id).first();
    if (!job) throw new Error(`No role with id ${t.job_id}.`);
  }
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO todos (id, title, kind, job_id, due_at, url, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, t.title, t.kind, t.job_id, t.due_at, t.url, t.notes, actor).run();
  return { id };
}

/** Marks a to-do done, or open again with `done: false`. False when there is no such to-do. */
export async function completeTodo(db: D1Like, id: string, done = true): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE todos SET done_at = ${done ? "datetime('now')" : 'NULL'} WHERE id = ?`,
  ).bind(id).run() as { meta?: { changes?: number } };
  return (r?.meta?.changes ?? 0) > 0;
}

export async function deleteTodo(db: D1Like, id: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM todos WHERE id = ?').bind(id).run() as { meta?: { changes?: number } };
  return (r?.meta?.changes ?? 0) > 0;
}

export async function listTodos(db: D1Like, opts: { includeDone?: boolean } = {}): Promise<TodoRow[]> {
  const { results } = await db.prepare(
    `SELECT t.id, t.title, t.kind, t.job_id, t.due_at, t.url, t.notes, t.created_by, t.created_at,
            t.done_at, j.title AS job_title, j.company
     FROM todos t LEFT JOIN jobs j ON j.id = t.job_id
     ${opts.includeDone ? '' : 'WHERE t.done_at IS NULL'}
     ORDER BY t.done_at IS NOT NULL, t.due_at IS NULL, t.due_at, t.created_at`,
  ).bind().all<TodoRow>();
  return results;
}

// ---------------------------------------------------------------------------
// The aggregated list
// ---------------------------------------------------------------------------

export type TodoItemKind = 'task' | 'interview' | 'debrief' | 'follow_up' | 'outreach' | 'send_draft'
  | 'closing' | 'ready';

export interface TodoItem {
  /** stable across reloads: kind plus the id of the row it came from */
  key: string;
  kind: TodoItemKind;
  /** the row to act on: a todos, interviews, follow_ups or outreach id, or a job id */
  ref_id: string;
  title: string;
  detail: string;
  /** YYYY-MM-DD, or null for "whenever" */
  due: string | null;
  /** an interview's start, ISO */
  at?: string | null;
  job_id: string | null;
  company: string | null;
  url?: string | null;
  task?: TodoRow;
}

export interface TodoList {
  today: string;
  /** due today or earlier: the number on the tab */
  due_count: number;
  overdue: TodoItem[];
  today_items: TodoItem[];
  upcoming: TodoItem[];
  /** no date: things to get to */
  anytime: TodoItem[];
  swept_outreach: string[];
}

const ROUND: Record<string, string> = {
  recruiter_screen: 'Recruiter screen', hiring_manager: 'Hiring manager', case: 'Case',
  superday: 'Superday', panel: 'Panel', final: 'Final round',
};

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** How far ahead "upcoming" looks. Past that, it is not a to-do yet. */
export const TODO_HORIZON_DAYS = 14;

/**
 * Everything owed, bucketed by when. Refreshes follow-ups and settles timed-out outreach first,
 * as their own pages do, so the list matches what those pages would say.
 */
export async function todoList(db: D1Like, cfg: Config, now = new Date()): Promise<TodoList> {
  await refreshFollowUps(db, cfg);
  const today = etDay(now);
  const horizon = addDays(today, TODO_HORIZON_DAYS);
  const items: TodoItem[] = [];

  for (const t of await listTodos(db)) {
    items.push({
      key: `task-${t.id}`, kind: 'task', ref_id: t.id, title: t.title,
      detail: [t.job_title && `${t.job_title} at ${t.company}`, t.notes].filter(Boolean).join(' · '),
      due: t.due_at, job_id: t.job_id, company: t.company, url: t.url, task: t,
    });
  }

  // Interviews still pending: ahead of us is prep, behind us with no debrief is a debrief owed.
  const { results: interviews } = await db.prepare(
    `SELECT i.id, i.round, i.interviewer, i.interviewer_title, i.scheduled_at, i.debrief_at,
            j.id AS job_id, j.title, j.company
     FROM interviews i JOIN jobs j ON j.id = i.job_id
     WHERE i.outcome = 'pending' AND i.debrief_at IS NULL AND i.scheduled_at IS NOT NULL`,
  ).bind().all<{
    id: string; round: string; interviewer: string | null; interviewer_title: string | null;
    scheduled_at: string; debrief_at: string | null; job_id: string; title: string; company: string;
  }>();
  for (const i of interviews) {
    const at = new Date(i.scheduled_at);
    if (Number.isNaN(at.getTime())) continue;
    const day = etDay(at);
    const who = i.interviewer ? ` with ${i.interviewer}${i.interviewer_title ? `, ${i.interviewer_title}` : ''}` : '';
    const round = ROUND[i.round] ?? i.round;
    if (at.getTime() > now.getTime()) {
      if (day > horizon) continue;
      items.push({
        key: `interview-${i.id}`, kind: 'interview', ref_id: i.id, title: `${round}: ${i.title} at ${i.company}`,
        detail: `Interview${who}. Prep before it.`, due: day, at: i.scheduled_at, job_id: i.job_id, company: i.company,
      });
    } else {
      items.push({
        key: `debrief-${i.id}`, kind: 'debrief', ref_id: i.id, title: `Debrief: ${round} at ${i.company}`,
        detail: `${i.title}${who}. Record how it went while you remember.`, due: day, at: i.scheduled_at,
        job_id: i.job_id, company: i.company,
      });
    }
  }

  const { results: followUps } = await db.prepare(
    `SELECT f.id, f.kind, f.due_at, j.id AS job_id, j.title, j.company, j.url, s.applied_at, s.portal_url
     FROM follow_ups f JOIN jobs j ON j.id = f.job_id
     LEFT JOIN submissions s ON s.job_id = j.id
     WHERE f.done = 0 AND j.role_closed_at IS NULL AND j.status IN ('Applied', 'Interviewing')
     ORDER BY f.due_at`,
  ).bind().all<{
    id: string; kind: string; due_at: string; job_id: string; title: string; company: string;
    url: string | null; applied_at: string | null; portal_url: string | null;
  }>();
  for (const f of followUps) {
    items.push({
      key: `follow_up-${f.id}`, kind: 'follow_up', ref_id: f.id, title: `Follow up: ${f.title} at ${f.company}`,
      detail: f.applied_at ? `Applied ${f.applied_at.slice(0, 10)}, no word since.` : f.kind.replace(/_/g, ' '),
      due: f.due_at, job_id: f.job_id, company: f.company, url: f.portal_url ?? f.url,
    });
  }

  const outreach = await outreachDue(db, now);
  for (const o of outreach.due) {
    items.push({
      key: `outreach-${o.id}-${o.reason}`, kind: 'outreach', ref_id: o.id,
      title: `${o.reason[0].toUpperCase()}${o.reason.slice(1)}: ${o.contact_name} at ${o.company}`,
      detail: o.detail, due: today, job_id: o.job_id, company: o.company,
    });
  }

  // A drafted message is written and waiting on the person to send it.
  const { results: drafts } = await db.prepare(
    `SELECT o.id, o.company, o.contact_name, o.touch_kind, o.channel, o.drafted_at, o.job_id
     FROM outreach o LEFT JOIN jobs j ON j.id = o.job_id
     WHERE o.status = 'Drafted' AND (j.id IS NULL OR j.role_closed_at IS NULL)
     ORDER BY o.drafted_at`,
  ).bind().all<{
    id: string; company: string; contact_name: string; touch_kind: string; channel: string;
    drafted_at: string; job_id: string | null;
  }>();
  for (const d of drafts) {
    items.push({
      key: `send_draft-${d.id}`, kind: 'send_draft', ref_id: d.id,
      title: `Send: ${d.touch_kind.replace(/_/g, ' ')} to ${d.contact_name} at ${d.company}`,
      detail: `Drafted ${d.drafted_at.slice(0, 10)} for ${d.channel}. Send it yourself, then mark it Sent.`,
      due: null, job_id: d.job_id, company: d.company,
    });
  }

  // Roles still to apply to whose stated deadline falls inside the horizon.
  const { results: closing } = await db.prepare(
    `SELECT id, title, company, status, closes_at, closes_source FROM jobs
     WHERE status IN ('New', 'Generate', 'Complete') AND role_closed_at IS NULL
       AND closes_at IS NOT NULL AND closes_at >= ? AND closes_at <= ?
     ORDER BY closes_at`,
  ).bind(today, addDays(today, 7)).all<{
    id: string; title: string; company: string; status: string; closes_at: string; closes_source: string | null;
  }>();
  const closingIds = new Set(closing.map((c) => c.id));
  for (const c of closing) {
    items.push({
      key: `closing-${c.id}`, kind: 'closing', ref_id: c.id, title: `Apply before it closes: ${c.title} at ${c.company}`,
      detail: c.status === 'Complete' ? 'Documents are built.'
        : c.status === 'Generate' ? 'Queued for documents.' : 'Not queued yet.',
      due: c.closes_at, job_id: c.id, company: c.company,
    });
  }

  // Documents built, application not sent: the next step is the person's.
  const { results: ready } = await db.prepare(
    `SELECT id, title, company, status_changed_at FROM jobs
     WHERE status = 'Complete' AND role_closed_at IS NULL ORDER BY status_changed_at`,
  ).bind().all<{ id: string; title: string; company: string; status_changed_at: string | null }>();
  for (const r of ready) {
    if (closingIds.has(r.id)) continue;
    items.push({
      key: `ready-${r.id}`, kind: 'ready', ref_id: r.id, title: `Submit: ${r.title} at ${r.company}`,
      detail: `Documents ready${r.status_changed_at ? ` since ${r.status_changed_at.slice(0, 10)}` : ''}. Read them, then apply.`,
      due: null, job_id: r.id, company: r.company,
    });
  }

  const byDue = (a: TodoItem, b: TodoItem) => (a.due ?? '').localeCompare(b.due ?? '')
    || (a.at ?? '').localeCompare(b.at ?? '');
  const overdue = items.filter((i) => i.due && i.due < today).sort(byDue);
  const todayItems = items.filter((i) => i.due === today).sort(byDue);
  const upcoming = items.filter((i) => i.due && i.due > today).sort(byDue);
  const anytime = items.filter((i) => !i.due);
  return {
    today, due_count: overdue.length + todayItems.length,
    overdue, today_items: todayItems, upcoming, anytime, swept_outreach: outreach.swept,
  };
}
