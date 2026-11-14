import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedInJob, parseVcJobsNewsletter } from '../src/vcjobs.ts';

const R = (n: number) => `https://substack.com/redirect/0000000${n}-test?j=x`;
// Lines from Volume 54 (2026-11-09), with the redirect links replaced.
const ISSUE = [
  'Weekly newsletter sharing the most comprehensive list of venture capital roles.',
  `Alumni Ventures is giving readers early access to high-potential startup opportunities [ ${R(1)} ] across today’s most active sectors.`,
  'Intern / Fellowship / Part Time',
  `🚨 Summer Analyst [ ${R(2)} ], Bessemer Venture Partners, NYC ($2,200/week + $5k relocation and housing bonus)`,
  'Analyst',
  `Analyst [ ${R(3)} ], Novartis Venture Fund (CVC), Cambridge, MA ($132-245k)`,
  `Analyst [ ${R(4)} ], Araya Ventures, London`,
  `Principal [ ${R(5)} ] (Next-Gen Compute), Triatomic Capital, SF`,
  `Operations Manager [ ${R(6)} ], 16VC, Remote (UK Preferred) ($50-75k)`,
  `Partnerships Manager [ ${R(7)} ], Plug In Ventures, Atlanta, GA (Open to remote) ($65-75k)`,
  `Marketing & Communications Manager [ ${R(8)} ], “$10B+ VC firm” - SCGC, NYC / SF`,
  `Venture Capital Jobs. LinkedIn [ ${R(9)} ].`,
  `Fellow [ ${R(10)} ], Civilization Ventures, Remote (Paid)`,
].join('\n');

test('the newsletter parses one role per line, with detail, location and pay apart', () => {
  const { roles, skipped } = parseVcJobsNewsletter(ISSUE);
  assert.equal(roles.length, 7);
  assert.deepEqual(roles[0], { title: 'Summer Analyst', company: 'Bessemer Venture Partners', location: 'NYC',
    salary: '$2,200/week + $5k relocation and housing bonus', redirect: R(2), flagged: true });
  assert.deepEqual(roles[1], { title: 'Analyst', company: 'Novartis Venture Fund (CVC)', location: 'Cambridge, MA',
    salary: '$132-245k', redirect: R(3), flagged: false });
  assert.equal(roles[2].salary, null);
  assert.equal(roles[3].title, 'Principal (Next-Gen Compute)');
  assert.equal(roles[4].location, 'Remote (UK Preferred)');
  assert.equal(roles[4].salary, '$50-75k');
  assert.equal(roles[5].location, 'Atlanta, GA (Open to remote)');
  assert.equal(roles[6].salary, 'Paid');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'employer not named');
});

test('LinkedIn links are normalised to the job view with its id', () => {
  assert.deepEqual(linkedInJob('https://www.linkedin.com/jobs/view/analyst-at-acme-4469920249?trk=x'),
    { url: 'https://www.linkedin.com/jobs/view/4469920249/', id: '4469920249' });
  assert.deepEqual(linkedInJob('https://www.linkedin.com/comm/jobs/view/4469920249/?tracking=1'),
    { url: 'https://www.linkedin.com/jobs/view/4469920249/', id: '4469920249' });
  assert.deepEqual(linkedInJob('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4469920249'),
    { url: 'https://www.linkedin.com/jobs/view/4469920249/', id: '4469920249' });
  assert.equal(linkedInJob('https://jobs.ashbyhq.com/acme/123'), null);
});

test('newsletter links are followed through redirectors only, never to the destination', async () => {
  const { resolveNewsletterLink } = await import('../src/vcjobs.ts');
  const asked: string[] = [];
  const hops: Record<string, string> = {
    'https://substack.com/redirect/abc': 'https://lnkd.in/xyz',
    'https://lnkd.in/xyz': 'https://www.linkedin.com/jobs/view/4469920249/',
  };
  const fake = (async (u: string) => {
    asked.push(u);
    return new Response(null, { status: hops[u] ? 302 : 200, headers: hops[u] ? { location: hops[u] } : {} });
  }) as unknown as typeof fetch;
  assert.equal(await resolveNewsletterLink('https://substack.com/redirect/abc', fake),
    'https://www.linkedin.com/jobs/view/4469920249/');
  assert.deepEqual(asked, ['https://substack.com/redirect/abc', 'https://lnkd.in/xyz'], 'the destination is never requested');

  asked.length = 0;
  assert.equal(await resolveNewsletterLink('http://169.254.169.254/latest', fake), 'http://169.254.169.254/latest');
  assert.equal(await resolveNewsletterLink('https://evil.example/redirect', fake), 'https://evil.example/redirect');
  assert.equal(await resolveNewsletterLink('https://substack.com.evil.example/x', fake), 'https://substack.com.evil.example/x');
  assert.deepEqual(asked, [], 'no request to a host outside the redirectors');
});
