import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.ts';
import { jd as fullJd } from './fixtures.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ingestJobs, recordSubmission, saveDocument, setStatus } from '../src/repo.ts';
import type { D1Like } from '../src/repo.ts';
import {
  addBusinessDays, businessDaysBetween, listOutreach, logOutreach, normalizeCompany,
  outreachDue, outreachMetrics, sweepNoReply, updateOutreach, OUTREACH_STATUS_SQL,
} from '../src/outreach.ts';

const AI_JD = fullJd('Drive AI adoption for enterprise clients. Own implementation and onboarding.');
const cfg = DEFAULT_CONFIG;

/** A role in the pipeline, optionally taken all the way to Applied so outreach is allowed. */
async function role(db: D1Like, company: string, applied = true): Promise<string> {
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company, location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const { id } = (await db.prepare('SELECT id FROM jobs WHERE company = ?').bind(company)
    .first<{ id: string }>())!;
  if (applied) {
    await saveDocument(db, { job_id: id, kind: 'resume', content: new TextEncoder().encode('PK r'), filename: 'r.docx' });
    await setStatus(db, id, 'Complete', 'human');
    await recordSubmission(db, { job_id: id });
    await setStatus(db, id, 'Applied', 'human');
  }
  return id;
}

const draft = (db: D1Like, over: Record<string, unknown> = {}) => logOutreach(db, {
  company: 'Acme', contact_name: 'Dana Reed', channel: 'linkedin', touch_kind: 'connect_note',
  body: 'Saw the hotel launch. I built something adjacent.', ...over,
} as never);

