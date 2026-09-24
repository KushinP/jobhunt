import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDocxText } from '../src/docx.ts';

/** Builds a real .docx (a zip with word/document.xml) using the system zip tool, so the
 * parser is tested against an actual archive rather than a hand-made fixture. */
function makeDocx(paragraphs: string[]): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'jobhunt-docx-'));
  mkdirSync(join(dir, 'word'), { recursive: true });
  const body = paragraphs
    .map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`)
    .join('');
  writeFileSync(join(dir, 'word/document.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`);
  writeFileSync(join(dir, '[Content_Types].xml'), '<Types/>');
  execFileSync('zip', ['-q', '-r', 'out.docx', '.'], { cwd: dir });
  return new Uint8Array(readFileSync(join(dir, 'out.docx')));
}

test('text is extracted from a real .docx archive', async () => {
  const bytes = makeDocx([
    'Jordan Example',
    'Somewhere, MA | 555-0100 | jordan@example.com',
    'Founded a VC-backed AI-powered guest experience platform',
  ]);
  const r = await extractDocxText(bytes);
  assert.equal(r.ok, true, r.reason ?? 'extraction failed');
  assert.match(r.text, /Jordan Example/);
  assert.match(r.text, /555-0100/);
  assert.match(r.text, /guest experience platform/);
  assert.ok(r.paragraphs >= 3);
});

test('paragraphs become newlines rather than running together', async () => {
  const r = await extractDocxText(makeDocx(['First line', 'Second line']));
  assert.match(r.text, /First line\nSecond line/);
});

test('xml entities are decoded', async () => {
  const r = await extractDocxText(makeDocx(['Finance &amp; Operations', '2 &lt; 3']));
  assert.match(r.text, /Finance & Operations/);
  assert.match(r.text, /2 < 3/);
});

test('a non-docx file fails with a reason instead of throwing', async () => {
  const r = await extractDocxText(new TextEncoder().encode('this is a plain text file'));
  assert.equal(r.ok, false);
  assert.ok(r.reason);
  assert.doesNotMatch(r.reason!, /undefined/);
});

test('a zip without a document.xml says so', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobhunt-zip-'));
  writeFileSync(join(dir, 'notes.txt'), 'hello');
  execFileSync('zip', ['-q', 'out.zip', 'notes.txt'], { cwd: dir });
  const r = await extractDocxText(new Uint8Array(readFileSync(join(dir, 'out.zip'))));
  assert.equal(r.ok, false);
  assert.match(r.reason!, /document\.xml/);
});
