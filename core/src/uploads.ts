import type { D1Like } from './repo.ts';
import { saveDocument } from './repo.ts';

/**
 * Getting a built .docx from Claude's sandbox to the server without retyping it. Claude
 * cannot reliably copy 20,000 characters of base64 into a tool call: the copy drifts part way
 * and never recovers. So a save starts with `startUpload`, which records what the file must
 * be (its role, kind and sha256) and returns an id. The sandbox then either sends the raw file
 * to /upload/<id> with curl, or passes it in short pieces, each checked on arrival.
 *
 * The id is the only credential, and it is narrow: it lives 30 minutes, works once, and
 * accepts only the file whose sha256 was declared, for that one role.
 */

export const CHUNK_CHARS = 4000;
const TTL_MINUTES = 30;
const MAX_BYTES = 5_000_000;

/** Where a saved document is read: the dashboard origin this instance is deployed at, from
 * the PUBLIC_DASH_URL var. Falls back to a path when it is not set. */
export const docLink = (baseUrl: string | undefined, id: string) =>
  `${(baseUrl ?? '').replace(/\/+$/, '')}/doc/${id}`;

export interface UploadMeta {
  job_id: string;
  kind: 'resume' | 'cover_letter';
  filename: string;
  sha256: string;
  base_resume?: string | null;
  word_count?: number | null;
  page_count?: number | null;
  page_count_verified?: boolean;
  spec?: unknown;
}

export interface SavedDocument { document_id: string; sha256: string; bytes: number; link: string }

export class UploadError extends Error {
  /** the HTTP status the upload endpoint answers with */
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function startUpload(db: D1Like, m: UploadMeta): Promise<{ upload_id: string; expires_at: string }> {
  if (!/^[0-9a-f]{64}$/i.test(m.sha256)) throw new UploadError('sha256 must be the 64-character hex digest of your local file');
  if (!m.filename.trim()) throw new UploadError('a filename is needed');
  const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(m.job_id).first();
  if (!job) throw new UploadError(`no role with id ${m.job_id}`, 404);
  const id = newId();
  const { job_id, kind, filename, sha256, ...rest } = m;
  const row = await db.prepare(
    `INSERT INTO uploads (id, job_id, kind, filename, sha256, meta, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${TTL_MINUTES} minutes')) RETURNING expires_at`,
  ).bind(id, job_id, kind, filename.trim(), sha256.toLowerCase(), JSON.stringify(rest)).first<{ expires_at: string }>();
  return { upload_id: id, expires_at: row?.expires_at ?? '' };
}

type UploadRow = {
  id: string; job_id: string; kind: 'resume' | 'cover_letter'; filename: string; sha256: string;
  meta: string; total_chunks: number | null; used_at: string | null; document_id: string | null; expired: number;
};

async function openUpload(db: D1Like, id: string): Promise<UploadRow> {
  const u = await db.prepare(
    `SELECT *, expires_at < datetime('now') AS expired FROM uploads WHERE id = ?`,
  ).bind(id).first<UploadRow>();
  if (!u) throw new UploadError('no such upload: start one with start_document_upload', 404);
  if (u.used_at) throw new UploadError(`this upload was already used; it saved document ${u.document_id}`, 409);
  if (u.expired) throw new UploadError('this upload expired (30 minutes): start a new one', 410);
  return u;
}

/** The whole file, from curl or assembled from pieces: checked against the declared sha256,
 * then stored exactly as save_document would. */
export async function finishUpload(db: D1Like, id: string, bytes: Uint8Array, baseUrl?: string): Promise<SavedDocument> {
  const u = await openUpload(db, id);
  if (bytes.byteLength === 0) throw new UploadError('the upload was empty: send the file as the request body (curl --data-binary @file)');
  if (bytes.byteLength > MAX_BYTES) throw new UploadError('the file is over 5 MB');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new UploadError('that is not a .docx (a .docx is a zip file starting with "PK"); send the file itself, not its base64 or a form');
  }
  const sha = await sha256Hex(bytes);
  if (sha !== u.sha256) {
    throw new UploadError(`the file arrived different from the one declared (sha256 ${sha.slice(0, 12)}…, declared ${u.sha256.slice(0, 12)}…). Nothing was saved.`, 422);
  }
  const meta = JSON.parse(u.meta || '{}') as Omit<UploadMeta, 'job_id' | 'kind' | 'filename' | 'sha256'>;
  const docId = await saveDocument(db, {
    ...meta, job_id: u.job_id, kind: u.kind, filename: u.filename, content: bytes, sha256: sha,
  });
  await db.prepare("UPDATE uploads SET used_at = datetime('now'), document_id = ? WHERE id = ?").bind(docId, id).run();
  await db.prepare('DELETE FROM upload_chunks WHERE upload_id = ?').bind(id).run();
  return { document_id: docId, sha256: sha, bytes: bytes.byteLength, link: docLink(baseUrl, docId) };
}

