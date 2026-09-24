import type { Config, Preferences } from './types.ts';
import type { D1Like } from './repo.ts';
import { putConfig } from './repo.ts';
import { SOURCES } from './sources.ts';

const MODES = ['remote', 'hybrid', 'onsite'];

/**
 * Merges a partial update into the saved preferences, validates it, and keeps the
 * application answers that are really preferences (relocation, salary, start date,
 * sponsorship) in step, so the same fact is never entered twice and never disagrees.
 */
export async function savePreferences(
  db: D1Like, cfg: Config, patch: Partial<Preferences>,
): Promise<{ preferences: Preferences; warnings: string[]; synced_answers: string[] }> {
  const { answered: _ignored, ...fields } = patch;
  // A blank value is not an answer: the dashboard form posts every field, and saving just a
  // comp floor must not mark work modes, dealbreakers and the rest as answered.
  const isAnswer = (v: unknown) => v !== null && v !== undefined && v !== ''
    && !(Array.isArray(v) && v.length === 0);
  const newlyAnswered = Object.entries(fields).filter(([, v]) => isAnswer(v)).map(([k]) => k);
  const answered = [...new Set([...(cfg.preferences.answered ?? []), ...newlyAnswered])];
  const next: Preferences = { ...cfg.preferences, ...fields, answered };
  const warnings: string[] = [];

  if (next.work_modes.some((m) => !MODES.includes(m))) {
    throw new Error(`work_modes must be from ${MODES.join(', ')}`);
  }
  for (const k of ['comp_floor', 'comp_target'] as const) {
    const v = next[k];
    if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(`${k} must be a positive number`);
  }
  if (next.comp_floor && next.comp_target && next.comp_target < next.comp_floor) {
    throw new Error('comp_target is below comp_floor');
  }
  if (next.earliest_start && !/^\d{4}-\d{2}-\d{2}$/.test(next.earliest_start)) {
    throw new Error('earliest_start must be YYYY-MM-DD');
  }
  for (const c of next.target_cities ?? []) {
    if (!c.name || !c.search || !c.match?.length) {
      throw new Error('each target city needs a name, a search location and at least one match term');
    }
  }

  const unknown = next.sources.filter((id) => !SOURCES.some((s) => s.id === id));
  if (unknown.length) throw new Error(`unknown sources: ${unknown.join(', ')}`);
  for (const id of next.sources) {
    const s = SOURCES.find((x) => x.id === id)!;
    if (s.status === 'planned' || s.status === 'unsupported') {
      warnings.push(`${s.name} is ${s.status === 'planned' ? 'not built yet' : 'not supported'}: ${s.how}`);
    }
    if (s.status === 'browser') {
      warnings.push(`${s.name} runs when you ask, in your own Chrome with the job-extract skill, `
        + 'not on the daily schedule.');
    }
  }

  // cities rotate by weekday, so each query runs in one city a day plus remote
  const perSource = (cfg.query_set ?? []).reduce((n, q) => n + (q.scope === 'both' ? 2 : 1), 0);
  // Rate limits apply per connector, so compare each connector's own daily volume to the
  // limit. Summing them would warn about a limit no single connector is near.
  const fullSources = ['indeed', 'ziprecruiter'].filter((id) => next.sources.includes(id));
  const LIMIT = 25;
  if (fullSources.length && perSource > LIMIT) {
    warnings.push(`That is about ${perSource} searches a day on each of `
      + `${fullSources.join(' and ')} (cities rotate by weekday). Indeed rate-limited at 30 in `
      + 'a run, so trim the query set or mark some queries local-only.');
  }

  await putConfig(db, 'preferences', next, 'what makes a role acceptable');

  const synced: string[] = [];
  const answer = async (field: string, value: string, category: string) => {
    await db.prepare(
      `INSERT INTO profile (field, value, category, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(field) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).bind(field, value, category).run();
    synced.push(field);
  };
  if (next.relocation) {
    await answer('willing_to_relocate', {
      no: 'No', yes: 'Yes', for_the_right_role: 'Open to it for the right role',
    }[next.relocation], 'preference');
  }
  if (next.comp_target) {
    await answer('salary_expectation', `$${next.comp_target.toLocaleString('en-US')} base`, 'preference');
  }
  if (next.earliest_start) await answer('earliest_start_date', next.earliest_start, 'preference');
  if (next.sponsorship_needed != null) {
    await answer('requires_sponsorship', next.sponsorship_needed ? 'Yes' : 'No', 'screening');
  }

  return { preferences: next, warnings, synced_answers: synced };
}
