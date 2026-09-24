import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jd as fullJd, NEUTRAL } from './fixtures.ts';
import { makeTestDb } from './helpers.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import {
  ingestJobs, setStatus, rescoreJob, listQueue, saveDocument, getDocument,
  recordSubmission, refreshFollowUps, loadConfig, putConfig, setRating, addManualJob, deleteDocument,
  HumanOnlyStatusError, attachJd, statusSetBy, updateJobDetails,
} from '../src/repo.ts';

const cfg = DEFAULT_CONFIG;
const AI_JD = fullJd(
  'Drive AI adoption for enterprise SaaS clients. Own implementation and onboarding, '
  + 'gather requirements, run training, cross-functional with product and go-to-market.');

test('ingest classifies, dedupes and reports malformed rows', async () => {
  const { db } = makeTestDb();
  const r = await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA',
      url: 'https://x.example/1', jd_text: AI_JD },
    { title: 'Summer Finance Intern', company: 'Northwind AI', location: 'Boston, MA',
      jd_text: 'Internship for rising seniors.' },
    { title: 'Product Designer', company: 'Pixel Co', location: 'Denver, CO',
      jd_text: 'On-site design role in Denver.' },
    { title: 'AI Solutions Consultant', company: 'Northwind AI!', location: 'Boston, MA',
      url: 'https://x.example/1-repost', jd_text: 'Repost under a new URL.' },
    { title: '', company: 'Broken Co' },
  ]);

  assert.equal(r.found, 5);
  assert.equal(r.kept, 1);
  assert.equal(r.auto_generate, 1);
  assert.equal(r.discarded, 2);
  assert.equal(r.duplicates, 1, 'the repost must collide with the original');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].reason, /missing title or company/);
});

test('a duplicate enriches the existing row without changing its status', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'indeed', [
    { title: 'Strategic Finance Analyst', company: 'Acme', location: 'Boston, MA' },
  ]);
  const before = raw.prepare('SELECT id, status, jd_text, salary FROM jobs').get() as
    { id: string; status: string; jd_text: string | null; salary: string | null };
  assert.equal(before.jd_text, null);

  // the human decides to skip it
  await setStatus(db, before.id, 'Skip', 'human');

  // tomorrow the same role reappears from another source, now with a JD and salary
  const r = await ingestJobs(db, cfg, 'linkedin', [
    { title: 'Strategic Finance Analyst', company: 'ACME', location: 'Boston, MA',
      jd_text: 'Forecasting, budgeting, financial modeling.', salary: '$120,000' },
  ]);

  const after = raw.prepare('SELECT status, jd_text, salary FROM jobs WHERE id = ?')
    .get(before.id) as { status: string; jd_text: string | null; salary: string | null };
  assert.equal(r.duplicates, 1);
  assert.equal(after.status, 'Skip', 'a human decision must survive re-ingestion');
  assert.equal(after.salary, '$120,000', 'missing fields are filled in');
  assert.ok(after.jd_text, 'the JD is captured on the second sighting');
});

test('automation cannot write a human-only status', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const { raw } = { raw: null as never };
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;

  await assert.rejects(
    () => setStatus(db, id, 'Applied', 'automation'),
    (e: Error) => e instanceof HumanOnlyStatusError,
  );
  await assert.rejects(() => setStatus(db, id, 'Offer', 'automation'), HumanOnlyStatusError);

  // automation may still advance the pipeline to Complete, once the resume is built
  await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('PK resume'), filename: 'r.docx' });
  const moved = await setStatus(db, id, 'Complete', 'automation');
  assert.equal(moved.to, 'Complete');
});

test('the database refuses Applied without a submission record', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;

  await assert.rejects(
    () => setStatus(db, id, 'Applied', 'human'),
    /Applied requires a submission record/,
  );

  await saveDocument(db, {
    job_id: id, kind: 'resume', content: new TextEncoder().encode('PK fake docx'),
    filename: 'Resume_Northwind_AI_2026-09-17.docx', sha256: 'abc123',
  });
  await recordSubmission(db, { job_id: id, portal_url: 'https://apply.example' });
  const moved = await setStatus(db, id, 'Applied', 'human');
  assert.equal(moved.to, 'Applied');
});

