import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jd as fullJd, NEUTRAL } from './fixtures.ts';
import { parseSalary } from '../src/salary.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scoreJob } from '../src/score.ts';

test('common salary formats read correctly', () => {
  assert.deepEqual(parseSalary('$130,000 - $160,000'), { min: 130000, max: 160000, hourly: false });
  assert.deepEqual(parseSalary('$120K-$150K'), { min: 120000, max: 150000, hourly: false });
  assert.deepEqual(parseSalary('95k'), { min: 95000, max: 95000, hourly: false });
  assert.deepEqual(parseSalary('From $80,000 a year'), { min: 80000, max: 80000, hourly: false });
});

test('hourly pay is annualised', () => {
  assert.deepEqual(parseSalary('$45/hr'), { min: 93600, max: 93600, hourly: true });
  assert.deepEqual(parseSalary('$40 - $50 per hour'), { min: 83200, max: 104000, hourly: true });
});

test('anything unreadable returns null rather than a guess', () => {
  assert.equal(parseSalary('Competitive'), null);
  assert.equal(parseSalary(''), null);
  assert.equal(parseSalary(null), null);
  assert.equal(parseSalary('Founded in 2019, 250 employees'), null, 'a year and a headcount are not pay');
});

const JD = fullJd('Series B venture-backed SaaS. Forecasting, budgeting, pricing, unit economics, '
  + 'board materials, financial modeling in Excel, KPI dashboards.');
const withFloor = (floor: number, extra: Partial<typeof DEFAULT_CONFIG.preferences> = {}) => ({
  ...DEFAULT_CONFIG,
  preferences: { ...DEFAULT_CONFIG.preferences, comp_floor: floor, ...extra },
});

test('a role whose stated maximum is below the floor is filtered with the numbers', () => {
  const r = scoreJob(withFloor(100_000), {
    title: 'Strategic Finance Analyst', company: 'Ramp', location: 'Boston, MA',
    jd: JD, salary: '$70,000 - $85,000',
  });
  assert.equal(r.excluded, true);
  assert.match(r.drop_reason!, /below your floor.*85k.*100k/);
});

test('a range that reaches the floor is kept', () => {
  const r = scoreJob(withFloor(100_000), {
    title: 'Strategic Finance Analyst', company: 'Ramp', location: 'Boston, MA',
    jd: JD, salary: '$90,000 - $115,000',
  });
  assert.equal(r.excluded, false);
});

test('no stated salary never filters, however high the floor', () => {
  const r = scoreJob(withFloor(250_000), {
    title: 'Strategic Finance Analyst', company: 'Ramp', location: 'Boston, MA', jd: JD,
  });
  assert.equal(r.excluded, false);
});

test('pay stated inside the JD is found when the salary field is empty', () => {
  const r = scoreJob(withFloor(100_000), {
    title: 'Strategic Finance Analyst', company: 'Ramp', location: 'Boston, MA',
    jd: `${JD}\nThe base salary range for this role is $65,000 - $80,000.`,
  });
  assert.equal(r.excluded, true);
});

test('an industry you ruled out is filtered and the override list does not rescue it', () => {
  const cfg = withFloor(0, { industries_avoid: ['tobacco', 'gambling'] });
  const r = scoreJob(cfg, {
    title: 'Analyst Development Program', company: 'SpinCo', location: 'Boston, MA',
    jd: `${JD} Online gambling platform.`,
  });
  assert.equal(r.excluded, true);
  assert.equal(r.drop_reason, 'industry you have ruled out');
});
