import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jd as fullJd, NEUTRAL } from './fixtures.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scoreJob, statusForScore, baseResumeFor } from '../src/score.ts';

const cfg = DEFAULT_CONFIG;
const AI_JD = fullJd(
  'Drive AI adoption for enterprise SaaS clients. Own implementation and onboarding, '
  + 'gather requirements, run training, work cross-functional with product and go-to-market teams.');

test('a clean local archetype-1 fit scores full marks and auto-generates', () => {
  const r = scoreJob(cfg, {
    title: 'AI Implementation Consultant', company: 'Scale Labs',
    location: 'Boston, MA', jd: AI_JD,
  });
  assert.equal(r.score, 100);
  assert.equal(r.archetype, 1);
  assert.equal(r.auto_generate, true);
  assert.deepEqual(r.breakdown, { title: 20, domain: 25, skill: 20, seniority: 20, location: 15 });
});

test('the same role fully remote scores lower than local but still auto-generates', () => {
  const r = scoreJob(cfg, {
    title: 'AI Implementation Consultant', company: 'Scale Labs',
    location: 'Remote', jd: AI_JD,
  });
  assert.equal(r.score, 95);
  assert.equal(r.remote, true);
  assert.equal(r.auto_generate, true);
});

test('an intern title is excluded', () => {
  const r = scoreJob(cfg, {
    title: 'Marketing Intern', company: 'Acme', location: 'Boston, MA', jd: 'Summer internship.',
  });
  assert.equal(r.excluded, true);
  assert.equal(r.drop_reason, 'excluded by title term');
  assert.equal(r.auto_generate, false);
});

test('"International Business Analyst" is not caught by the intern exclusion', () => {
  const r = scoreJob(cfg, {
    title: 'International Business Analyst', company: 'Acme', location: 'Boston, MA',
    jd: 'Business operations analyst at a venture-backed startup. Forecasting, budgeting, '
      + 'unit economics, financial modeling in excel, build dashboards.',
  });
  assert.equal(r.excluded, false);
  assert.equal(r.score, 93);
  assert.equal(r.archetype, 4);
});

test('an on-site role outside the geography is filtered, not merely penalised', () => {
  const r = scoreJob(cfg, {
    title: 'Strategic Finance Analyst', company: 'Austin Co', location: 'Austin, TX',
    jd: 'On-site strategic finance role. Startup, arr, forecasting, budgeting, '
      + 'financial modeling, excel, kpi.',
  });
  assert.equal(r.excluded, true);
  assert.equal(r.drop_reason, 'location not acceptable and not remote');
});

test('a remote-in-the-JD role with a foreign city still qualifies', () => {
  const r = scoreJob(cfg, {
    title: 'Strategic Finance Analyst', company: 'Austin Co', location: 'Austin, TX',
    jd: 'This is a fully remote position. Startup, arr, forecasting, budgeting, '
      + 'financial modeling, excel, kpi dashboards.',
  });
  assert.equal(r.excluded, false);
  assert.equal(r.remote, true);
});

test('a director-level role is shown but never auto-generated', () => {
  const r = scoreJob(cfg, {
    title: 'Director of Business Operations', company: 'Startup Co', location: 'Remote',
    jd: 'Business operations leader at a series b venture-backed saas company. Forecasting, '
      + 'pricing, unit economics, financial modeling, kpi dashboards, cross-functional.',
  });
  assert.equal(r.level_mismatch, true);
  assert.equal(r.breakdown.seniority, 0);
  assert.equal(r.auto_generate, false, 'a level mismatch must not spend tokens');
  assert.equal(statusForScore(r), 'New', 'it still reaches the dashboard for a human call');
});

test('a VP title is hard-filtered', () => {
  const r = scoreJob(cfg, {
    title: 'VP of Strategic Finance', company: 'Startup Co', location: 'Boston, MA',
    jd: 'Strategic finance leader. Forecasting, arr, startup.',
  });
  assert.equal(r.excluded, true);
  assert.equal(r.drop_reason, 'level mismatch: too senior');
});