test('the submission snapshot records the exact document that went out', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  const v1 = await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('version one'), filename: 'v1.docx', sha256: 'hash-v1' });
  await recordSubmission(db, { job_id: id });
  // a later revision must not rewrite what was already submitted
  await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('version two'), filename: 'v2.docx', sha256: 'hash-v2' });

  const sub = raw.prepare(
    'SELECT resume_document_id, resume_sha256 FROM submissions WHERE job_id = ?')
    .get(id) as { resume_document_id: string; resume_sha256: string };
  assert.equal(sub.resume_document_id, v1);
  assert.equal(sub.resume_sha256, 'hash-v1');

  // and the bytes come back exactly as they went in
  const back = await getDocument(db, v1);
  assert.equal(new TextDecoder().decode(back!.bytes), 'version one');
  assert.equal(back!.filename, 'v1.docx');
});

test('the build queue holds Generate rows without documents, best score first', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Implementation Consultant', company: 'Alpha', location: 'Boston, MA', jd_text: AI_JD },
    { title: 'AI Solutions Consultant', company: 'Beta', location: 'Remote', jd_text: AI_JD },
  ]);
  let queue = await listQueue(db);
  assert.equal(queue.length, 2);
  assert.equal((queue[0] as { company: string }).company, 'Alpha', 'higher score first');

  for (const kind of ['resume', 'cover_letter'] as const) {
    await saveDocument(db, {
      job_id: (queue[0] as { id: string }).id, kind,
      content: new TextEncoder().encode('a'), filename: `${kind}.docx`,
    });
  }
  queue = await listQueue(db);
  assert.equal(queue.length, 1, 'a fully built row leaves the queue');
});

test('re-scoring refreshes the score but never the status', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'Real Estate Acquisitions Analyst', company: 'Beacon', location: 'Boston, MA' },
  ]);
  const row = raw.prepare('SELECT id, score, status FROM jobs').get() as
    { id: string; score: number; status: string };
  await setStatus(db, row.id, 'Skip', 'human');

  raw.prepare('UPDATE jobs SET jd_text = ? WHERE id = ?').run(
    'Underwriting multifamily acquisitions, financial modeling, due diligence, cap rate, pro forma.',
    row.id);
  const sc = await rescoreJob(db, cfg, row.id);

  const after = raw.prepare('SELECT score, status FROM jobs WHERE id = ?').get(row.id) as
    { score: number; status: string };
  assert.ok(sc.score > row.score, 'the JD adds domain and skill hits');
  assert.equal(after.status, 'Skip');
});

test('status history records who moved each row', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (raw.prepare('SELECT id FROM jobs').get() as { id: string }).id;
  await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('PK resume'), filename: 'r.docx' });
  await setStatus(db, id, 'Complete', 'automation');
  await setStatus(db, id, 'Skip', 'human');
  // node:sqlite returns null-prototype rows; spread them so deep-equal compares values
  const hist = raw.prepare(
    'SELECT from_status, to_status, actor FROM status_history WHERE job_id = ? ORDER BY id')
    .all(id).map((r) => ({ ...(r as object) }));
  assert.deepEqual(hist, [
    { from_status: 'Generate', to_status: 'Complete', actor: 'automation' },
    { from_status: 'Complete', to_status: 'Skip', actor: 'human' },
  ]);
});

test('follow-ups appear only after the no-response window and only once', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (raw.prepare('SELECT id FROM jobs').get() as { id: string }).id;
  await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('a'), filename: 'a.docx' });
  await recordSubmission(db, { job_id: id });
  await setStatus(db, id, 'Applied', 'human');

  assert.equal(await refreshFollowUps(db, cfg), 0, 'nothing is due on the day of applying');

  raw.prepare("UPDATE submissions SET applied_at = datetime('now','-11 days') WHERE job_id = ?").run(id);
  assert.equal(await refreshFollowUps(db, cfg), 1);
  assert.equal(await refreshFollowUps(db, cfg), 0, 'a second run must not duplicate it');
});

test('config rows override defaults and a malformed row is ignored', async () => {
  const { db, raw } = makeTestDb();
  await putConfig(db, 'thresholds', { hard_cutoff: 70, auto_generate: 90 });
  raw.prepare("INSERT INTO config (key, value) VALUES ('weights', '{not json')").run();

  const loaded = await loadConfig(db);
  assert.deepEqual(loaded.thresholds, { hard_cutoff: 70, auto_generate: 90 });
  assert.deepEqual(loaded.weights, DEFAULT_CONFIG.weights, 'a broken row keeps the default');
});

test('a tightened threshold changes what auto-generates', async () => {
  const { db } = makeTestDb();
  await putConfig(db, 'thresholds', { hard_cutoff: 60, auto_generate: 97 });
  const tight = await loadConfig(db);
  const r = await ingestJobs(db, tight, 'test', [
    { title: 'AI Implementation Consultant', company: 'Gamma', location: 'Remote', jd_text: AI_JD },
  ]);
  assert.equal(r.kept, 1);
  assert.equal(r.auto_generate, 0, 'a 95 no longer clears a 97 bar');
});


