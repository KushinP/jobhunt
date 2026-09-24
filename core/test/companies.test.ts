import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.ts';
import { jd } from './fixtures.ts';

const AI_JD = jd('Drive AI adoption for enterprise SaaS clients. Own implementation and onboarding, run training.');
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ingestJobs } from '../src/repo.ts';
import { getCompany, uncategorizedCompanies, upsertCompany } from '../src/companies.ts';

test('a company profile only takes values from the fixed lists', async () => {
  const { db } = makeTestDb();
  await assert.rejects(() => upsertCompany(db, 'Ramp', { industry: 'fin-tech' }, 'claude'), /industry must be one of/);
  await assert.rejects(() => upsertCompany(db, 'Ramp', { priority: 'maybe' as never }, 'you'), /priority must be one of/);
  const r = await upsertCompany(db, 'Ramp', { industry: 'Fintech', stage: 'Growth (Series C+)', tags: ['NYC HQ'] }, 'claude');
  assert.equal(r.saved, true);
  assert.deepEqual((await getCompany(db, 'Ramp'))!.tags, ['NYC HQ']);
  assert.equal((await getCompany(db, 'Ramp'))!.priority, 'neutral');
});

test('what the person set is never overwritten by Claude, but they can change anything', async () => {
  const { db } = makeTestDb();
  await upsertCompany(db, 'Glean', { industry: 'AI & ML', priority: 'target' }, 'you');
  const claude = await upsertCompany(db, 'Glean', { industry: 'Enterprise software' }, 'claude');
  assert.equal(claude.saved, false);
  assert.equal((await getCompany(db, 'Glean'))!.industry, 'AI & ML');
  await upsertCompany(db, 'Glean', { priority: 'avoid' }, 'you');
  const g = (await getCompany(db, 'Glean'))!;
  assert.equal(g.priority, 'avoid');
  assert.equal(g.industry, 'AI & ML', 'a partial edit keeps the other fields');
});

test('companies still to categorize come with titles and a JD excerpt to judge from', async () => {
  const { db } = makeTestDb();
  await ingestJobs(db, DEFAULT_CONFIG, 'test', [
    { title: 'AI Implementation Consultant', company: 'Northwind AI', location: 'Boston, MA', jd_text: AI_JD },
    { title: 'AI Solutions Consultant', company: 'Categorized Co', location: 'Boston, MA', jd_text: AI_JD },
  ]);
  await upsertCompany(db, 'Categorized Co', { industry: 'AI & ML' }, 'claude');
  const todo = await uncategorizedCompanies(db, { activeOnly: true });
  assert.deepEqual(todo.map((c) => c.name), ['Northwind AI']);
  assert.match(todo[0].titles, /AI Implementation Consultant/);
  assert.ok((todo[0].jd_excerpt ?? '').length > 100);
});
