import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Job } from '../api.ts';

/** The "Uncategorized" option in the industry filter. */
const NONE = '__none';

/** The filters the pipeline and All roles share. Each page remembers its own. */
export interface RoleFilterState {
  family: string; source: string; industry: string; targetOnly: boolean; hideAvoided: boolean;
}

export const ROLE_FILTER_DEFAULTS: RoleFilterState = {
  family: '', source: '', industry: '', targetOnly: false, hideAvoided: true,
};

/** `keepAvoided` lets an exact list (a flow-chart selection) show every role it names. */
export function applyRoleFilters<T extends Job>(list: T[], f: RoleFilterState, keepAvoided = false): T[] {
  let out = list;
  if (f.family) out = out.filter((j) => String(j.archetype) === f.family);
  if (f.source) out = out.filter((j) => j.source === f.source);
  if (f.industry) out = out.filter((j) => (f.industry === NONE ? !j.company_industry : j.company_industry === f.industry));
  if (f.targetOnly) out = out.filter((j) => j.company_priority === 'target');
  else if (f.hideAvoided && !keepAvoided) out = out.filter((j) => j.company_priority !== 'avoid');
  return out;
}

/** True when the filters differ from a page's defaults. */
export const filtering = (f: RoleFilterState, defaults: RoleFilterState = ROLE_FILTER_DEFAULTS) =>
  (Object.keys(defaults) as (keyof RoleFilterState)[]).some((k) => f[k] !== defaults[k]);

/**
 * Family, source, industry and company-priority filters, as selects and checkboxes in one row.
 * `jobs` is the unfiltered list, which the source options and the avoided count come from.
 */
export function RoleFilterBar({ f, set, jobs, keepAvoided = false }: {
  f: RoleFilterState;
  set: (patch: Partial<RoleFilterState>) => void;
  jobs: Job[];
  keepAvoided?: boolean;
}) {
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const families = boot.data?.archetypes ?? [];
  const industries = boot.data?.industries ?? [];
  const sources = useMemo(() => [...new Set(jobs.map((j) => j.source))].sort(), [jobs]);
  const avoided = f.hideAvoided && !f.targetOnly && !keepAvoided
    ? jobs.filter((j) => j.company_priority === 'avoid').length : 0;
  const select = 'shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent';

  return (
    <>
      <select value={f.family} onChange={(e) => set({ family: e.target.value })} className={select} aria-label="Role family">
        <option value="">All families</option>
        {families.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={select} aria-label="Source">
        <option value="">All sources</option>
        {sources.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={f.industry} onChange={(e) => set({ industry: e.target.value })} className={select} aria-label="Company industry">
        <option value="">All industries</option>
        {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        <option value={NONE}>Uncategorized</option>
      </select>
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <input type="checkbox" checked={f.targetOnly} onChange={(e) => set({ targetOnly: e.target.checked })} />
        Target companies only
      </label>
      {!f.targetOnly && (
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={f.hideAvoided} onChange={(e) => set({ hideAvoided: e.target.checked })} />
          Hide companies you avoid{avoided ? ` (${avoided})` : ''}
        </label>
      )}
    </>
  );
}
