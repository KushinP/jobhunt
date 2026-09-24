import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jd as fullJd, NEUTRAL } from './fixtures.ts';
import { makeTestDb } from './helpers.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { loadConfig } from '../src/repo.ts';
import { savePreferences } from '../src/preferences.ts';
import { scheduledTaskPrompts } from '../src/tasks.ts';
import { scoreJob } from '../src/score.ts';

const CITIES = [
  { name: 'Boston', search: 'Boston, MA', match: ['boston', 'cambridge'] },
  { name: 'New York', search: 'New York, NY', match: ['new york', 'nyc', 'manhattan', 'brooklyn'] },
  { name: 'San Francisco', search: 'San Francisco, CA', match: ['san francisco', 'sf', 'bay area'] },
];

test('saving preferences fills the matching application answers, so they never disagree', async () => {
  const { db, raw } = makeTestDb();
  const r = await savePreferences(db, await loadConfig(db), {
    relocation: 'for_the_right_role', comp_target: 130000, earliest_start: '2026-10-15',
    sponsorship_needed: false,
  });
  const get = (f: string) =>
    (raw.prepare('SELECT value FROM profile WHERE field = ?').get(f) as { value: string }).value;
  assert.equal(get('willing_to_relocate'), 'Open to it for the right role');
  assert.equal(get('salary_expectation'), '$130,000 base');
  assert.equal(get('earliest_start_date'), '2026-10-15');
  assert.equal(get('requires_sponsorship'), 'No');
  assert.equal(r.synced_answers.length, 4);
});

test('a partial update keeps everything else', async () => {
  const { db } = makeTestDb();
  await savePreferences(db, await loadConfig(db), { comp_floor: 90000, work_modes: ['hybrid'] });
  await savePreferences(db, await loadConfig(db), { industries_avoid: ['tobacco'] });
  const p = (await loadConfig(db)).preferences;
  assert.equal(p.comp_floor, 90000);
  assert.deepEqual(p.work_modes, ['hybrid']);
  assert.deepEqual(p.industries_avoid, ['tobacco']);
});

test('bad values are refused with a reason', async () => {
  const { db } = makeTestDb();
  const c = await loadConfig(db);
  await assert.rejects(() => savePreferences(db, c, { work_modes: ['beach' as never] }), /work_modes/);
  await assert.rejects(() => savePreferences(db, c, { comp_floor: 150000, comp_target: 100000 }), /below/);
  await assert.rejects(() => savePreferences(db, c, { earliest_start: 'next month' }), /YYYY-MM-DD/);
  await assert.rejects(() => savePreferences(db, c, { sources: ['myspace'] }), /unknown sources/);
  await assert.rejects(() => savePreferences(db, c, {
    target_cities: [{ name: 'NYC', search: 'New York, NY', match: [] }],
  }), /match term/);
});

test('choosing an unsupported platform warns instead of failing silently later', async () => {
  const { db } = makeTestDb();
  const r = await savePreferences(db, await loadConfig(db), { sources: ['company_boards', 'email_alerts'] });
  assert.ok(r.warnings.some((w) => /job-alert emails .* is not built yet/i.test(w)));
});

test('choosing a browser platform says it runs on demand, not on the schedule', async () => {
  const { db } = makeTestDb();
  const r = await savePreferences(db, await loadConfig(db), { sources: ['company_boards', 'handshake'] });
  assert.ok(r.warnings.some((w) => /Handshake runs when you ask, in your own Chrome/.test(w)), r.warnings.join(' | '));
});

test('three cities do not multiply daily searches, because cities rotate by weekday', async () => {
  const { db } = makeTestDb();
  const r = await savePreferences(db, await loadConfig(db), {
    sources: ['indeed'], target_cities: CITIES,
  });
  assert.ok(!r.warnings.some((w) => /searches a day/.test(w)), r.warnings.join(' | '));
});

test('the search prompt rotates cities by weekday and names each day', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: {
    ...DEFAULT_CONFIG.preferences, sources: ['indeed'], target_cities: CITIES,
  } };
  const [search] = scheduledTaskPrompts(cfg);
  assert.match(search.prompt, /Monday "Boston, MA", Tuesday "New York, NY", Wednesday "San Francisco, CA", Thursday "Boston, MA", Friday "New York, NY"/);
  assert.match(search.prompt, /retry that call once; if it fails again, stop calling that source/);
  assert.match(search.prompt, /`days` 7/, 'a city searched once a week needs a week of postings');
  assert.match(search.prompt, /`fetch_jds` with no ids/, 'descriptions are read on the server first');
  assert.match(search.prompt, /Do NOT mark it Unverified/, 'an unreadable posting waits in New, not Unverified');
  assert.match(search.prompt, /`search_indeed`[^\n]*ingests on the server, so do NOT pass its results to ingest_jobs/);
  assert.doesNotMatch(search.prompt, /Indeed connector[^\n]*for the first six queries/, 'Indeed search runs through Apify, the connector only finds JDs');
});