test('a rating is stored, clearable, and range-checked', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (raw.prepare('SELECT id FROM jobs').get() as { id: string }).id;

  await setRating(db, id, 5);
  let row = raw.prepare('SELECT rating, rated_at FROM jobs WHERE id = ?').get(id) as
    { rating: number | null; rated_at: string | null };
  assert.equal(row.rating, 5);
  assert.ok(row.rated_at, 'rating time is recorded');

  await setRating(db, id, null);
  row = raw.prepare('SELECT rating, rated_at FROM jobs WHERE id = ?').get(id) as
    { rating: number | null; rated_at: string | null };
  assert.equal(row.rating, null);
  assert.equal(row.rated_at, null, 'clearing the rating clears its timestamp');

  await assert.rejects(() => setRating(db, id, 0), /1 to 5/);
  await assert.rejects(() => setRating(db, id, 6), /1 to 5/);
  await assert.rejects(() => setRating(db, id, 3.5), /1 to 5/);
  await assert.rejects(() => setRating(db, 'nope', 3), /no such job/);
});

test('a hand-entered role is scored by the same rules as an automated find', async () => {
  const { db } = makeTestDb();
  const r = await addManualJob(db, cfg, {
    title: 'AI Implementation Consultant', company: 'Referral Co', location: 'Boston, MA',
    url: 'https://referral.example/1', jd_text: AI_JD, rating: 5,
  });
  assert.equal(r.duplicate, false);
  assert.equal(r.score, 100);
  assert.equal(r.status, 'Generate', 'a strong manual entry queues for documents like any other');

  const row = await db.prepare('SELECT source, rating FROM jobs WHERE id = ?')
    .bind(r.id).first<{ source: string; rating: number }>();
  assert.equal(row!.source, 'manual');
  assert.equal(row!.rating, 5);
});

test('a hand-entered role cannot skip the exclusion rules', async () => {
  const { db } = makeTestDb();
  const r = await addManualJob(db, cfg, {
    title: 'Marketing Intern', company: 'Referral Co', location: 'Boston, MA',
    jd_text: 'Summer internship.',
  });
  assert.equal(r.status, 'Discarded', 'entering it by hand does not override the config');
});

test('entering a role that already exists returns the existing one, not a duplicate', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, cfg, 'indeed', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const existing = (raw.prepare('SELECT id FROM jobs').get() as { id: string }).id;
  await setStatus(db, existing, 'Skip', 'human');

  const r = await addManualJob(db, cfg, {
    title: 'AI Solutions  Consultant!', company: 'northwind ai', location: 'Boston, MA',
  });
  assert.equal(r.duplicate, true);
  assert.equal(r.id, existing);
  assert.equal(r.status, 'Skip', 'and its existing status is reported, not reset');
  assert.equal((raw.prepare('SELECT COUNT(*) c FROM jobs').get() as { c: number }).c, 1);
});

test('attaching a JD promotes a provisionally-held role to where its real score belongs', async () => {
  const { db } = makeTestDb();
  const r = await ingestJobs(db, cfg, 'indeed', [
    { title: 'AI Solutions Consultant', company: 'Cynergists AI', location: 'Remote' },
  ]);
  assert.equal(r.inserted[0].status, 'New');
  assert.equal(r.inserted[0].needs_jd, true);

  const moved = await attachJd(db, cfg, r.inserted[0].id, AI_JD);
  assert.equal(moved.moved, true);
  assert.equal(moved.to, 'Generate', 'a strong fit is queued once the JD proves it');
});

test('a JD that shows a poor fit discards the role it was holding', async () => {
  const { db } = makeTestDb();
  const r = await ingestJobs(db, cfg, 'indeed', [
    { title: 'Business Analyst', company: 'Hospital Co', location: 'Boston, MA' },
  ]);
  const moved = await attachJd(db, cfg, r.inserted[0].id,
    fullJd('Front desk scheduling, patient billing, and insurance verification.'));
  assert.equal(moved.to, 'Discarded');
});

test('a status the person set is never changed by a JD arriving later', async () => {
  const { db } = makeTestDb();
  const r = await ingestJobs(db, cfg, 'indeed', [
    { title: 'AI Solutions Consultant', company: 'Cynergists AI', location: 'Remote' },
  ]);
  await setStatus(db, r.inserted[0].id, 'Skip', 'human');
  const after = await attachJd(db, cfg, r.inserted[0].id, AI_JD);
  assert.equal(after.moved, false);
  assert.equal(after.to, 'Skip');
});

