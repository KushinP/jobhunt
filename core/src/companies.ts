import type { D1Like } from './repo.ts';

/**
 * Company profiles: what kind of company a role is at. A short fixed list rather than free
 * text, so the dashboard's filters group like with like ("Fintech", not "fin-tech" and
 * "FinTech startup").
 */
export const INDUSTRIES = [
  'AI & ML', 'Fintech', 'Real estate tech', 'Real estate & investment', 'Banking & capital markets',
  'Asset management, PE & VC', 'Consulting', 'Enterprise software', 'Healthcare & life sciences',
  'Consumer & retail', 'Industrial & hardware', 'Energy & climate', 'Insurance', 'Government & nonprofit', 'Education',
  'Media & marketing', 'Other',
] as const;

export const STAGES = [
  'Seed', 'Series A', 'Series B', 'Growth (Series C+)', 'Public', 'Established private', 'Nonprofit or public sector',
] as const;

export const PRIORITIES = ['target', 'neutral', 'avoid'] as const;

export interface CompanyProfile {
  name: string;
  industry: string | null;
  stage: string | null;
  priority: 'target' | 'neutral' | 'avoid';
  tags: string[];
  website: string | null;
  notes: string | null;
  categorized_by: 'you' | 'claude' | 'source' | null;
  updated_at?: string;
}

export type CompanyPatch = Partial<Omit<CompanyProfile, 'name' | 'categorized_by' | 'updated_at'>>;

function check(patch: CompanyPatch): void {
  if (patch.industry != null && !(INDUSTRIES as readonly string[]).includes(patch.industry)) {
    throw new Error(`industry must be one of: ${INDUSTRIES.join(', ')}`);
  }
  if (patch.stage != null && !(STAGES as readonly string[]).includes(patch.stage)) {
    throw new Error(`stage must be one of: ${STAGES.join(', ')}`);
  }
  if (patch.priority != null && !(PRIORITIES as readonly string[]).includes(patch.priority)) {
    throw new Error(`priority must be one of: ${PRIORITIES.join(', ')}`);
  }
}

export async function getCompany(db: D1Like, name: string): Promise<CompanyProfile | null> {
  const r = await db.prepare('SELECT * FROM companies WHERE name = ?').bind(name)
    .first<Omit<CompanyProfile, 'tags'> & { tags: string }>();
  if (!r) return null;
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags ?? '[]'); } catch { /* keep empty */ }
  return { ...r, tags };
}

/**
 * Sets fields on a company profile, creating it if needed. By "you" (the dashboard) any field
 * can change. By "claude", a profile the person has edited is left alone: their judgement of a
 * company outranks an inference from a job description.
 */
export async function upsertCompany(
  db: D1Like, name: string, patch: CompanyPatch, by: 'you' | 'claude' | 'source',
): Promise<{ saved: boolean; reason?: string; profile: CompanyProfile | null }> {
  const key = name.trim();
  if (!key) throw new Error('a company name is needed');
  check(patch);
  const current = await getCompany(db, key);
  if (current?.categorized_by === 'you' && by !== 'you') {
    return { saved: false, reason: 'set by you, so left alone', profile: current };
  }
  const next = {
    industry: patch.industry !== undefined ? patch.industry : current?.industry ?? null,
    stage: patch.stage !== undefined ? patch.stage : current?.stage ?? null,
    priority: patch.priority ?? current?.priority ?? 'neutral',
    tags: patch.tags ?? current?.tags ?? [],
    website: patch.website !== undefined ? patch.website : current?.website ?? null,
    notes: patch.notes !== undefined ? patch.notes : current?.notes ?? null,
  };
  await db.prepare(
    `INSERT INTO companies (name, industry, stage, priority, tags, website, notes, categorized_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET industry = excluded.industry, stage = excluded.stage,
       priority = excluded.priority, tags = excluded.tags, website = excluded.website,
       notes = excluded.notes, categorized_by = excluded.categorized_by, updated_at = datetime('now')`,
  ).bind(key, next.industry, next.stage, next.priority, JSON.stringify(next.tags.slice(0, 12)),
    next.website, next.notes, by).run();
  return { saved: true, profile: await getCompany(db, key) };
}

/**
 * Companies Claude still has to categorize: those with roles in play and no industry yet,
 * with a few role titles and the opening of one job description to judge from.
 */
export async function uncategorizedCompanies(db: D1Like, opts: { activeOnly?: boolean; limit?: number } = {}) {
  const active = "status IN ('New','Generate','Complete','Applied','Interviewing','Offer')";
  const { results } = await db.prepare(
    `SELECT j.company AS name, COUNT(*) AS roles,
            GROUP_CONCAT(j.title, ' | ') AS titles,
            (SELECT substr(j2.jd_text, 1, 700) FROM jobs j2
               WHERE j2.company = j.company AND j2.jd_text IS NOT NULL
               ORDER BY length(j2.jd_text) DESC LIMIT 1) AS jd_excerpt
     FROM jobs j LEFT JOIN companies c ON c.name = j.company
     WHERE c.industry IS NULL ${opts.activeOnly ? `AND j.${active}` : ''}
     GROUP BY j.company ORDER BY roles DESC LIMIT ?`,
  ).bind(opts.limit ?? 40).all<{ name: string; roles: number; titles: string; jd_excerpt: string | null }>();
  return results.map((r) => ({ ...r, titles: (r.titles ?? '').split(' | ').slice(0, 5).join(' | ') }));
}