test('a role in any target city counts as local; one elsewhere and on-site is filtered', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: { ...DEFAULT_CONFIG.preferences, target_cities: CITIES } };
  const jd = 'Series B venture-backed SaaS. Forecasting, budgeting, pricing, financial modeling, excel, kpi.';
  for (const loc of ['New York, NY', 'Brooklyn, NY', 'San Francisco, CA', 'Cambridge, MA']) {
    const r = scoreJob(cfg, { title: 'Strategic Finance Analyst', company: 'X', location: loc, jd });
    assert.equal(r.excluded, false, `${loc} should be local`);
    assert.equal(r.breakdown && (r.breakdown as { location: number }).location, 15);
  }
  const far = scoreJob(cfg, { title: 'Strategic Finance Analyst', company: 'X', location: 'Denver, CO', jd });
  assert.equal(far.excluded, true);
});

test('generated scheduled prompts only mention the sources that are turned on', () => {
  const on = { ...DEFAULT_CONFIG, preferences: {
    ...DEFAULT_CONFIG.preferences, sources: ['company_boards', 'indeed'], target_cities: CITIES,
  } };
  const [search] = scheduledTaskPrompts(on);
  assert.match(search.prompt, /search_company_boards/);
  assert.match(search.prompt, /Indeed/);
  assert.match(search.prompt, /"New York, NY"/);
  assert.match(search.prompt, /"San Francisco, CA"/);
  assert.doesNotMatch(search.prompt, /search_linkedin/, 'LinkedIn was not chosen');

  const withLi = { ...on, preferences: { ...on.preferences, sources: ['linkedin'] } };
  assert.match(scheduledTaskPrompts(withLi)[0].prompt, /search_linkedin/);
});

test('the build prompt restricts tailoring to confirmed evidence and boundaries', () => {
  const build = byId(scheduledTaskPrompts(DEFAULT_CONFIG), 'jobhunt-build-docs');
  assert.match(build.prompt, /list_evidence.*confirmed/s);
  assert.match(build.prompt, /boundary/);
  assert.match(build.prompt, /get_base_resume/, 'reads masters from the connector, not a local folder');
  assert.match(build.prompt, /resume_claims.*not done.*stop/s, 'refuses to build from an unreviewed bank');
  assert.doesNotMatch(build.prompt, /01_Resumes_Base/);
  assert.match(build.prompt, /never call `mark_applied`/, 'explicitly forbids marking applied');
  // and it is the only mention: no step tells the run to call it
  assert.equal(build.prompt.match(/mark_applied/g)!.length, 1);
});

test('ZipRecruiter and Dice run through their Claude connectors, not a server-side key', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: {
    ...DEFAULT_CONFIG.preferences, sources: ['ziprecruiter', 'dice'], target_cities: CITIES,
  } };
  const [search] = scheduledTaskPrompts(cfg);
  assert.match(search.prompt, /\*\*ZipRecruiter\*\* connector \(`search_jobs`\)/);
  assert.match(search.prompt, /"New York, NY"/, 'ZipRecruiter covers every target city across the week');
  assert.match(search.prompt, /\*\*Dice\*\* connector/);
  assert.doesNotMatch(search.prompt, /search_ziprecruiter/, 'the old key-based tool is gone');
  assert.doesNotMatch(search.prompt, /search_indeed/, 'Indeed was not chosen');
});

test('Dice is scoped to the technical archetypes only', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: { ...DEFAULT_CONFIG.preferences, sources: ['dice'] } };
  const [search] = scheduledTaskPrompts(cfg);
  assert.match(search.prompt, /archetype 1 only/, 'with the default archetypes only AI implementation is technical');
});

test('the volume warning compares each connector to its own limit, not their sum', async () => {
  const { db } = makeTestDb();
  // the default query set is about 16 searches per connector: under the limit on each
  let r = await savePreferences(db, await loadConfig(db), {
    sources: ['indeed', 'ziprecruiter'], target_cities: CITIES,
  });
  assert.ok(!r.warnings.some((w) => /searches a day/.test(w)), r.warnings.join(' | '));

  // a much larger query set does push each connector over
  const big = await loadConfig(db);
  big.query_set = Array.from({ length: 20 }, (_, i) => ({ q: `Role ${i}`, archetype: 1, scope: 'both' as const }));
  r = await savePreferences(db, big, { sources: ['indeed', 'ziprecruiter'] });
  assert.ok(r.warnings.some((w) => /40 searches a day on each of indeed and ziprecruiter/.test(w)), r.warnings.join(' | '));
});

