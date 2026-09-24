import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.ts';
import {
  upsertEvidence, setEvidenceStatus, listEvidence, deleteEvidence, evidenceSummary,
} from '../src/evidence.ts';

test('user-stated evidence is confirmed on entry; resume-extracted evidence waits for review', async () => {
  const { db } = makeTestDb();
  await upsertEvidence(db, {
    kind: 'project', title: 'Built the computer-use PMS agent', source: 'user',
    ownership: 'built_myself', context: 'Acme',
  });
  await upsertEvidence(db, {
    kind: 'accomplishment', title: 'Contracted 12 hotel clients', source: 'resume',
    source_ref: 'Master_resume.docx', context: 'Acme',
  });
  const all = await listEvidence(db);
  assert.equal(all.find((e) => e.source === 'user')!.status, 'confirmed');
  assert.equal(all.find((e) => e.source === 'resume')!.status, 'unconfirmed',
    'a claim lifted from a document is not true just because it was written down');
});

test('confirming stamps the time, and a rejection is kept as a record', async () => {
  const { db } = makeTestDb();
  const id = await upsertEvidence(db, {
    kind: 'accomplishment', title: 'Contracted 12 hotel clients', source: 'resume',
    source_ref: 'master.docx',
  });
  await setEvidenceStatus(db, id, 'rejected', 'Only 1 live and 1 verbal; 12 were prospects');
  const [e] = await listEvidence(db);
  assert.equal(e.status, 'rejected');
  assert.match(e.notes!, /prospects/);

  await setEvidenceStatus(db, id, 'confirmed');
  assert.ok((await listEvidence(db))[0].confirmed_at);
});

test('dates must be MM/YYYY or Present, so nothing drifts on the way into a resume', async () => {
  const { db } = makeTestDb();
  await assert.rejects(() => upsertEvidence(db, {
    kind: 'project', title: 'DealScout', source: 'user', start_date: 'Sept. 2023',
  }), /MM\/YYYY/);
  await assert.rejects(() => upsertEvidence(db, {
    kind: 'project', title: 'DealScout', source: 'user', start_date: '13/2026',
  }), /MM\/YYYY/);
  await upsertEvidence(db, {
    kind: 'project', title: 'DealScout', source: 'user', start_date: '03/2026', end_date: 'Present',
  });
  assert.equal((await listEvidence(db)).length, 1);
});

test('filtering by archetype keeps untagged items, which support everything', async () => {
  const { db } = makeTestDb();
  await upsertEvidence(db, { kind: 'skill', title: 'Python', source: 'user' });
  await upsertEvidence(db, { kind: 'project', title: 'DealScout', source: 'user', archetypes: [2, 3] });
  await upsertEvidence(db, { kind: 'project', title: 'Voice agent demos', source: 'user', archetypes: [1] });

  const cre = (await listEvidence(db, { archetype: 2 })).map((e) => e.title).sort();
  assert.deepEqual(cre, ['DealScout', 'Python']);
  const ai = (await listEvidence(db, { archetype: 1 })).map((e) => e.title).sort();
  assert.deepEqual(ai, ['Python', 'Voice agent demos']);
});

test('boundaries sort first, so anything reading the bank meets them before the claims', async () => {
  const { db } = makeTestDb();
  await upsertEvidence(db, { kind: 'skill', title: 'Python', source: 'user' });
  await upsertEvidence(db, {
    kind: 'boundary', title: 'No completed institutional real estate transactions', source: 'user',
  });
  assert.equal((await listEvidence(db))[0].kind, 'boundary');
});

test('tools and archetypes round-trip as arrays', async () => {
  const { db } = makeTestDb();
  await upsertEvidence(db, {
    kind: 'project', title: 'Callsheet', source: 'user',
    tools: ['TypeScript', 'Twilio', 'Supabase'], archetypes: [1, 4],
  });
  const [e] = await listEvidence(db);
  assert.deepEqual(e.tools, ['TypeScript', 'Twilio', 'Supabase']);
  assert.deepEqual(e.archetypes, [1, 4]);
});

test('editing keeps the id; the summary counts by kind and status', async () => {
  const { db } = makeTestDb();
  const id = await upsertEvidence(db, { kind: 'skill', title: 'Pythn', source: 'user' });
  await upsertEvidence(db, { id, kind: 'skill', title: 'Python', source: 'user', level: 'strong' });
  const [e] = await listEvidence(db);
  assert.equal(e.id, id);
  assert.equal(e.title, 'Python');
  assert.deepEqual(await evidenceSummary(db), { skill: { confirmed: 1 } });
  await deleteEvidence(db, id);
  assert.equal((await listEvidence(db)).length, 0);
});