/** Days ago, as a stored UTC timestamp. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

test('business days skip the weekend, in both directions', () => {
  assert.equal(addBusinessDays('2026-09-24', 3), '2026-09-29', 'Thursday + 3 lands on Tuesday');
  assert.equal(addBusinessDays('2026-09-25', 1), '2026-09-28', 'Friday + 1 is Monday');
  assert.equal(addBusinessDays('2026-09-25', 7), '2026-10-06');
  assert.equal(businessDaysBetween('2026-09-25', '2026-09-28'), 1, 'Friday to Monday is one');
  assert.equal(businessDaysBetween('2026-09-24', '2026-10-01'), 5);
  assert.equal(businessDaysBetween('2026-09-28', '2026-09-28'), 0);
  assert.equal(normalizeCompany('Acme Group, Inc.'), normalizeCompany('acme us'));
});

test('a. Sent, Accepted, Replied and Meeting are yours; automation is refused', async () => {
  const { db } = makeTestDb();
  const job = await role(db, 'Acme');
  const { id } = await draft(db, { job_id: job });
  for (const status of ['Sent', 'Accepted', 'Replied', 'Meeting'] as const) {
    await assert.rejects(() => updateOutreach(db, id, { status }, 'automation'), /Rule a/, status);
  }
  const sent = await updateOutreach(db, id, { status: 'Sent' }, 'you');
  assert.equal(sent.status, 'Sent');
  assert.equal(sent.status_set_by, 'you');
  assert.ok(sent.sent_at);
});

test('b. a touch cannot be sent before the application it follows', async () => {
  const { db } = makeTestDb();
  const notApplied = await role(db, 'Acme', false);
  const { id } = await draft(db, { job_id: notApplied });
  await assert.rejects(() => updateOutreach(db, id, { status: 'Sent' }, 'you'), /Rule b/);

  // create_role is the exception: there is no posting to have applied to
  const c = await logOutreach(db, {
    company: 'Globex', contact_name: 'Sam Fox', channel: 'email', touch_kind: 'create_role',
    body: 'No posting, but here is what I would do in the first 90 days.',
  });
  assert.equal((await updateOutreach(db, c.id, { status: 'Sent' }, 'you')).status, 'Sent');
});

test('c. one company, one message a day', async () => {
  const { db } = makeTestDb();
  const job = await role(db, 'Acme Group, Inc.');
  const first = await draft(db, { job_id: job, company: 'Acme Group, Inc.' });
  await updateOutreach(db, first.id, { status: 'Sent' }, 'you');

  const second = await draft(db, { job_id: job, company: 'Acme US', contact_name: 'Lee Park' });
  await assert.rejects(() => updateOutreach(db, second.id, { status: 'Sent' }, 'you'), /Rule c/,
    'the same company under another spelling still counts');

  // tomorrow it goes out
  const tomorrow = new Date(Date.now() + 86_400_000);
  assert.equal((await updateOutreach(db, second.id, { status: 'Sent' }, 'you', tomorrow)).status, 'Sent');
});

test('d. two touches per contact, and only one of them a nudge', async () => {
  const { db } = makeTestDb();
  const job = await role(db, 'Acme');
  const first = await draft(db, { job_id: job });
  await updateOutreach(db, first.id, { status: 'Sent' }, 'you');
  const nudge = await draft(db, { job_id: job, touch_kind: 'nudge', parent_id: first.id });

  await assert.rejects(() => draft(db, { job_id: job, touch_kind: 'nudge' }), /Rule d/, 'a second nudge');
  await assert.rejects(() => draft(db, { job_id: job, touch_kind: 'connect_note' }), /Rule d/, 'a third cold touch');
  await assert.rejects(() => draft(db, { job_id: job, touch_kind: 'follow_up' }), /Rule d/,
    'a follow-up before they answered is a third cold touch');

  // once they accept, a follow-up is a conversation rather than a cold touch
  await updateOutreach(db, nudge.id, { status: 'Accepted' }, 'you');
  const reply = await draft(db, { job_id: job, touch_kind: 'follow_up', parent_id: first.id });
  assert.ok(reply.id);
});

test('e. marking Sent sets the follow-up three business days out', async () => {
  const { db } = makeTestDb();
  const job = await role(db, 'Acme');
  const { id } = await draft(db, { job_id: job });
  const friday = new Date('2026-09-25T15:00:00Z');
  const sent = await updateOutreach(db, id, { status: 'Sent' }, 'you', friday);
  assert.equal(sent.follow_up_due, '2026-09-30', 'Friday plus three business days is Wednesday');
});

test('f. a nudge is due seven business days after the first message', async () => {
  const { db, raw } = makeTestDb();
  const job = await role(db, 'Acme');
  const { id } = await draft(db, { job_id: job });
  await updateOutreach(db, id, { status: 'Sent' }, 'you');
  raw.prepare('UPDATE outreach SET sent_at = ? WHERE id = ?').run(daysAgo(11), id);

  const { due } = await outreachDue(db);
  const nudge = due.find((d) => d.reason === 'nudge due');
  assert.ok(nudge, `expected a nudge, got ${JSON.stringify(due.map((d) => d.reason))}`);
  assert.ok(nudge!.business_days_waited >= 7);
});

test('g and h. automation may settle an unanswered nudge, and nothing else', async () => {
  const { db, raw } = makeTestDb();
  const job = await role(db, 'Acme');
  const first = await draft(db, { job_id: job });
  await updateOutreach(db, first.id, { status: 'Sent' }, 'you');
  const nudge = await draft(db, { job_id: job, touch_kind: 'nudge', parent_id: first.id });
  const tomorrow = new Date(Date.now() + 86_400_000);
  await updateOutreach(db, nudge.id, { status: 'Sent' }, 'you', tomorrow);

  await assert.rejects(() => updateOutreach(db, nudge.id, { status: 'No reply' }, 'automation'), /Rule g/,
    'too early');
  raw.prepare('UPDATE outreach SET sent_at = ? WHERE id = ?').run(daysAgo(9), nudge.id);
  const settled = await updateOutreach(db, nudge.id, { status: 'No reply' }, 'automation');
  assert.equal(settled.status, 'No reply');
  assert.equal(settled.status_set_by, 'automation');

  // rule h: an outcome you recorded is never overwritten
  raw.prepare("UPDATE outreach SET status = 'Replied', status_set_by = 'you', sent_at = ? WHERE id = ?")
    .run(daysAgo(9), first.id);
  await assert.rejects(() => updateOutreach(db, first.id, { status: 'No reply' }, 'automation'), /Rule h/);
});

test('the sweep settles timed-out nudges and the due list reports what is left', async () => {
  const { db, raw } = makeTestDb();
  const job = await role(db, 'Acme');
  const first = await draft(db, { job_id: job });
  await updateOutreach(db, first.id, { status: 'Sent' }, 'you');
  const nudge = await draft(db, { job_id: job, touch_kind: 'nudge', parent_id: first.id });
  await updateOutreach(db, nudge.id, { status: 'Sent' }, 'you', new Date(Date.now() + 86_400_000));
  raw.prepare('UPDATE outreach SET sent_at = ? WHERE id IN (?, ?)').run(daysAgo(20), first.id, nudge.id);

  const { swept, due } = await outreachDue(db);
  assert.deepEqual(swept, [nudge.id], 'the nudge timed out and was settled');
  assert.equal((await listOutreach(db, { status: 'No reply' })).length, 1);
  // the contact is settled, but the company is not: a second person there is the next move
  assert.deepEqual(due.map((d) => d.reason), ['backup due']);
  assert.equal(due[0].id, first.id);
});

test('an accepted connection with nothing sent into it is the top of the due list', async () => {
  const { db } = makeTestDb();
  const job = await role(db, 'Acme');
  const { id } = await draft(db, { job_id: job });
  await updateOutreach(db, id, { status: 'Sent' }, 'you');
  await updateOutreach(db, id, { status: 'Accepted' }, 'you');

  const { due } = await outreachDue(db);
  assert.equal(due[0].reason, 'accepted, follow-up not sent');
  assert.equal(due[0].contact_name, 'Dana Reed');
});

test('a quiet contact with no backup at the company asks for one after three business days', async () => {
  const { db, raw } = makeTestDb();
  const job = await role(db, 'Acme');
  const { id } = await draft(db, { job_id: job });
  await updateOutreach(db, id, { status: 'Sent' }, 'you');
  raw.prepare('UPDATE outreach SET sent_at = ? WHERE id = ?').run(daysAgo(6), id);
  const { due } = await outreachDue(db);
  assert.equal(due[0].reason, 'backup due');
});

test('metrics: rates, the breakdowns, and the warning when it is not working', async () => {
  const { db, raw } = makeTestDb();
  const job = await role(db, 'Acme');
  // 16 sent, 2 replies: a 12.5% reply rate, which should raise the warning
  for (let n = 0; n < 16; n++) {
    const company = `Company ${n}`;
    const j = n === 0 ? job : await role(db, company);
    const t = await logOutreach(db, {
      job_id: j, company: n === 0 ? 'Acme' : company, contact_name: `Contact ${n}`,
      channel: 'linkedin', touch_kind: 'connect_note', body: 'hello',
      hook_type: n % 2 === 0 ? 'origin_story' : 'contact_post',
      contact_type: n % 2 === 0 ? 'founder' : 'recruiter',
    });
    raw.prepare(`UPDATE outreach SET status = 'Sent', status_set_by = 'you', sent_at = ? WHERE id = ?`)
      .run(daysAgo(n + 1), t.id);
    if (n === 0) raw.prepare(`UPDATE outreach SET status = 'Replied', replied_at = ? WHERE id = ?`).run(daysAgo(1), t.id);
    if (n === 1) raw.prepare(`UPDATE outreach SET status = 'Meeting', replied_at = ? WHERE id = ?`).run(daysAgo(1), t.id);
  }
  const m = await outreachMetrics(db);
  assert.equal(m.sent, 16);
  assert.equal(m.replied, 1);
  assert.equal(m.meeting, 1);
  assert.equal(m.reply_rate, 0.125);
  assert.equal(m.warning, true, 'sent 15+ and under a 15% reply rate');
  assert.match(m.warning_text!, /reply rate/);
  assert.equal(m.by_hook_type.find((h) => h.key === 'origin_story')?.sent, 8);
  assert.equal(m.by_contact_type.find((h) => h.key === 'recruiter')?.replies, 1);
  assert.equal(m.interview_rate.with_outreach.applied + m.interview_rate.without_outreach.applied,
    16, 'every applied role lands on one side or the other');
});

test('nothing in the module can send: a draft stays Drafted until a person says otherwise', async () => {
  const { db } = makeTestDb();
  const job = await role(db, 'Acme');
  const { id, status } = await draft(db, { job_id: job });
  assert.equal(status, 'Drafted');
  await sweepNoReply(db);
  const [row] = await listOutreach(db, { job_id: job }) as { status: string; sent_at: string | null }[];
  assert.equal(row.status, 'Drafted');
  assert.equal(row.sent_at, null);
  assert.equal((await outreachDue(db)).due.length, 0, 'a draft is not chased');
  await assert.rejects(() => updateOutreach(db, id, {}, 'you'), /nothing to change/);
});

test('the pipeline badge and filter read the most advanced touch for a role', async () => {
  const { db, raw } = makeTestDb();
  const quiet = await role(db, 'Quiet Co');
  const drafted = await role(db, 'Drafted Co');
  const sent = await role(db, 'Sent Co');
  const replied = await role(db, 'Replied Co');

  await logOutreach(db, { job_id: drafted, company: 'Drafted Co', contact_name: 'A', channel: 'email', touch_kind: 'connect_note', body: 'x' });
  const s = await logOutreach(db, { job_id: sent, company: 'Sent Co', contact_name: 'B', channel: 'email', touch_kind: 'connect_note', body: 'x' });
  await updateOutreach(db, s.id, { status: 'Sent' }, 'you');
  const r = await logOutreach(db, { job_id: replied, company: 'Replied Co', contact_name: 'C', channel: 'email', touch_kind: 'connect_note', body: 'x' });
  await updateOutreach(db, r.id, { status: 'Sent' }, 'you', new Date(Date.now() + 86_400_000));
  await updateOutreach(db, r.id, { status: 'Replied' }, 'you');

  const rows = raw.prepare(
    `SELECT id, ${OUTREACH_STATUS_SQL('jobs.id')} AS outreach_status FROM jobs`).all() as
    { id: string; outreach_status: string }[];
  const of = (id: string) => rows.find((x) => x.id === id)!.outreach_status;
  assert.equal(of(quiet), 'none');
  assert.equal(of(drafted), 'drafted');
  assert.equal(of(sent), 'sent');
  assert.equal(of(replied), 'replied');

  // what list_pipeline does with `outreach: "sent"`
  const filtered = raw.prepare(
    `SELECT id FROM jobs WHERE ${OUTREACH_STATUS_SQL('jobs.id')} = 'sent'`).all() as { id: string }[];
  assert.deepEqual(filtered.map((x) => x.id), [sent]);
});
