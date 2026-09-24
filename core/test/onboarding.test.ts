import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jd as fullJd, NEUTRAL } from './fixtures.ts';
import { makeTestDb } from './helpers.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import {
  baseResumeForArchetype, deleteBaseResume, getBaseResume, listBaseResumes,
  listGoals, saveBaseResume, upsertGoal, deleteGoal, loadConfig, logRun,
} from '../src/repo.ts';
import { upsertEvidence, setEvidenceStatus } from '../src/evidence.ts';
import { savePreferences } from '../src/preferences.ts';
import { confirmSetupStep, onboardingStatus } from '../src/onboarding.ts';
import { scheduledTaskPrompts } from '../src/tasks.ts';

const cfg = DEFAULT_CONFIG;
const docx = (s: string) => new TextEncoder().encode(s);

test('a base resume round-trips, and re-uploading replaces rather than duplicates', async () => {
  const { db } = makeTestDb();
  const first = await saveBaseResume(db, {
    label: 'AI Implementation', archetype: 1,
    filename: 'Base_Resume_AI_Implementation.docx',
    content: docx('version one'), extracted_text: 'Jordan Example, Acme',
  });
  assert.equal(first.replaced, false);

  const again = await saveBaseResume(db, {
    label: 'AI Implementation', archetype: 1,
    filename: 'Base_Resume_AI_Implementation.docx', content: docx('version two'),
  });
  assert.equal(again.replaced, true);
  assert.equal(again.id, first.id, 'replacing keeps the same row so mappings stay stable');

  const all = await listBaseResumes(db);
  assert.equal(all.length, 1);

  const got = await getBaseResume(db, 'AI Implementation');
  assert.equal(new TextDecoder().decode(got!.bytes), 'version two');
});

test('resume selection prefers the archetype, then the configured filename, then anything', async () => {
  const { db } = makeTestDb();
  assert.equal(await baseResumeForArchetype(db, cfg, 1), null, 'nothing uploaded yet');

  await saveBaseResume(db, {
    label: 'Strategic Finance', archetype: 4,
    filename: 'Base_Resume_StrategicFinance.docx', content: docx('sf'),
  });
  // asking for archetype 1 with only a 4 uploaded still returns something usable
  const fallback = await baseResumeForArchetype(db, cfg, 1);
  assert.equal(fallback!.archetype, 4, 'falls back rather than failing the run');

  await saveBaseResume(db, {
    label: 'AI Implementation', archetype: 1,
    filename: 'Base_Resume_AI_Implementation.docx', content: docx('ai'),
  });
  const exact = await baseResumeForArchetype(db, cfg, 1);
  assert.equal(exact!.archetype, 1, 'the archetype match wins once it exists');
});

test('deleting a base resume removes it from selection', async () => {
  const { db } = makeTestDb();
  const r = await saveBaseResume(db, {
    label: 'Only One', archetype: 1, filename: 'x.docx', content: docx('x'),
  });
  await deleteBaseResume(db, r.id);
  assert.equal((await listBaseResumes(db)).length, 0);
  assert.equal(await baseResumeForArchetype(db, cfg, 1), null);
});

test('a countable goal reports real progress, a custom one does not pretend to', async () => {
  const { db } = makeTestDb();
  await upsertGoal(db, {
    kind: 'weekly_applications', title: 'Apply to 8 roles a week',
    target_value: 8, unit: 'applications',
  });
  await upsertGoal(db, { kind: 'custom', title: 'Reconnect with 3 CRE alumni' });

  const goals = await listGoals(db) as {
    kind: string; target_value: number | null; current_value: number | null; measurable: number;
  }[];
  const weekly = goals.find((g) => g.kind === 'weekly_applications')!;
  const custom = goals.find((g) => g.kind === 'custom')!;

  assert.equal(weekly.current_value, 0, 'nothing applied to yet');
  assert.equal(weekly.measurable, 1);
  assert.equal(custom.measurable, 0, 'a custom goal is not silently scored');
});

