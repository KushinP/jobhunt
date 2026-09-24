import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ingestJobs } from '../src/repo.ts';
import { fetchMissingJds } from '../src/jds.ts';
import { linkedinJobId, blockedForServer, resolvePosting } from '../src/posting.ts';

const BODY = 'Run the operating cadence for the business operations team: weekly business reviews, '
  + 'KPI dashboards, planning and forecasting, cross-functional projects with product and finance. '
  + 'The salary range for this role is $95,000 - $120,000. ';
const LI_HTML = `<section><h2 class="top-card-layout__title font-sans topcard__title">Business Operations Associate</h2>
<a class="topcard__org-name-link topcard__flavor--black-link" href="#">Acme</a>
<span class="topcard__flavor topcard__flavor--bullet">Boston, MA</span>
<div class="description__text"><section class="show-more-less-html"><div class="show-more-less-html__markup relative">
<p>${BODY.repeat(6)}</p></div><button>Show more</button></section></div>
<ul><li><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Entry level</span></li></ul></section>`;

const fetcher = (async (url: string) => {
  if (url.startsWith('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4442199088')) return new Response(LI_HTML);
  if (url.startsWith('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/')) return new Response('gone', { status: 404 });
  return new Response('<html><title>x</title></html>', { status: 404 });
}) as typeof fetch;

test('LinkedIn job ids are read from every link shape it sends', () => {
  assert.equal(linkedinJobId('https://www.linkedin.com/comm/jobs/view/4393464351/?trackingId=abc'), '4393464351');
  assert.equal(linkedinJobId('https://www.linkedin.com/jobs/view/strategy-at-anonymous-4469902695'), '4469902695');
  assert.equal(linkedinJobId('https://www.linkedin.com/jobs/search/?currentJobId=4442199088'), '4442199088');
  assert.equal(linkedinJobId('https://example.com/jobs/view/4442199088'), null);
  assert.equal(blockedForServer('https://to.indeed.com/aab6vvdxvx6c'), 'Indeed');
  assert.equal(blockedForServer('https://www.ziprecruiter.com/job-redirect?x=1'), 'ZipRecruiter');
});

test('a LinkedIn link resolves through the public job endpoint, with pay and seniority', async () => {
  const r = await resolvePosting('https://www.linkedin.com/comm/jobs/view/4442199088/?trk=x', fetcher);
  assert.equal(r.via, 'linkedin');
  assert.equal(r.title, 'Business Operations Associate');
  assert.equal(r.company, 'Acme');
  assert.equal(r.url, 'https://www.linkedin.com/jobs/view/4442199088/');
  assert.equal(r.salary, '$95,000 - $120,000');
  assert.match(r.jd_text!, /Seniority level: Entry level/);
});

test('missing JDs are filled on the server; blocked sites go to a connector list; failures wait three days', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, DEFAULT_CONFIG, 'linkedin_email', [
    { title: 'Business Operations Associate', company: 'Acme', location: 'Boston, MA', url: 'https://www.linkedin.com/jobs/view/4442199088/' },
    { title: 'Business Operations Analyst', company: 'Gone Co', location: 'Boston, MA', url: 'https://www.linkedin.com/jobs/view/1111111111/' },
    { title: 'Strategy and Operations Associate', company: 'ZipCo', location: 'Boston, MA', url: 'https://www.ziprecruiter.com/job-redirect?match_token=abc' },
  ]);
  const dry = await fetchMissingJds(db, DEFAULT_CONFIG, { fetcher, dryRun: true, gapMs: 0 });
  assert.equal(dry.attached.length, 1);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM jobs WHERE jd_text IS NOT NULL").get() as { n: number }).n, 0, 'a dry run writes nothing');

  const r = await fetchMissingJds(db, DEFAULT_CONFIG, { fetcher, gapMs: 0 });
  assert.deepEqual(r.attached.map((a) => a.company), ['Acme']);
  assert.deepEqual(r.failed.map((f) => f.company), ['Gone Co']);
  assert.deepEqual(r.needs_connector.map((n) => [n.company, n.site]), [['ZipCo', 'ZipRecruiter']]);
  const acme = raw.prepare("SELECT salary, length(jd_text) AS len FROM jobs WHERE company = 'Acme'").get() as { salary: string; len: number };
  assert.equal(acme.salary, '$95,000 - $120,000');
  assert.ok(acme.len >= 800);

  const again = await fetchMissingJds(db, DEFAULT_CONFIG, { fetcher, gapMs: 0 });
  assert.equal(again.failed.length, 0, 'a role that just failed is not retried for three days');
  assert.equal(again.attached.length, 0);
});

test('when LinkedIn throttles, the server backs off, then leaves the rest untouched for the next call', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, DEFAULT_CONFIG, 'linkedin_email', [
    { title: 'Business Operations Associate', company: 'Acme', location: 'Boston, MA', url: 'https://www.linkedin.com/jobs/view/4442199088/' },
    { title: 'Business Operations Analyst', company: 'Beta', location: 'Boston, MA', url: 'https://www.linkedin.com/jobs/view/2222222222/' },
  ]);
  let calls = 0;
  const throttled = (async () => { calls++; return new Response('slow down', { status: 429 }); }) as typeof fetch;
  const r = await fetchMissingJds(db, DEFAULT_CONFIG, { fetcher: throttled, gapMs: 0, retryMs: 1 });
  assert.equal(r.rate_limited, true);
  assert.equal(r.failed.length, 0, 'throttling is not a failure');
  assert.equal(r.remaining, 2);
  assert.equal(calls, 3, 'three tries on the first role, none on the rest once throttled');
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM jobs WHERE jd_fetch_failed_at IS NOT NULL').get() as { n: number }).n, 0);
});
