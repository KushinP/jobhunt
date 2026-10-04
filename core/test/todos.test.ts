import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.ts';
import { jd as fullJd } from './fixtures.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ingestJobs, recordSubmission, saveDocument, setRoleClosed, setStatus } from '../src/repo.ts';
import type { D1Like } from '../src/repo.ts';
import { logOutreach } from '../src/outreach.ts';
import { addTodo, completeTodo, deleteTodo, listTodos, todoList } from '../src/todos.ts';

const cfg = DEFAULT_CONFIG;
const JD = fullJd('Drive AI adoption for enterprise clients. Own implementation and onboarding.');
// a Wednesday, noon Eastern
const NOW = new Date('2026-10-07T16:00:00Z');
const TODAY = '2026-10-07';

async function role(db: D1Like, company: string): Promise<string> {
  await ingestJobs(db, cfg, 'test', [{ title: 'AI Solutions Consultant', company, location: 'Boston, MA', jd_text: JD }]);
  return (await db.prepare('SELECT id FROM jobs WHERE company = ?').bind(company).first<{ id: string }>())!.id;
}

async function ready(db: D1Like, id: string): Promise<void> {
  await saveDocument(db, { job_id: id, kind: 'resume', content: new TextEncoder().encode('PK r'), filename: 'r.docx' });
  await setStatus(db, id, 'Complete', 'human');
}

test('addTodo validates its input and links a role', async () => {
  const { db } = makeTestDb();
  const id = await role(db, 'Acme');
  await assert.rejects(addTodo(db, { title: '  ' }, 'you'), /title/);
  await assert.rejects(addTodo(db, { title: 'x', kind: 'nonsense' }, 'you'), /kind/);
  await assert.rejects(addTodo(db, { title: 'x', due_at: 'next friday' }, 'you'), /YYYY-MM-DD/);
  await assert.rejects(addTodo(db, { title: 'x', url: 'javascript:alert(1)' }, 'you'), /url/);
  await assert.rejects(addTodo(db, { title: 'x', job_id: 'missing' }, 'you'), /No role/);

  const t = await addTodo(db, { title: 'HireVue', kind: 'assessment', job_id: id, due_at: '2026-10-09T23:59' }, 'claude');
  const [row] = await listTodos(db);
  assert.equal(row.id, t.id);
  assert.equal(row.due_at, '2026-10-09');
  assert.equal(row.company, 'Acme');
  assert.equal(row.created_by, 'claude');
});

test('completeTodo hides a to-do and can reopen it; deleteTodo removes it', async () => {
  const { db } = makeTestDb();
  const { id } = await addTodo(db, { title: 'Codility test' }, 'you');
  assert.equal(await completeTodo(db, id), true);
  assert.equal((await listTodos(db)).length, 0);
  assert.equal((await listTodos(db, { includeDone: true })).length, 1);
  await completeTodo(db, id, false);
  assert.equal((await listTodos(db)).length, 1);
  assert.equal(await deleteTodo(db, id), true);
  assert.equal(await completeTodo(db, 'missing'), false);
});

test('todoList buckets tasks, interviews, debriefs, deadlines and ready roles by when', async () => {
  const { db } = makeTestDb();
  const a = await role(db, 'Acme');
  const b = await role(db, 'Beta');
  const c = await role(db, 'Gamma');

  await addTodo(db, { title: 'Late HireVue', kind: 'assessment', due_at: '2026-10-05' }, 'you');
  await addTodo(db, { title: 'HireVue today', kind: 'assessment', due_at: TODAY, job_id: a }, 'you');
  await addTodo(db, { title: 'Someday', kind: 'other' }, 'you');

  await ready(db, a);
  await recordSubmission(db, { job_id: a });
  await setStatus(db, a, 'Applied', 'human');
  await setStatus(db, a, 'Interviewing', 'human');
  const iv = (id: string, at: string, debrief: string | null = null) => db.prepare(
    `INSERT INTO interviews (id, job_id, round, scheduled_at, debrief_at) VALUES (?, ?, 'recruiter_screen', ?, ?)`,
  ).bind(id, a, at, debrief).run();
  await iv('i-next', '2026-10-09T14:00:00-04:00');
  await iv('i-past', '2026-10-06T10:00:00-04:00');
  await iv('i-done', '2026-10-01T10:00:00-04:00', '2026-10-02');
  await iv('i-far', '2026-12-01T10:00:00-04:00');

  await ready(db, b);
  await db.prepare('UPDATE jobs SET closes_at = ? WHERE id = ?').bind('2026-10-10', b).run();
  await ready(db, c);

  const list = await todoList(db, cfg, NOW);
  const keys = (xs: { key: string }[]) => xs.map((x) => x.key.split('-')[0]);
  assert.deepEqual(list.overdue.map((x) => x.title), ['Late HireVue', 'Debrief: Recruiter screen at Acme']);
  assert.deepEqual(list.today_items.map((x) => x.title), ['HireVue today']);
  assert.deepEqual(keys(list.upcoming), ['interview', 'closing']);
  assert.equal(list.upcoming[1].job_id, b);
  // the ready role with a deadline is listed once, under its deadline
  assert.deepEqual(list.anytime.map((x) => x.title).sort(),
    ['Someday', 'Submit: AI Solutions Consultant at Gamma']);
  assert.equal(list.due_count, 3);
  assert.ok(![...list.upcoming, ...list.overdue].some((x) => x.ref_id === 'i-done' || x.ref_id === 'i-far'));
});

test('todoList leaves out closed roles and lists drafts waiting to be sent', async () => {
  const { db } = makeTestDb();
  const a = await role(db, 'Acme');
  await ready(db, a);
  await db.prepare('UPDATE jobs SET closes_at = ? WHERE id = ?').bind('2026-10-09', a).run();
  await recordSubmission(db, { job_id: a });
  await setStatus(db, a, 'Applied', 'human');
  await logOutreach(db, {
    company: 'Acme', contact_name: 'Dana Reed', channel: 'linkedin', touch_kind: 'connect_note',
    body: 'Saw the launch.', job_id: a,
  } as never);
  let list = await todoList(db, cfg, NOW);
  assert.deepEqual(list.anytime.map((x) => x.kind), ['send_draft']);

  await setRoleClosed(db, a, true, 'human');
  list = await todoList(db, cfg, NOW);
  assert.equal(list.anytime.length, 0);
});