test('editing a goal keeps its id, and status can be closed out', async () => {
  const { db } = makeTestDb();
  const id = await upsertGoal(db, {
    kind: 'weekly_applications', title: 'Apply to 5 a week', target_value: 5,
  });
  const same = await upsertGoal(db, {
    id, kind: 'weekly_applications', title: 'Apply to 8 a week', target_value: 8,
  });
  assert.equal(same, id);

  await upsertGoal(db, { id, kind: 'weekly_applications', title: 'Apply to 8 a week', status: 'met' });
  assert.equal((await listGoals(db)).length, 0, 'closed goals drop off the active list');
  assert.equal((await listGoals(db, true)).length, 1);
});

test('a partial goal edit keeps the fields it leaves out, and null clears one', async () => {
  const { db, raw } = makeTestDb();
  const id = await upsertGoal(db, {
    kind: 'weekly_applications', title: 'Apply to 8 a week', target_value: 8, due_at: '2026-12-31', notes: 'keep',
  });
  await upsertGoal(db, { id, status: 'paused' });
  const read = () => ({ ...(raw.prepare('SELECT title, target_value, due_at, status, notes FROM goals WHERE id = ?').get(id) as object) });
  assert.deepEqual(read(), { title: 'Apply to 8 a week', target_value: 8, due_at: '2026-12-31', status: 'paused', notes: 'keep' });
  await upsertGoal(db, { id, due_at: null });
  assert.equal((read() as { due_at: unknown }).due_at, null);
  await assert.rejects(() => upsertGoal(db, { id: 'missing', status: 'met' }), /no goal/);
  await assert.rejects(() => deleteGoal(db, 'missing'), /no goal/);
  await assert.rejects(() => deleteBaseResume(db, 'missing'), /no base resume/);
});

test('a fresh account starts at the resume, and nothing is marked done on defaults alone', async () => {
  const { db } = makeTestDb();
  const s = await onboardingStatus(db, cfg);
  assert.equal(s.next!.key, 'resume');
  assert.equal(s.complete, false);
  const done = s.steps.filter((x) => x.done).map((x) => x.key);
  // target roles and preferences exist as defaults in code, but the person never chose them
  assert.ok(!done.includes('target_roles'), 'default archetypes are not the person\'s choice');
  assert.ok(!done.includes('preferences'));
  assert.ok(!done.includes('target_cities'));
});

test('resume claims are only done once every extracted claim has been reviewed', async () => {
  const { db } = makeTestDb();
  await saveBaseResume(db, { label: 'Master', filename: 'm.docx', content: docx('m') });
  const ids: string[] = [];
  for (const t of ['Founder and CEO, Acme', 'Contracted 12 clients', 'Raised pre-seed']) {
    ids.push(await upsertEvidence(db, { kind: 'accomplishment', title: t, source: 'resume', source_ref: 'm.docx' }));
  }
  let s = await onboardingStatus(db, cfg);
  assert.equal(s.next!.key, 'resume_claims');

  await setEvidenceStatus(db, ids[0], 'confirmed');
  await setEvidenceStatus(db, ids[1], 'rejected', 'one live property, not twelve');
  s = await onboardingStatus(db, cfg);
  assert.equal(s.steps.find((x) => x.key === 'resume_claims')!.done, false, 'one still unreviewed');

  await setEvidenceStatus(db, ids[2], 'confirmed');
  s = await onboardingStatus(db, cfg);
  assert.equal(s.steps.find((x) => x.key === 'resume_claims')!.done, true,
    'a rejection counts as reviewed');
});

test('the connectors step completes from a real search run, not from a claim', async () => {
  const { db } = makeTestDb();
  let c = await loadConfig(db);
  await savePreferences(db, c, { sources: ['company_boards', 'indeed'] });
  c = await loadConfig(db);
  let s = await onboardingStatus(db, c);
  assert.equal(s.steps.find((x) => x.key === 'connectors')!.done, false);

  await logRun(db, { kind: 'search', sources_used: ['company_boards'] });
  s = await onboardingStatus(db, c);
  assert.equal(s.steps.find((x) => x.key === 'connectors')!.done, false,
    'Indeed was chosen but never actually returned anything');

  await logRun(db, { kind: 'search', sources_used: ['company_boards', 'indeed'] });
  s = await onboardingStatus(db, c);
  assert.equal(s.steps.find((x) => x.key === 'connectors')!.done, true);
  assert.equal(s.steps.find((x) => x.key === 'scheduled_runs')!.done, true);
});

