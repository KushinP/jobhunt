import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradWindowConflict } from '../src/grad.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { scoreJob, statusForScore } from '../src/score.ts';
import { jd as fullJd } from './fixtures.ts';

const G = '06/2026';

test('a posting that requires a graduation after the person\'s is flagged', () => {
  assert.ok(gradWindowConflict('Candidates must have an expected graduation date between December 2026 and May 2027.', G));
  assert.ok(gradWindowConflict('You are on track to receive a Bachelor\'s degree in December 2026 or Spring 2027.', G));
  assert.ok(gradWindowConflict('Open to students with a graduation date between December 2026 and June 2027.', G));
  assert.ok(gradWindowConflict('Graduating in Spring 2027 with a degree in finance.', G));
  assert.ok(gradWindowConflict('This program is for the Class of 2027.', G));
  assert.ok(gradWindowConflict('Currently pursuing a Bachelor\'s degree in economics or finance.', G));
  assert.ok(gradWindowConflict('Applicants must be currently enrolled in an undergraduate program.', G));
});

test('a window that includes the person\'s graduation, or a later start date, is not flagged', () => {
  assert.equal(gradWindowConflict('Graduated between May 2026 and June 2027 with a bachelor\'s degree.', G), null);
  assert.equal(gradWindowConflict('This role has a planned start date of June 2027.', G), null);
  assert.equal(gradWindowConflict('Class of 2026 graduates are encouraged to apply.', G), null);
  assert.equal(gradWindowConflict('Currently pursuing or recently completed a bachelor\'s degree.', G), null);
  assert.equal(gradWindowConflict('Graduating in May 2026 or earlier.', G), null);
  assert.equal(gradWindowConflict('Expected graduation in December 2026.', null), null, 'no graduation on file, no flag');
});

test('a graduation-window conflict holds the role in New without discarding it', () => {
  const r = scoreJob(DEFAULT_CONFIG, { title: 'AI Solutions Consultant', company: 'Acme', location: 'Boston, MA',
    graduated: G,
    jd: fullJd('Drive AI adoption for enterprise SaaS clients. Own implementation and onboarding, stakeholder '
      + 'workshops and cross-functional rollout. Expected graduation date between December 2026 and May 2027.') });
  assert.match(r.breakdown.grad_window ?? '', /december 2026.*vs graduated 06\/2026/i);
  assert.equal(r.auto_generate, false);
  assert.equal(r.drop_reason, null);
  assert.equal(statusForScore(r), 'New');
});

test('pursuing a charter or certificate is not current enrollment', () => {
  assert.equal(gradWindowConflict('Currently pursuing or interested in obtaining the CFA designation.', G), null);
  assert.equal(gradWindowConflict('Candidates currently pursuing the CFA or CAIA are encouraged to apply.', G), null);
  assert.ok(gradWindowConflict('Currently pursuing a Bachelor\'s or Master\'s degree in economics.', G));
});