test('ZipRecruiter now needs a connector like Indeed, so onboarding checks it was actually used', async () => {
  const { SOURCES } = await import('../src/sources.ts');
  const zr = SOURCES.find((s) => s.id === 'ziprecruiter')!;
  assert.equal(zr.status, 'connector');
  assert.equal(zr.cost, 'Free');
});

test('connector prompts carry the filters that keep results relevant', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: {
    ...DEFAULT_CONFIG.preferences, sources: ['ziprecruiter', 'dice'], target_cities: CITIES,
    comp_floor: 95000,
  } };
  const [search] = scheduledTaskPrompts(cfg);
  assert.match(search.prompt, /seniority_classes` \["NO_EXPERIENCE", "JUNIOR"\]/, 'ZipRecruiter otherwise lets senior roles through');
  assert.match(search.prompt, /salary_min` 95000/, 'the comp floor is applied at the source');
  assert.match(search.prompt, /do not page/, 'paging would double the calls');
  assert.match(search.prompt, /employer_types` \["Direct Hire"\]/, 'Dice otherwise returns recruiters');
  assert.match(search.prompt, /AI-powered search/, 'Dice requires its disclosure');
});

test('with no comp floor set, no salary filter is invented', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: { ...DEFAULT_CONFIG.preferences, sources: ['ziprecruiter'] } };
  assert.doesNotMatch(scheduledTaskPrompts(cfg)[0].prompt, /salary_min/);
});

test('browser-only platforms are named in the search prompt so they are not mistaken for broken', () => {
  const cfg = { ...DEFAULT_CONFIG, preferences: {
    ...DEFAULT_CONFIG.preferences, sources: ['company_boards', 'handshake'], target_cities: CITIES,
  } };
  const tasks = scheduledTaskPrompts(cfg);
  const [search, build, weekly] = ['jobhunt-search', 'jobhunt-build-docs', 'jobhunt-weekly'].map((id) => byId(tasks, id));
  assert.match(search.prompt, /browser only, not run/);
  assert.match(build.prompt, /get_base_resume` with `archetype`/);
  assert.match(build.prompt, /Build BOTH files before saving either/);
  assert.match(weekly.prompt, /Never call `send_message`, `reply` or `forward`/);
  assert.match(weekly.prompt, /set_companies/);
});

const byId = <T extends { task_id: string }>(tasks: T[], id: string) => tasks.find((t) => t.task_id === id)!;

test('the four tasks run search, sweep, build in that order on weekdays, and every prompt names the statuses', () => {
  const tasks = scheduledTaskPrompts(DEFAULT_CONFIG);
  assert.deepEqual(tasks.map((t) => t.task_id), ['jobhunt-search', 'jobhunt-sweep', 'jobhunt-build-docs', 'jobhunt-weekly']);
  const minute = (id: string) => { const [m, h] = byId(tasks, id).cron.split(' ').map(Number); return h * 60 + m; };
  assert.ok(minute('jobhunt-search') < minute('jobhunt-sweep') && minute('jobhunt-sweep') < minute('jobhunt-build-docs'));
  for (const t of tasks) assert.match(t.prompt, /STATUS NAMES/, t.task_id);
});

test('the sweep only moves roles down and leaves the person\'s own decisions alone', () => {
  const sweep = byId(scheduledTaskPrompts(DEFAULT_CONFIG), 'jobhunt-sweep').prompt;
  assert.match(sweep, /only ever move roles DOWN/);
  assert.match(sweep, /`status_set_by` is "you"/);
  assert.match(sweep, /more than 2 years/, 'the level rule follows max_years_required');
  assert.doesNotMatch(sweep, /`set_status` "Generate"/);
  assert.match(sweep, /never call `mark_applied`/);
});

test('LinkedIn alert emails are read only when that source is on, and only these go to ingest_jobs', () => {
  const on = { ...DEFAULT_CONFIG, preferences: { ...DEFAULT_CONFIG.preferences, sources: ['linkedin', 'linkedin_alerts', 'ziprecruiter'] } };
  const search = byId(scheduledTaskPrompts(on), 'jobhunt-search').prompt;
  assert.match(search, /jobalerts-noreply@linkedin\.com newer_than:3d/);
  assert.match(search, /Do not mark, label, archive or reply to any email/);
  assert.match(search, /Only ZipRecruiter and LinkedIn alert-email results go to `ingest_jobs`/);
  assert.match(search, /"linkedin_email"/);
  const off = byId(scheduledTaskPrompts(DEFAULT_CONFIG), 'jobhunt-search').prompt;
  assert.doesNotMatch(off, /jobalerts-noreply/);
});