test('an override term rescues an otherwise-excluded title', () => {
  const r = scoreJob(cfg, {
    title: 'Analyst Development Program Intern', company: 'Fidelity', location: 'Boston, MA',
    jd: 'Rotational analyst program. Strategic finance, forecasting, financial modeling, '
      + 'excel, dashboards, startup.',
  });
  assert.equal(r.excluded, false);
  assert.ok(r.score >= cfg.thresholds.hard_cutoff);
});

test('an unrelated role lands under the hard cutoff', () => {
  const r = scoreJob(cfg, {
    title: 'Dental Office Coordinator', company: 'Smile Co', location: 'Boston, MA',
    jd: fullJd('Front desk scheduling and patient billing.'),
  });
  assert.ok(r.score < cfg.thresholds.hard_cutoff);
  assert.equal(r.drop_reason, 'below hard cutoff');
  assert.equal(statusForScore(r), 'Discarded');
});

test('a clearance requirement anywhere in the JD excludes', () => {
  const r = scoreJob(cfg, {
    title: 'Real Estate Analyst', company: 'GovCo', location: 'Boston, MA',
    jd: 'Requires an active security clearance. Underwriting, financial modeling, due diligence.',
  });
  assert.equal(r.excluded, true);
  assert.equal(r.drop_reason, 'excluded by content term');
});

test('each archetype maps to its own base resume, with a fallback', () => {
  assert.equal(baseResumeFor(cfg, 2), 'Base_Resume_CRE.docx');
  assert.equal(baseResumeFor(cfg, 3), 'Base_Resume_CRE_Credit.docx');
  assert.equal(baseResumeFor(cfg, null), 'Base_Resume_AI_Implementation.docx');
  assert.equal(baseResumeFor(cfg, 99), 'Base_Resume_AI_Implementation.docx');
});

test('scoring is stable: the same input scores the same twice', () => {
  const input = {
    title: 'Real Estate Acquisitions Analyst', company: 'Beacon Capital',
    location: 'Boston, MA',
    jd: 'Underwriting multifamily acquisitions, financial modeling, due diligence, '
      + 'cap rate analysis, pro forma.',
  };
  assert.deepEqual(scoreJob(cfg, input), scoreJob(cfg, input));
});

test('the neutral padding used by fixtures matches no archetype term', async () => {
  const { countHits } = await import('../src/normalize.ts');
  for (const a of cfg.archetypes) {
    const hits = countHits(NEUTRAL, [...a.title_terms, ...a.domain_terms, ...a.skill_terms]);
    assert.equal(hits, 0, `padding hits ${hits} terms of archetype ${a.id}`);
  }
});

test('a title-matching role with no JD is kept provisionally, not thrown away', () => {
  // the exact case from the first live run: an archetype-1 title scored 58 and was discarded
  const r = scoreJob(cfg, {
    title: 'AI Solutions Consultant', company: 'Cynergists AI', location: 'Remote',
  });
  assert.equal(r.excluded, false);
  assert.equal(r.needs_jd, true);
  assert.equal(r.drop_reason, null, 'missing information is not a bad fit');
  assert.equal(r.auto_generate, false, 'nothing is tailored without the JD');
  assert.equal(statusForScore(r), 'New');
});

test('a short search snippet does not count as a job description', () => {
  const r = scoreJob(cfg, {
    title: 'AI Solutions Consultant', company: 'X', location: 'Boston, MA',
    jd: 'Help enterprise customers adopt AI. Implementation, onboarding and training.',
  });
  assert.equal(r.needs_jd, true);
});

test('with no JD, a title matching no target role is dropped with the honest reason', () => {
  const r = scoreJob(cfg, { title: 'Dental Office Coordinator', company: 'Smile Co', location: 'Boston, MA' });
  assert.equal(statusForScore(r), 'Discarded');
  assert.match(r.drop_reason!, /no target role.*no JD/);
});

