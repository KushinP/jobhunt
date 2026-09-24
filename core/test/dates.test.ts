import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jd as fullJd } from './fixtures.ts';
import { makeTestDb } from './helpers.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { closingDateFromJd, toIsoDate } from '../src/dates.ts';
import { salaryFromJd } from '../src/salary.ts';
import { attachJd, closesFor, ingestJobs } from '../src/repo.ts';
import { jobPostingFromHtml } from '../src/posting.ts';

const NOW = new Date('2026-09-21T12:00:00Z');

test('a deadline tied to applying is read in each common form', () => {
  assert.equal(closingDateFromJd('Apply by October 2, 2026 to be considered.', NOW), '2026-10-02');
  assert.equal(closingDateFromJd('Application deadline: 10/15/2026', NOW), '2026-10-15');
  assert.equal(closingDateFromJd('Applications close on Friday, Oct. 30th 2026.', NOW), '2026-10-30');
  assert.equal(closingDateFromJd('Deadline to apply is 2026-11-01.', NOW), '2026-11-01');
  assert.equal(closingDateFromJd('We are accepting applications until 5 November 2026', NOW), '2026-11-05');
  assert.equal(closingDateFromJd('Job posting end date: 12/1/26', NOW), '2026-12-01');
});

test('a deadline with no year is the next one to come round', () => {
  assert.equal(closingDateFromJd('Apply by October 2.', NOW), '2026-10-02');
  assert.equal(closingDateFromJd('Applications are due January 15.', NOW), '2027-01-15');
});

test('dates that are not deadlines are ignored', () => {
  assert.equal(closingDateFromJd('Founded September 30, 2019. Posted 9/1/2026.', NOW), null);
  assert.equal(closingDateFromJd('Start date: January 5, 2027. Apply by clicking the link below.', NOW), null);
  assert.equal(closingDateFromJd('Applications close when the role is filled.', NOW), null);
  assert.equal(closingDateFromJd('Apply by February 30, 2027', NOW), null, 'not a real day');
  assert.equal(closingDateFromJd(null, NOW), null);
});

test('dates from a source or a person are normalised', () => {
  assert.equal(toIsoDate('2026-10-02T23:59:00Z'), '2026-10-02');
  assert.equal(toIsoDate('September 30, 2026'), '2026-09-30');
  assert.equal(toIsoDate('9/30/2026'), '2026-09-30');
  assert.equal(toIsoDate('soon'), null);
  assert.equal(toIsoDate(20261002), null);
});

test('pay stated in a JD becomes a salary, and money that is not pay does not', () => {
  assert.equal(salaryFromJd('About us.\nThe base salary range for this role is $120,000 - $150,000 plus equity.'),
    '$120,000 - $150,000');
  assert.equal(salaryFromJd('Compensation: $95k'), '$95,000');
  assert.equal(salaryFromJd('Pay: $40 - $50 per hour'), '$40 - $50 / hour');
  assert.equal(salaryFromJd('You will own a $300k budget and report on revenue.'), null);
  assert.equal(salaryFromJd('We raised $50M in Series B funding.'), null);
  assert.equal(salaryFromJd('Competitive salary and benefits.'), null);
});

test('a stated deadline outranks a listing expiry, and a listing expiry is kept as a hint', () => {
  assert.deepEqual(closesFor({ closes_at: '2026-10-20', closes_source: 'listing', jd_text: 'Apply by October 2, 2026.' }),
    { at: '2026-10-02', source: 'stated' });
  assert.deepEqual(closesFor({ closes_at: '2026-10-20', closes_source: 'listing', jd_text: 'No dates here.' }),
    { at: '2026-10-20', source: 'listing' });
  assert.deepEqual(closesFor({ closes_at: 'Oct 9, 2026' }), { at: '2026-10-09', source: 'stated' });
  assert.deepEqual(closesFor({ jd_text: null }), { at: null, source: null });
});

test('ingest fills salary and closing date from the JD, and the pipeline view carries them', async () => {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, DEFAULT_CONFIG, 'test', [{
    title: 'Business Operations Associate', company: 'Acme', location: 'Boston, MA',
    jd_text: fullJd('Run the operating cadence.\nThe salary range is $90,000 - $110,000.\nApply by December 1, 2027.'),
  }]);
  const row = raw.prepare('SELECT salary, closes_at, closes_source FROM v_pipeline').get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { salary: '$90,000 - $110,000', closes_at: '2027-12-01', closes_source: 'stated' });
});

test('a later stated deadline replaces a listing expiry, but never a date the person set', async () => {
  const { db, raw } = makeTestDb();
  const r = await ingestJobs(db, DEFAULT_CONFIG, 'test', [{
    title: 'Business Operations Associate', company: 'Acme', location: 'Boston, MA',
    closes_at: '2027-11-30', closes_source: 'listing',
  }]);
  const id = r.inserted[0].id;
  const read = () => ({ ...(raw.prepare('SELECT closes_at, closes_source FROM jobs WHERE id = ?').get(id) as object) });
  assert.deepEqual(read(), { closes_at: '2027-11-30', closes_source: 'listing' });

  await attachJd(db, DEFAULT_CONFIG, id, fullJd('Applications close on November 15, 2027.'));
  assert.deepEqual(read(), { closes_at: '2027-11-15', closes_source: 'stated' });

  raw.prepare("UPDATE jobs SET closes_at = '2027-12-24', closes_source = 'you' WHERE id = ?").run(id);
  await ingestJobs(db, DEFAULT_CONFIG, 'test', [{
    title: 'Business Operations Associate', company: 'Acme', closes_at: '2027-10-01',
  }]);
  assert.deepEqual(read(), { closes_at: '2027-12-24', closes_source: 'you' });
});

test('a JobPosting block gives the posted date and the listing expiry', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting', title: 'Strategy & Operations Associate', hiringOrganization: { name: 'Sierra' },
    datePosted: '2026-09-10T08:00:00.000Z', validThrough: '2026-10-10T08:00:00.000Z', description: 'x',
  })}</script>`;
  const r = jobPostingFromHtml(html)!;
  assert.equal(r.posted_at, '2026-09-10');
  assert.equal(r.closes_at, '2026-10-10');
  assert.equal(r.closes_source, 'listing');
});
