import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ingestJobs } from '../src/repo.ts';
import { CHUNK_CHARS, addChunk, finishUpload, sha256Hex, startUpload } from '../src/uploads.ts';

// a fake .docx: starts with PK like a zip, long enough to need several pieces
const FILE = new Uint8Array(12_000).map((_, i) => (i === 0 ? 0x50 : i === 1 ? 0x4b : (i * 31) % 251));
const b64 = Buffer.from(FILE).toString('base64');

async function setup() {
  const { db, raw } = makeTestDb();
  await ingestJobs(db, DEFAULT_CONFIG, 'test', [{ title: 'Business Operations Associate', company: 'Acme', location: 'Boston, MA' }]);
  const jobId = (raw.prepare('SELECT id FROM jobs').get() as { id: string }).id;
  const { upload_id } = await startUpload(db, {
    job_id: jobId, kind: 'resume', filename: 'Acme_Resume.docx', sha256: await sha256Hex(FILE),
    page_count: 1, page_count_verified: true, spec: { evidence: ['e1', 'e2'] },
  });
  return { db, raw, jobId, upload_id };
}

test('the whole file sent once is saved, and the link cannot be used again', async () => {
  const { db, raw, upload_id } = await setup();
  const r = await finishUpload(db, upload_id, FILE);
  assert.equal(r.bytes, FILE.byteLength);
  const doc = raw.prepare('SELECT filename, page_count, page_count_verified, spec FROM documents WHERE id = ?').get(r.document_id) as Record<string, unknown>;
  assert.equal(doc.filename, 'Acme_Resume.docx');
  assert.equal(doc.page_count_verified, 1);
  assert.match(String(doc.spec), /e1/);
  await assert.rejects(() => finishUpload(db, upload_id, FILE), /already used/);
});

test('a file that is not the one declared is refused and nothing is stored', async () => {
  const { db, raw, upload_id } = await setup();
  const changed = FILE.slice(); changed[500] ^= 1;
  await assert.rejects(() => finishUpload(db, upload_id, changed), /arrived different/);
  await assert.rejects(() => finishUpload(db, upload_id, new TextEncoder().encode(b64)), /not a \.docx/, 'base64 text instead of the file');
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n, 0);
  assert.ok((await finishUpload(db, upload_id, FILE)).document_id, 'the right file still goes through afterwards');
});

test('pieces are checked one by one: a bad piece is refused alone, and the last one saves the file', async () => {
  const { db, raw, upload_id } = await setup();
  const pieces: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) pieces.push(b64.slice(i, i + CHUNK_CHARS));
  assert.ok(pieces.length >= 3);
  const send = async (i: number, data = pieces[i]) =>
    addChunk(db, upload_id, { index: i, total: pieces.length, data, sha256: await sha256Hex(pieces[i]) });

  await assert.rejects(() => send(1, `${pieces[1].slice(0, 100)}X${pieces[1].slice(101)}`), /piece 1 arrived different/);
  const partial = await send(0);
  assert.deepEqual(partial.saved ? null : partial.missing, [...Array(pieces.length).keys()].slice(1));
  for (let i = 1; i < pieces.length - 1; i++) await send(i);
  const done = await send(pieces.length - 1);
  assert.equal(done.saved, true);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM upload_chunks').get() as { n: number }).n, 0, 'pieces are cleared once saved');
});

test('an expired upload is refused', async () => {
  const { db, raw, upload_id } = await setup();
  raw.prepare("UPDATE uploads SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(upload_id);
  await assert.rejects(() => finishUpload(db, upload_id, FILE), /expired/);
});