test('the queue says who queued each role, so the build honours a person\'s own choice', async () => {
  const { db } = makeTestDb();
  const r = await ingestJobs(db, cfg, 'indeed', [
    { title: 'AI Implementation Consultant', company: 'Auto Co', location: 'Boston, MA', jd_text: AI_JD },
    { title: 'Marketing Intern', company: 'Mine Co', location: 'Boston, MA', jd_text: 'Summer internship.' },
  ]);
  const intern = (await db.prepare("SELECT id FROM jobs WHERE company = 'Mine Co'").first<{ id: string }>())!.id;
  await setStatus(db, intern, 'Generate', 'human', 'Queued by you');
  const q = await listQueue(db) as { company: string; queued_by: string }[];
  assert.equal(r.auto_generate, 1);
  assert.equal(q.find((x) => x.company === 'Auto Co')!.queued_by, 'automation');
  assert.equal(q.find((x) => x.company === 'Mine Co')!.queued_by, 'you');
});

test('a built document can be deleted, and a role left with no resume stops claiming to be Ready', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  const resume = await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('PK bad build'), filename: 'bad.docx' });
  const letter = await saveDocument(db, { job_id: id, kind: 'cover_letter',
    content: new TextEncoder().encode('PK letter'), filename: 'letter.docx' });
  await setStatus(db, id, 'Complete', 'automation');

  const r = await deleteDocument(db, resume);
  assert.equal(r.status, 'New', 'Ready with no resume is not ready');
  assert.equal(await db.prepare('SELECT id FROM documents WHERE id = ?').bind(resume).first(), null);
  assert.ok(await db.prepare('SELECT id FROM documents WHERE id = ?').bind(letter).first(), 'only that file goes');
  await assert.rejects(() => deleteDocument(db, resume), /no such document/);
});

test('a document that went out with an application cannot be deleted', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  const sent = await saveDocument(db, { job_id: id, kind: 'resume',
    content: new TextEncoder().encode('PK sent'), filename: 'sent.docx' });
  await recordSubmission(db, { job_id: id });
  await assert.rejects(() => deleteDocument(db, sent), /went out with your application/);
  assert.ok(await db.prepare('SELECT id FROM documents WHERE id = ?').bind(sent).first());
});

test('automation cannot move a role off a status a person set', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  await saveDocument(db, { job_id: id, kind: 'resume', content: new TextEncoder().encode('PK'), filename: 'r.docx' });
  await recordSubmission(db, { job_id: id });
  await setStatus(db, id, 'Applied', 'human');
  await assert.rejects(() => setStatus(db, id, 'Skip', 'automation'), /which a person set/);
  const moved = await setStatus(db, id, 'Interviewing', 'human');
  assert.equal(moved.to, 'Interviewing', 'the person can still move it');
});

test('a half-built role stays in the build queue, marked with what is missing', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Half Built', location: 'Boston, MA', jd_text: AI_JD },
    { title: 'AI Implementation Consultant', company: 'Fully Built', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const half = (await db.prepare("SELECT id FROM jobs WHERE company = 'Half Built'").first<{ id: string }>())!.id;
  const full = (await db.prepare("SELECT id FROM jobs WHERE company = 'Fully Built'").first<{ id: string }>())!.id;
  const doc = (job_id: string, kind: 'resume' | 'cover_letter') =>
    saveDocument(db, { job_id, kind, content: new TextEncoder().encode('PK'), filename: `${kind}.docx` });
  await doc(half, 'resume');
  await doc(full, 'resume');
  await doc(full, 'cover_letter');
  const q = await listQueue(db) as { id: string; has_resume: number; has_cover_letter: number }[];
  assert.deepEqual(q.map((r) => r.id), [half]);
  assert.equal(q[0].has_resume, 1);
  assert.equal(q[0].has_cover_letter, 0);
});

test('a JD that arrives with a later sighting re-scores the role it was holding', async () => {
  const { db } = makeTestDb();
  const first = await ingestJobs(db, cfg, 'indeed', [
    { title: 'AI Solutions Consultant', company: 'Cynergists AI', location: 'Remote' },
  ]);
  assert.equal(first.inserted[0].status, 'New');
  await ingestJobs(db, cfg, 'linkedin', [
    { title: 'AI Solutions Consultant', company: 'Cynergists AI', location: 'Remote', jd_text: AI_JD },
  ]);
  const row = await db.prepare('SELECT status, length(jd_text) AS n FROM jobs').first<{ status: string; n: number }>();
  assert.ok(row!.n >= 800);
  assert.equal(row!.status, 'Generate', 'judged on the JD it now has');
});

