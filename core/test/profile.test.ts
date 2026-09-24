import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenProfileField } from '../src/profile.ts';

test('demographic and identity fields are refused however they are spelled', () => {
  for (const f of ['date_of_birth', 'DateOfBirth', 'social_security_number', 'salary_history', 'Race / ethnicity',
    'Are you Hispanic or Latino?', 'gender', 'Preferred pronouns', "driver's license", 'veteran_status',
    'EEO self-identification', 'password', 'age']) {
    assert.ok(forbiddenProfileField(f), f);
  }
});

test('ordinary answers containing those letters are not refused', () => {
  for (const f of ['language', 'languages_spoken', 'manager_name', 'page_count', 'message', 'usage',
    'work_authorization', 'sponsorship_needed', 'salary_expectation', 'linkedin_url']) {
    assert.equal(forbiddenProfileField(f), null, f);
  }
});