/** One piece of the file's base64, with the sha256 of that piece's text. A piece that arrived
 * different is refused alone; once every piece is in, the file is assembled and saved. */
export async function addChunk(db: D1Like, id: string, c: { index: number; total: number; data: string; sha256: string }, baseUrl?: string):
  Promise<{ saved: false; received: number; total: number; missing: number[] } | ({ saved: true } & SavedDocument)> {
  const u = await openUpload(db, id);
  if (!Number.isInteger(c.total) || c.total < 1 || c.total > 500) throw new UploadError('total must be the number of pieces, 1 to 500');
  if (!Number.isInteger(c.index) || c.index < 0 || c.index >= c.total) throw new UploadError(`index must be 0 to ${c.total - 1}`);
  if (u.total_chunks != null && u.total_chunks !== c.total) {
    throw new UploadError(`this upload was started with ${u.total_chunks} pieces, not ${c.total}`);
  }
  const data = c.data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new UploadError(`piece ${c.index} has characters that are not base64: resend it`);
  const got = await sha256Hex(data);
  if (got !== c.sha256.toLowerCase()) {
    throw new UploadError(`piece ${c.index} arrived different from yours (sha256 ${got.slice(0, 12)}…). Resend just that piece.`, 422);
  }
  if (u.total_chunks == null) await db.prepare('UPDATE uploads SET total_chunks = ? WHERE id = ?').bind(c.total, id).run();
  await db.prepare(
    `INSERT INTO upload_chunks (upload_id, idx, data) VALUES (?, ?, ?)
     ON CONFLICT(upload_id, idx) DO UPDATE SET data = excluded.data`,
  ).bind(id, c.index, data).run();

  const { results } = await db.prepare('SELECT idx FROM upload_chunks WHERE upload_id = ? ORDER BY idx')
    .bind(id).all<{ idx: number }>();
  const have = new Set(results.map((r) => r.idx));
  const missing = [...Array(c.total).keys()].filter((i) => !have.has(i));
  if (missing.length) return { saved: false, received: have.size, total: c.total, missing };

  const { results: parts } = await db.prepare('SELECT data FROM upload_chunks WHERE upload_id = ? ORDER BY idx')
    .bind(id).all<{ data: string }>();
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(parts.map((p) => p.data).join('')), (ch) => ch.charCodeAt(0));
  } catch {
    throw new UploadError('the pieces do not join into valid base64: check each piece was cut at 4,000 characters');
  }
  return { saved: true, ...(await finishUpload(db, id, bytes, baseUrl)) };
}

/** Shell lines for the two ways to send the file, filled in for this upload. */
export function uploadInstructions(uploadUrl: string, uploadId: string): { curl: string; chunks: string } {
  return {
    curl: `curl -sS -X PUT --data-binary @FILE '${uploadUrl}'`,
    chunks: 'python3 -c "import base64,hashlib,sys; d=base64.b64encode(open(sys.argv[1],\'rb\').read()).decode(); '
      + `n=(len(d)+${CHUNK_CHARS - 1})//${CHUNK_CHARS}; [print(i, n, hashlib.sha256(d[i*${CHUNK_CHARS}:(i+1)*${CHUNK_CHARS}].encode()).hexdigest(), `
      + `d[i*${CHUNK_CHARS}:(i+1)*${CHUNK_CHARS}]) for i in range(n)]" FILE`
      + `  (then upload_document_chunk with upload_id ${uploadId} for each line: index, total, sha256, data)`,
  };
}
