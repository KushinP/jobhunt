import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, countHits } from '../src/normalize.ts';

test('dedupe key ignores case, spacing and punctuation', () => {
  assert.equal(
    normalizeKey('AI Implementation Consultant', 'Scale Labs'),
    normalizeKey('ai implementation  consultant!', 'Scale  Labs'),
  );
});

test('dedupe key still separates different roles at one company', () => {
  assert.notEqual(
    normalizeKey('AI Implementation Consultant', 'Scale Labs'),
    normalizeKey('Strategic Finance Analyst', 'Scale Labs'),
  );
});

test('dedupe key separates the same role at different companies', () => {
  assert.notEqual(normalizeKey('Analyst', 'Acme'), normalizeKey('Analyst', 'Acme Bank'));
});

test('dedupe key ignores legal form, ticker and location in the company name', () => {
  // Each pair arrived as two rows for one posting before this.
  assert.equal(normalizeKey('Associate, Asset Management', 'Welltower™ Inc. (NYSE:WELL)'),
    normalizeKey('Associate, Asset Management', 'Welltower'));
  assert.equal(normalizeKey('Land Acquisition Analyst', 'Century Communities, Inc. (NYSE:CCS)'),
    normalizeKey('Land Acquisition Analyst', 'Century Communities'));
  assert.equal(normalizeKey('Analyst', 'Acme Corp'), normalizeKey('Analyst', 'Acme'));
  assert.equal(normalizeKey('Analyst', 'Fitch Group'), normalizeKey('Analyst', 'Fitch'));
  assert.notEqual(normalizeKey('Analyst', 'The Group'), normalizeKey('Analyst', ''), 'a name of only suffixes keeps itself');
});

test('the legacy key is the one rows were stored under before', async () => {
  const { legacyKey, dedupeKeys } = await import('../src/normalize.ts');
  assert.equal(legacyKey('Analyst', 'Acme Corp'), 'analyst|acmecorp');
  assert.deepEqual(dedupeKeys('Analyst', 'Acme Corp'), ['analyst|acme', 'analyst|acmecorp']);
});

test('"intern" does not match "International"', () => {
  assert.equal(countHits('International Business Analyst', ['intern']), 0);
  assert.equal(countHits('Summer Intern, Finance', ['intern']), 1);
});

test('"ai" does not match email, domain, available or maintain', () => {
  assert.equal(countHits('Email the domain owner when available to maintain it', ['ai']), 0);
  assert.equal(countHits('AI-powered platform', ['ai']), 1);
  assert.equal(countHits('Work on AI and ML', ['ai']), 1);
});

test('"api" does not match "capital"', () => {
  assert.equal(countHits('Capital markets analyst', ['api']), 0);
});

test('multi-word and hyphenated terms match', () => {
  assert.equal(countHits('Own the go-to-market motion', ['go-to-market']), 1);
  assert.equal(countHits('commercial real estate credit', ['commercial real estate']), 1);
});

test('regex metacharacters in a term degrade instead of throwing', () => {
  assert.doesNotThrow(() => countHits('c++ developer (senior)', ['c++', '(senior)', '[']));
});

test('terms under two characters are ignored', () => {
  assert.equal(countHits('a b c', ['a', 'b']), 0);
});
