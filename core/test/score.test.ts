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

test('a director-level role is discarded with the reason recorded', () => {
  const r = scoreJob(cfg, {
    title: 'Director of Business Operations', company: 'Startup Co', location: 'Remote',
    jd: 'Business operations leader at a series b venture-backed saas company. Forecasting, '
      + 'pricing, unit economics, financial modeling, kpi dashboards, cross-functional.',
  });
  assert.equal(r.level_mismatch, true);
  assert.equal(r.breakdown.seniority, 0);
  assert.equal(r.auto_generate, false, 'a level mismatch must not spend tokens');
  assert.equal(r.drop_reason, 'level mismatch: senior title');
  assert.equal(statusForScore(r), 'Discarded');
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
  const r = scoreJob(cfg, { title: 'Business Operations Analyst', company: 'Insureco', location: 'Remote',
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

// Phrasings below are taken from postings the production replay (09-30) read wrong.
test('years are read from scraped text whose block boundaries were deleted', async () => {
  const { statedYears } = await import('../src/score.ts');
  assert.equal(statedYears('Bachelor’s degree in Finance required.MBA or advanced degree is a plus.'
    + 'Experience5+ years of experience in Business Operations, Strategy, Consulting.'), 5,
  'one squashed "sentence" containing "a plus" used to hide the whole requirements block');
  assert.equal(statedYears('...so-what behind the numbers.You May Be a Fit If3–5 years of experience in '
    + 'Business Operations, Strategy & Operations, or a similarly cross-functional role.'), 3);
  assert.equal(statedYears('or equivalent practical experience.4 years of experience in financial planning'), 4);
  assert.equal(statedYears('Three (3) plus years of experience in cost is required'), 3);
  assert.equal(statedYears('Minimum three to five years of experience in a real estate analyst role'), 3);
  assert.equal(statedYears('What you’ll bring to the role\nRequired 5+ years in a technical sales role'), 5);
});

test('a preference word discounts only what it qualifies', async () => {
  const { statedYears } = await import('../src/score.ts');
  assert.equal(statedYears('- 3+ years of relevant FP&A experience, ideally in corporate finance.'), 3);
  assert.equal(statedYears('3+ years of experience in financial/bank services industry with 1+ year of '
    + 'specific roles in business planning preferred'), 3);
  assert.equal(statedYears('3 years of experience preferred.'), null);
  assert.equal(statedYears('Ideally, you also have 4+ years of relevant experience in project finance.'), null);
  assert.equal(statedYears('Strong mastery of Excel; 4 years of experience with SQL is a strong plus.'), null);
});

test('a degree alternative, a degree length, a ceiling and a spaced range are not floors', async () => {
  const { statedYears } = await import('../src/score.ts');
  assert.equal(statedYears("Bachelor's degree in economics, finance, and accounting or related discipline or "
    + '7 years of progressively responsible experience in financial analysis'), null);
  assert.equal(statedYears("Bachelor's degree or high school diploma or GED and 4 years of experience"), null);
  assert.equal(statedYears("Bachelor's degree with 2 to 4 years of related experience or high school diploma "
    + 'with 5 to 7 plus years of specific experience'), 2);
  assert.equal(statedYears("3 or more years of work experience with a bachelor's degree or more than 2 years "
    + 'of work experience with an advanced degree'), 3);
  assert.equal(statedYears('Bachelor’s degree in a related field (business, economics, or similar)5–8 years '
    + 'of experience in business analysis'), 5, 'a list of fields is not an alternative path');
  assert.equal(statedYears('4 year degree or equivalent work experience in a sales ops environment'), null);
  assert.equal(statedYears('Up to 5 years of professional experience in financial services'), null);
  assert.equal(statedYears('- 0 - 3 years of relevant professional experience'), 0);
  assert.equal(statedYears('4 - 7 years’ experience in tax equity'), 4);
  assert.equal(statedYears('Experience 3 or more years of experience (preferred)Supervisory responsibilities none.'), null);
  assert.equal(statedYears('A baccalaureate degree from an accredited college or university and 3 years of '
    + 'satisfactory full-time professional experience.'), 3, '"college or university" is a list, not a route');
  assert.equal(statedYears('A baccalaureate degree and 3 years of professional experience; or an associate degree '
    + 'and 5 years of professional experience; or a 4-year high school diploma and 7 years of experience.'), 3,
    'routes for people without a bachelor\'s are not the floor');
  assert.equal(statedYears('At least part of the qualifying professional experience must have been obtained within the past 7 years.'), null);
  assert.equal(statedYears('Compressing 10 years of experience into 2.'), null, 'a pitch about growth is not a floor');
  assert.equal(statedYears('3+ years of experience in data analysis.\n3+ years of experience using modern BI tools.'), 3);
  assert.equal(statedYears('Experience in business operations or a related analytical role.'), null,
    '"in business" is not "in business for 10 years"');
});

test('a posting that requires more years than the limit is discarded with the figure', () => {
  const r = scoreJob(cfg, { title: 'Business Operations Associate', company: 'Acme', location: 'Boston, MA',
    jd: fullJd('Startup saas forecasting pricing. 3–5 years of experience in business operations. '
      + 'Financial modeling, kpi dashboards, cross-functional analysis.') });
  assert.equal(r.breakdown.years_required, 3);
  assert.equal(r.drop_reason, 'requires 3+ years of experience (limit 2)');
  assert.equal(statusForScore(r), 'Discarded');
});

test('senior titles are discarded, but associate-level manager titles are not', () => {
  const jdText = fullJd('Startup saas forecasting pricing unit economics financial modeling kpi dashboards.');
  for (const title of ['Senior Business Analyst', 'Business Operations Manager', 'Implementation Consultant III',
    'Staff Financial Analyst', 'Senior Associate, Strategic Finance']) {
    const r = scoreJob(cfg, { title, company: 'Acme', location: 'Boston, MA', jd: jdText });
    assert.equal(r.drop_reason, 'level mismatch: senior title', title);
  }
  for (const title of ['Associate Product Manager', 'Associate Manager, Business Operations', 'Chief of Staff',
    'Implementation Manager', 'Associate Asset Manager', 'Member of Operations Staff, Finance & Business Operations',
    'Member of Technical Staff', 'Analyst/Sr. Analyst, Real Estate', 'Strategy and Operations Associate/Sr Associate',
    'Financial Analyst or Senior Financial Analyst', 'Associate - Commercial Real Estate Portfolio Manager']) {
    const r = scoreJob(cfg, { title, company: 'Acme', location: 'Boston, MA', jd: jdText });
    assert.notEqual(r.drop_reason, 'level mismatch: senior title', title);
  }
});

test('a required skill the person lacks keeps the role in New instead of queuing it', () => {
  const skills = { ...cfg, missing_skills: ['sql', 'python'] };
  const base = 'Drive AI adoption for enterprise SaaS clients. Own implementation and onboarding, '
    + 'gather requirements, run training, work cross-functional with product and go-to-market teams. ';
  const run = (extra: string) => scoreJob(skills, { title: 'AI Implementation Consultant', company: 'Acme',
    location: 'Boston, MA', jd: fullJd(base + extra) });
  for (const req of ['Strong SQL skills with the ability to analyze large datasets.',
    'Advanced SQL and working knowledge of Python.', 'You can write SQL window functions without looking them up.']) {
    const r = run(req);
    assert.equal(r.breakdown.missing_skill, 'sql', req);
    assert.equal(r.auto_generate, false, req);
    assert.equal(statusForScore(r), 'New', req);
  }
  for (const soft of ['Experience with, or a strong interest in learning, SQL and Snowflake.',
    'Familiarity with SQL, APIs, or advanced data analysis tools.', 'SQL experience is a strong plus.',
    'Our platform leverages the strength of Microsoft SQL technology to provide advanced applications.']) {
    const r = run(soft);
    assert.equal(r.breakdown.missing_skill, undefined, soft);
    assert.equal(r.auto_generate, true, soft);
  }
});

test('staffing agencies and blind postings are excluded by the company field alone', () => {
  for (const company of ['Robert Half', 'Coda Search│Staffing', 'Arrow Search Partners', '7Seventy Recruiting',
    'Confidential']) {
    const r = scoreJob(cfg, { title: 'Strategic Finance Associate', company, location: 'Boston, MA', jd: AI_JD });
    assert.equal(r.excluded, true, company);
  }
  const r = scoreJob(cfg, { title: 'AI Implementation Consultant', company: 'Scale Labs', location: 'Boston, MA',
    jd: fullJd('You will implement our platform for our clients in staffing and recruitment. ' + AI_JD) });
  assert.equal(r.excluded, false, 'a JD that mentions staffing is not an agency posting');
});

test('abbreviated operations titles match their target terms', () => {
  const jdText = fullJd('Founding team at a series a startup. Forecasting, pricing, kpi dashboards, metrics, '
    + 'cross-functional analysis with the founders.');
  for (const title of ['Founding Ops', 'Forward Deployed Operator']) {
    const r = scoreJob({ ...cfg, archetypes: cfg.archetypes.map((a) => a.id === 4
      ? { ...a, title_terms: [...a.title_terms, 'founding operations', 'forward deployed operations'] } : a) },
    { title, company: 'Acme', location: 'Boston, MA', jd: jdText });
    assert.notEqual(r.drop_reason, 'title matches no target role', title);
  }
});

test('"N years of experience into two" is a pitch, not a requirement', () => {
  const r = scoreJob(cfg, { title: 'Chief of Staff, Special Projects', company: 'Acme', location: 'Boston, MA',
    jd: fullJd('Startup saas forecasting pricing kpi dashboards. Perfect for a future founder; compressing '
      + '10 years of experience into two. Cross-functional analysis and financial modeling.') });
  assert.equal(r.breakdown.years_required ?? null, null);
  assert.notEqual(r.drop_reason, 'requires 10+ years of experience (limit 2)');
});

test('Staff Analyst is a civil-service grade at public employers, and senior elsewhere', () => {
  const jdText = (extra: string) => fullJd(`Startup saas forecasting pricing kpi dashboards. ${extra}`);
  const pub = scoreJob(cfg, { title: 'Staff Analyst Series', company: 'Metropolitan Transportation Authority',
    location: 'Boston, MA', jd: jdText('Staff Analyst I $71,203 - $84,295. Staff Analyst II $82,673.') });
  assert.notEqual(pub.drop_reason, 'level mismatch: senior title');
  const graded = scoreJob(cfg, { title: 'Staff Analyst', company: 'Acme Transit Co',
    location: 'Boston, MA', jd: jdText('Analytical support.') });
  assert.notEqual(graded.drop_reason, 'level mismatch: senior title');
  const tech = scoreJob(cfg, { title: 'Staff Analyst, GTM Analytics', company: 'Snowflake',
    location: 'Boston, MA', jd: jdText('Lead analytics for go-to-market.') });
  assert.equal(tech.drop_reason, 'level mismatch: senior title');
  const bank = scoreJob(cfg, { title: 'Staff Analyst', company: 'State Street',
    location: 'Boston, MA', jd: jdText('Finance analytics.') });
  assert.equal(bank.drop_reason, 'level mismatch: senior title');
});

test('Deployment Manager names the job, not a management level', () => {
  const r = scoreJob(cfg, { title: 'AI Deployment Manager - Builder', company: 'OpenAI', location: 'Boston, MA',
    jd: fullJd('Drive AI adoption and enablement for enterprise customers. Own deployment and onboarding.') });
  assert.notEqual(r.drop_reason, 'level mismatch: senior title');
});