test('every step tells the assistant what to ask and which tool saves it', async () => {
  const { db } = makeTestDb();
  const s = await onboardingStatus(db, cfg);
  for (const step of s.steps) {
    assert.ok(step.ask.length > 0, `${step.key} has no instructions`);
    assert.ok(step.why.length > 20, `${step.key} does not say why it matters`);
  }
  assert.equal(new Set(s.steps.map((x) => x.key)).size, s.steps.length, 'step keys are unique');
});

test('saving one preference does not mark unrelated steps answered just because they have defaults', async () => {
  const { db } = makeTestDb();
  await savePreferences(db, await loadConfig(db), { comp_floor: 90000 });
  let s = await onboardingStatus(db, await loadConfig(db));
  const done = (k: string) => s.steps.find((x) => x.key === k)!.done;
  assert.equal(done('sources'), false, 'platforms have a default but were never chosen');
  assert.equal(done('target_cities'), false, 'Boston is a default, not an answer');
  assert.equal(done('preferences'), false, 'work modes still unanswered');

  await savePreferences(db, await loadConfig(db), { work_modes: ['hybrid', 'remote'] });
  await savePreferences(db, await loadConfig(db), { sources: ['company_boards', 'indeed'] });
  s = await onboardingStatus(db, await loadConfig(db));
  assert.equal(done('preferences'), true);
  assert.equal(done('sources'), true);
  assert.equal(done('target_cities'), false, 'still never asked');
});

test('a form that posts every field only marks the filled-in ones as answered', async () => {
  const { db } = makeTestDb();
  const c = await loadConfig(db);
  // what the dashboard used to send: the whole object, mostly blank
  await savePreferences(db, c, { ...c.preferences, comp_floor: null, work_modes: [], sources: ['indeed'] });
  const answered = (await loadConfig(db)).preferences.answered;
  assert.ok(answered.includes('sources'));
  assert.ok(!answered.includes('comp_floor'), 'a null floor is not an answer');
  assert.ok(!answered.includes('work_modes'), 'an empty list is not an answer');
});

test('the skills step is marked done only on the person\'s word, and can be undone', async () => {
  const { db } = makeTestDb();
  const step = async () => (await onboardingStatus(db, await loadConfig(db))).steps.find((x) => x.key === 'claude_skills')!;
  assert.equal((await step()).done, false);
  assert.equal((await step()).verified_by, 'confirmed');
  await confirmSetupStep(db, 'claude_skills');
  assert.equal((await step()).done, true);
  await confirmSetupStep(db, 'claude_skills', false);
  assert.equal((await step()).done, false);
  await assert.rejects(() => confirmSetupStep(db, 'scheduled_runs' as never), /checked from real activity/);
});

test('the scheduled runs step asks the assistant to create the tasks, with a paste fallback', async () => {
  const { db } = makeTestDb();
  const s = (await onboardingStatus(db, await loadConfig(db))).steps.find((x) => x.key === 'scheduled_runs')!;
  const text = s.ask.join('\n');
  assert.match(text, /Create them now/);
  assert.match(text, /copy-paste/);
  assert.match(text, /Never leave two copies/);
  assert.deepEqual(s.save_with, ['get_scheduled_task_prompts']);
  const tasks = scheduledTaskPrompts(DEFAULT_CONFIG);
  assert.ok(tasks.every((t) => t.cadence && t.cron && t.prompt.length > 500));
});

test('with a single master stored, every archetype gets that master rather than an error', async () => {
  const { db } = makeTestDb();
  await saveBaseResume(db, { label: 'Master resume', archetype: null, filename: 'Master.docx', content: docx('x') });
  for (const archetype of [1, 2, 4, 6, null]) {
    assert.equal((await baseResumeForArchetype(db, cfg, archetype))?.label, 'Master resume', `archetype ${archetype}`);
  }
});
