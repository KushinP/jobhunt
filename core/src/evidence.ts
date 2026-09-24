import type { D1Like } from './repo.ts';

export type EvidenceKind =
  | 'accomplishment' | 'project' | 'skill' | 'metric' | 'story' | 'credential' | 'boundary';
export type Ownership = 'built_myself' | 'led' | 'contributed' | 'team';
export type EvidenceStatus = 'unconfirmed' | 'confirmed' | 'rejected';

export interface EvidenceInput {
  id?: string;
  kind: EvidenceKind;
  title: string;
  detail?: string | null;
  context?: string | null;
  ownership?: Ownership | null;
  level?: 'familiar' | 'working' | 'strong' | 'expert' | null;
  start_date?: string | null;
  end_date?: string | null;
  metrics?: string | null;
  tools?: string[] | null;
  archetypes?: number[] | null;
  proof_url?: string | null;
  source: 'resume' | 'user' | 'document' | 'repo';
  source_ref?: string | null;
  status?: EvidenceStatus;
  notes?: string | null;
}

export interface Evidence extends Omit<EvidenceInput, 'tools' | 'archetypes'> {
  id: string;
  tools: string[];
  archetypes: number[];
  status: EvidenceStatus;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

const DATE = /^(0[1-9]|1[0-2])\/\d{4}$|^present$/i;

/** Dates are stored in the same MM/YYYY the documents use, so nothing is reformatted on
 * the way into a resume and a date cannot drift between the bank and the page. */
function checkDate(label: string, v: string | null | undefined): void {
  if (v && !DATE.test(v.trim())) {
    throw new Error(`${label} must be MM/YYYY or "Present", got "${v}"`);
  }
}

export async function upsertEvidence(db: D1Like, e: EvidenceInput): Promise<string> {
  if (!e.title?.trim()) throw new Error('evidence needs a title');
  checkDate('start_date', e.start_date);
  checkDate('end_date', e.end_date);

  const tools = JSON.stringify(e.tools ?? []);
  const arche = JSON.stringify(e.archetypes ?? []);
  const status = e.status ?? (e.source === 'user' ? 'confirmed' : 'unconfirmed');

  if (e.id) {
    const res = await db.prepare(
      `UPDATE evidence SET kind = ?, title = ?, detail = ?, context = ?, ownership = ?,
         level = ?, start_date = ?, end_date = ?, metrics = ?, tools = ?, archetypes = ?,
         proof_url = ?, source = ?, source_ref = ?, status = ?, notes = ?,
         confirmed_at = CASE WHEN ? = 'confirmed' AND status <> 'confirmed'
                             THEN datetime('now') ELSE confirmed_at END,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      e.kind, e.title.trim(), e.detail ?? null, e.context ?? null, e.ownership ?? null,
      e.level ?? null, e.start_date ?? null, e.end_date ?? null, e.metrics ?? null, tools,
      arche, e.proof_url ?? null, e.source, e.source_ref ?? null, status, e.notes ?? null,
      status, e.id,
    ).run() as { meta?: { changes?: number } };
    if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no evidence with id ${e.id}`);
    return e.id;
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO evidence (id, kind, title, detail, context, ownership, level, start_date,
       end_date, metrics, tools, archetypes, proof_url, source, source_ref, status, notes,
       confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       CASE WHEN ? = 'confirmed' THEN datetime('now') END)`,
  ).bind(
    id, e.kind, e.title.trim(), e.detail ?? null, e.context ?? null, e.ownership ?? null,
    e.level ?? null, e.start_date ?? null, e.end_date ?? null, e.metrics ?? null, tools, arche,
    e.proof_url ?? null, e.source, e.source_ref ?? null, status, e.notes ?? null, status,
  ).run();
  return id;
}

export async function setEvidenceStatus(
  db: D1Like, id: string, status: EvidenceStatus, notes?: string,
): Promise<void> {
  const res = await db.prepare(
    `UPDATE evidence SET status = ?, notes = COALESCE(?, notes),
       confirmed_at = CASE WHEN ? = 'confirmed' THEN datetime('now') ELSE confirmed_at END,
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(status, notes ?? null, status, id).run() as { meta?: { changes?: number } };
  if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no evidence with id ${id}`);
}

export async function listEvidence(db: D1Like, f: {
  kind?: EvidenceKind; status?: EvidenceStatus; archetype?: number; context?: string;
} = {}): Promise<Evidence[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.kind) { where.push('kind = ?'); binds.push(f.kind); }
  if (f.status) { where.push('status = ?'); binds.push(f.status); }
  if (f.context) { where.push('context = ?'); binds.push(f.context); }
  const { results } = await db.prepare(
    `SELECT * FROM evidence ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE kind WHEN 'boundary' THEN 0 WHEN 'project' THEN 1 WHEN 'accomplishment' THEN 2
       WHEN 'metric' THEN 3 WHEN 'skill' THEN 4 WHEN 'credential' THEN 5 ELSE 6 END,
       context, start_date DESC, title`,
  ).bind(...binds).all<Record<string, unknown>>();

  const rows = results.map((r) => ({
    ...r,
    tools: parseList(r.tools),
    archetypes: parseList(r.archetypes).map(Number),
  })) as unknown as Evidence[];

  // An item with no archetype tags supports every archetype.
  return f.archetype == null
    ? rows
    : rows.filter((r) => r.archetypes.length === 0 || r.archetypes.includes(f.archetype!));
}

export async function deleteEvidence(db: D1Like, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM evidence WHERE id = ?').bind(id).run() as { meta?: { changes?: number } };
  if ((res?.meta?.changes ?? 1) === 0) throw new Error(`no evidence with id ${id}`);
}

export async function evidenceSummary(db: D1Like): Promise<Record<string, Record<string, number>>> {
  const { results } = await db.prepare(
    'SELECT kind, status, COUNT(*) AS n FROM evidence GROUP BY kind, status',
  ).all<{ kind: string; status: string; n: number }>();
  const out: Record<string, Record<string, number>> = {};
  for (const r of results) (out[r.kind] ??= {})[r.status] = r.n;
  return out;
}

function parseList(v: unknown): string[] {
  if (typeof v !== 'string' || !v) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