test('Ready needs a built resume, whoever moves the role', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  await assert.rejects(() => setStatus(db, id, 'Complete', 'automation'), /resume is built/);
  await assert.rejects(() => setStatus(db, id, 'Complete', 'human'), /resume is built/);
  await saveDocument(db, { job_id: id, kind: 'resume', content: new TextEncoder().encode('PK r'), filename: 'r.docx' });
  assert.equal((await setStatus(db, id, 'Complete', 'human')).to, 'Complete');
});

test('status_set_by names who put a role where it is, and a chat move on the person\'s word is theirs', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  assert.equal(await statusSetBy(db, id), null, 'set by the scorer on arrival');
  await setStatus(db, id, 'Skip', 'automation');
  assert.equal(await statusSetBy(db, id), 'automation');
  await setStatus(db, id, 'Generate', 'human-via-chat', 'They said: "queue that one"');
  assert.equal(await statusSetBy(db, id), 'you');
  await setStatus(db, id, 'New', 'human');
  assert.equal(await statusSetBy(db, id), 'you');
});

test('the queue is in build order: stars first, unrated last, then score', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', ['Alpha', 'Beta', 'Gamma', 'Delta'].map((c) => (
    { title: 'AI Solutions Consultant', company: `${c} AI`, location: 'Boston, MA', jd_text: AI_JD })));
  const ids = Object.fromEntries((await db.prepare('SELECT id, company FROM jobs').bind().all<{ id: string; company: string }>())
    .results.map((r) => [r.company, r.id]));
  await db.prepare("UPDATE jobs SET status = 'Generate', score = CASE company WHEN 'Alpha AI' THEN 100 WHEN 'Beta AI' THEN 80 WHEN 'Gamma AI' THEN 90 ELSE 70 END").bind().run();
  await setRating(db, ids['Beta AI'], 3);
  await setRating(db, ids['Delta AI'], 5);
  const q = await listQueue(db, 10) as { company: string; rating: number | null; has_resume: number; has_cover_letter: number }[];
  assert.deepEqual(q.map((r) => r.company), ['Delta AI', 'Beta AI', 'Alpha AI', 'Gamma AI'],
    'a 5-star, then a 3-star, then unrated by score');
  assert.ok(q.every((r) => 'rating' in r && 'has_resume' in r && 'has_cover_letter' in r));
});

test('a role rated 1 or 2 stars is never queued or built', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;
  const status = async () => (await db.prepare('SELECT status FROM jobs WHERE id = ?').bind(id).first<{ status: string }>())!.status;
  assert.equal(await status(), 'Generate');

  assert.deepEqual(await setRating(db, id, 2), { moved_to: 'New' }, 'rating it low takes it out of Queued');
  assert.equal(await status(), 'New');
  assert.equal((await listQueue(db)).length, 0);
  await assert.rejects(() => setStatus(db, id, 'Generate', 'human'), /rated this role 2 stars/);
  await attachJd(db, cfg, id, AI_JD);
  assert.equal(await status(), 'New', 'a strong JD does not re-queue a role the person rated low');

  await setRating(db, id, 3);
  assert.equal((await setStatus(db, id, 'Generate', 'human')).to, 'Generate', 'a 3-star role can be queued again');
});

test('salary, location and the link can be corrected by hand; title and company cannot', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, cfg, 'test', [
    { title: 'AI Solutions Consultant', company: 'Northwind AI', location: 'BOS', jd_text: AI_JD },
  ]);
  const id = (await db.prepare('SELECT id FROM jobs').bind().first<{ id: string }>())!.id;

  const r = await updateJobDetails(db, id, { salary: ' $120,000 - $150,000 ', location: 'Boston, MA' });
  // node:sqlite hands back null-prototype rows; spread so deep-equal compares the values
  assert.deepEqual({ ...r }, { salary: '$120,000 - $150,000', location: 'Boston, MA', url: null });
  assert.equal((await updateJobDetails(db, id, { salary: '' })).salary, null, 'an empty box clears it');
  assert.equal((await updateJobDetails(db, id, { location: 'Remote' })).salary, null, 'a field left out is untouched');
  await assert.rejects(() => updateJobDetails(db, id, { url: 'pathai.com/job' }), /http/);
  await assert.rejects(() => updateJobDetails(db, id, {}), /nothing to change/);
  await assert.rejects(() => updateJobDetails(db, 'missing', { salary: '$1' }), /no such job/);
  assert.equal((await db.prepare('SELECT title FROM jobs WHERE id = ?').bind(id).first<{ title: string }>())!.title,
    'AI Solutions Consultant', 'the title is untouched: the duplicate key is built from it');
});
