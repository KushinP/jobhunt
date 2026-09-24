import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardNames, greenhouseRef, jobPostingFromHtml, leverRef, resolvePosting, slugGuesses,
} from '../src/posting.ts';
import { formatRange } from '../src/salary.ts';

const LONG = 'Own the operating cadence and build the models. '.repeat(30);

test('links are recognised by the system that hosts them', () => {
  assert.deepEqual(greenhouseRef('https://job-boards.greenhouse.io/anthropic/jobs/4567890'), { slug: 'anthropic', id: '4567890' });
  assert.deepEqual(greenhouseRef('https://careers.formlabs.com/job/8084250/apply/?gh_jid=8084250'), { slug: null, id: '8084250' });
  assert.deepEqual(greenhouseRef('https://boards.greenhouse.io/embed/job_app?for=vts&token=123'), { slug: 'vts', id: '123' });
  assert.equal(greenhouseRef('https://jobs.ashbyhq.com/ramp/abc'), null);
  assert.deepEqual(leverRef('https://jobs.lever.co/canarytechnologies/271f1ef8-573f-4967-b0f9-c71629ac893e/apply'),
    { slug: 'canarytechnologies', id: '271f1ef8-573f-4967-b0f9-c71629ac893e' });
  assert.deepEqual(slugGuesses('https://careers.formlabs.com/job/1'), ['formlabs']);
});

test('salary ranges read like a posting', () => {
  assert.equal(formatRange(175000, 250000), '$175,000 - $250,000');
  assert.equal(formatRange(40, 55, 'HOUR'), '$40 - $55 / hour');
  assert.equal(formatRange(null, null), null);
});

test('the schema.org JobPosting block becomes a role', () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Pricing Strategy and Operations',
    hiringOrganization: { '@type': 'Organization', name: 'Sierra' },
    jobLocation: { '@type': 'Place', address: { addressLocality: 'San Francisco', addressRegion: 'CA' } },
    baseSalary: { value: { minValue: 220000, maxValue: 250000, unitText: 'YEAR' } },
    description: `&lt;p&gt;${LONG}&lt;/p&gt;`,
  })}</script></html>`;
  const r = jobPostingFromHtml(html)!;
  assert.equal(r.title, 'Pricing Strategy and Operations');
  assert.equal(r.company, 'Sierra');
  assert.equal(r.location, 'San Francisco, CA');
  assert.equal(r.salary, '$220,000 - $250,000');
  assert.ok(r.jd_text!.startsWith('Own the operating cadence') && !r.jd_text!.includes('<p>'));
  assert.equal(jobPostingFromHtml('<html><script type="application/ld+json">{"@type":"Organization"}</script></html>'), null);
});

test('a Greenhouse careers-site link resolves through the API, with pay and the known company name', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/formlabs/jobs/8084250')) {
      return new Response(JSON.stringify({
        title: 'Head of FP&A', company_name: 'Formlabs Inc', location: { name: 'Somerville, MA' },
        content: `&lt;p&gt;${LONG}&lt;/p&gt;`, absolute_url: 'https://careers.formlabs.com/job/8084250',
        pay_input_ranges: [{ min_cents: 17500000, max_cents: 25000000 }],
      }));
    }
    return new Response('nope', { status: 404 });
  };
  const r = await resolvePosting('https://careers.formlabs.com/job/8084250/apply/?gh_jid=8084250', fetcher as typeof fetch,
    boardNames({ greenhouse: ['formlabs:Formlabs'] }));
  assert.equal(r.via, 'greenhouse');
  assert.equal(r.company, 'Formlabs', 'the watched-board name wins, so it dedupes with board postings');
  assert.equal(r.salary, '$175,000 - $250,000');
  assert.ok(!r.jd_text!.includes('&lt;'));
});

test('a site that refuses automated reading says so plainly', async () => {
  const r = await resolvePosting('https://www.indeed.com/viewjob?jk=1',
    (async () => new Response('', { status: 401 })) as typeof fetch);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /blocks automated reading.*Paste the job description/);
});