test('hard filters still apply with no JD: location, level and exclusions need only the title', () => {
  assert.equal(scoreJob(cfg, { title: 'AI Solutions Consultant', company: 'X', location: 'Denver, CO' }).excluded, true);
  assert.equal(scoreJob(cfg, { title: 'VP, AI Solutions', company: 'X', location: 'Boston, MA' }).excluded, true);
  assert.equal(scoreJob(cfg, { title: 'AI Solutions Intern', company: 'X', location: 'Boston, MA' }).excluded, true);
});

test('once a full JD arrives, the same role is scored for real and can auto-generate', () => {
  const r = scoreJob(cfg, {
    title: 'AI Solutions Consultant', company: 'X', location: 'Boston, MA', jd: AI_JD,
  });
  assert.equal(r.needs_jd, false);
  assert.equal(r.auto_generate, true);
});

test('Chief of Staff is a BizOps target, not a C-suite role', () => {
  const r = scoreJob(cfg, { title: 'Chief of Staff', company: 'Acme', location: 'Boston, MA', jd: fullJd('startup series a forecasting financial modeling excel kpi') });
  assert.equal(r.excluded, false);
  assert.equal(r.archetype, 4);
  assert.equal(r.level_mismatch, false);
});

test('a level word inside a target title is not a level claim, but one outside it is', () => {
  const at = scoreJob(cfg, { title: 'Implementation Manager', company: 'Acme', location: 'Boston, MA', jd: fullJd('saas ai implementation onboarding training') });
  assert.equal(at.level_mismatch, false);
  for (const title of ['Senior Strategic Finance Associate', 'Staff Solutions Engineer', 'Sr. Business Analyst',
    'Strategic Finance Manager', 'Revenue Enablement Leader']) {
    const r = scoreJob(cfg, { title, company: 'Acme', location: 'Boston, MA', jd: fullJd('startup saas forecasting financial modeling excel kpi') });
    assert.equal(r.level_mismatch, true, title);
    assert.equal(r.auto_generate, false, title);
  }
});

test('a role whose title matches no target is never auto-generated, however well the JD matches', () => {
  const r = scoreJob(cfg, { title: 'Field Enablement Specialist', company: 'Acme', location: 'Boston, MA',
    jd: fullJd('ai machine learning llm saas b2b platform stakeholder cross-functional implementation training product roadmap') });
  assert.ok(r.score >= cfg.thresholds.auto_generate, `scores ${r.score}`);
  assert.equal(r.auto_generate, false);
  assert.equal(r.drop_reason, 'title matches no target role');
  assert.equal(statusForScore(r), 'Discarded', 'it does not sit in New either');
});

test('adjacent functions sharing a target word are excluded by title', () => {
  for (const title of ['Software Engineer, AI Enablement', 'Recruiter, Mergers & Acquisitions',
    'Data Scientist, Real Estate & Workplace', 'Account Executive, Private Equity Real Estate']) {
    const r = scoreJob(cfg, { title, company: 'Acme', location: 'Boston, MA', jd: fullJd('ai saas real estate') });
    assert.equal(r.excluded, true, title);
  }
});

test('boilerplate remote perks do not make an office role remote', () => {
  const perks = 'We work from the office three designated days in the office per week. As a perk, we also have up to four weeks per year of fully remote work.';
  const slc = scoreJob(cfg, { title: 'Strategic Finance Associate', company: 'Acme', location: 'Salt Lake City, Utah, United States', jd: fullJd(perks) });
  assert.equal(slc.excluded, true);
  const abroad = scoreJob(cfg, { title: 'Strategic Finance Associate', company: 'Acme', location: 'Remote - Canada', jd: fullJd('startup') });
  assert.equal(abroad.excluded, true);
  assert.equal(abroad.drop_reason, 'outside the US');
  const both = scoreJob(cfg, { title: 'Strategic Finance Associate', company: 'Acme', location: 'Boston, MA / London, UK', jd: fullJd('startup') });
  assert.equal(both.excluded, false, 'one acceptable location is enough');
});

test('a JD asking for more experience than the person has is a level mismatch', async () => {
  const { statedYears } = await import('../src/score.ts');
  assert.equal(statedYears('Requirements: 7+ years of experience in strategic finance.'), 7);
  assert.equal(statedYears('3-5 years of relevant work experience; 5+ years of experience preferred'), 3);
  assert.equal(statedYears('We have served customers for 10 years.'), null, 'years without "experience" are not a requirement');
  const r = scoreJob(cfg, { title: 'Strategic Finance, B2B Product', company: 'Acme', location: 'Boston, MA',
    jd: fullJd('startup saas forecasting financial modeling excel kpi. 7+ years of experience in finance.') });
  assert.equal(r.level_mismatch, true);
  assert.equal(r.auto_generate, false);
  assert.equal((r.breakdown as { years_required?: number }).years_required, 7);
  const ok = scoreJob(cfg, { title: 'Strategic Finance Associate', company: 'Acme', location: 'Boston, MA',
    jd: fullJd('startup saas forecasting financial modeling excel kpi. 2+ years of experience in finance.') });
  assert.equal(ok.level_mismatch, false);
});

test('a title-matching role is kept for review even when its JD shares little vocabulary', () => {
  const r = scoreJob(cfg, { title: 'Business Operations Lead', company: 'Insureco', location: 'Boston, MA',
    jd: fullJd('Own weekly business reviews for our insurance products in excel.') });
  assert.ok(r.score < cfg.thresholds.hard_cutoff, `scores ${r.score}`);
  assert.equal(r.drop_reason, null);
  assert.equal(statusForScore(r), 'New');
});

test('a part-time role is excluded', () => {
  const r = scoreJob(cfg, { title: 'Chief of Staff - Part Time', company: 'Acme', location: 'Boston, MA', jd: fullJd('startup') });
  assert.equal(r.excluded, true);
});

test('forward deployed and other engineering titles are out, solutions roles stay in', () => {
  const jdText = fullJd('ai saas implementation onboarding training stakeholder');
  for (const title of ['Forward Deployed Engineer (FDE), Healthcare - NYC', 'Founding Forward Deployed Engineer',
    'Frontier Agents Engineer', 'Applied AI Engineer, Agent Enablement', 'Solutions Architect - Infrastructure',
    'Accounting Solutions Consultant', 'Deployment Strategist, Future Platforms (Accounting)',
    'Workplace Operations Associate', 'Strategy and Operations, Talent']) {
    assert.equal(scoreJob(cfg, { title, company: 'Acme', location: 'Boston, MA', jd: jdText }).excluded, true, title);
  }
  for (const title of ['Customer Solutions Engineer', 'Associate Solutions Engineer', 'Solutions Consultant',
    'Chief of Staff, Public Sector Engineering & Security']) {
    assert.equal(scoreJob(cfg, { title, company: 'Acme', location: 'Boston, MA', jd: jdText }).excluded, false, title);
  }
});

test('stated experience is read as the highest real requirement', async () => {
  const { statedYears } = await import('../src/score.ts');
  assert.equal(statedYears('- 10+ years of progressive experience across finance.\n- 2+ years of Strategic Finance experience.'), 10, 'requirements stack');
  assert.equal(statedYears('Qualifications:\n- 6–11 years in management consulting, investment banking, and/or operating roles'), 6, 'a leading bullet needs no "experience"');
  assert.equal(statedYears('* 3+ years in a client-facing role such as Forward Deployment'), 3);
  assert.equal(statedYears('Experience: 3+ years\nVisa: US citizen'), 3, 'the YC header');
  assert.equal(statedYears('2+ years of experience required. 5+ years of experience preferred.'), 2, 'preferred is not required');
  assert.equal(statedYears('We are a company with 20 years of history in Boston.'), null);
  assert.equal(statedYears('- 0-3 years of experience in similar role or field'), 0);
});

test('entity-escaped HTML from Greenhouse becomes text, not tags', async () => {
  const { htmlToText } = await import('../src/html.ts');
  const out = htmlToText('&lt;ul&gt;&lt;li style=&quot;font-size: 12pt;&quot;&gt;6+ years of experience&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Ops &amp;amp; strategy&lt;/p&gt;');
  assert.ok(!out.includes('<'), out);
  assert.match(out, /- 6\+ years of experience/);
  assert.match(out, /Ops & strategy/);
});
