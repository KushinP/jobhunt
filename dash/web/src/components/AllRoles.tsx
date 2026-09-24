import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import {
  ACTIVE_STATUSES, Closes, Empty, ScoreBadge, STATUS_LABEL, TRASH_STATUSES, shortDate, statusLabel,
} from './bits.tsx';
import { CompanyLink, useNav } from './nav.tsx';
import { Stars } from './Stars.tsx';
import {
  SORT_PRESETS, type Sort, type SortKey, firstDirection, presetFor, sortJobs, usePersisted,
} from './sort.ts';

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'title', label: 'Role' },
  { key: 'company', label: 'Company' },
  { key: 'salary', label: 'Salary', title: 'As posted. Sorting reads the top of the range, hourly pay as a year.' },
  { key: 'location', label: 'Location' },
  { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Found', title: 'When JobHunt first saw the role' },
  { key: 'applied_at', label: 'Applied' },
  { key: 'closes', label: 'Closes', title: 'The application deadline, when the posting states one' },
  { key: 'family', label: 'Family' },
  { key: 'source', label: 'Source' },
  { key: 'docs', label: 'Docs' },
  { key: 'rating', label: 'Yours', title: 'Your own rating' },
];

/** Which statuses a scope shows. Everything is the default: this page is the whole record. */
const SCOPES: { key: string; label: string; statuses?: readonly string[] }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'active', label: 'Active', statuses: ACTIVE_STATUSES },
  ...['New', 'Generate', 'Complete', 'Applied', 'Interviewing', 'Offer', 'Rejected']
    .map((s) => ({ key: s, label: STATUS_LABEL[s], statuses: [s] })),
  { key: 'trash', label: 'Trashed', statuses: TRASH_STATUSES },
];

const FIRST = 300;

/** A row of chips or filters: one line that swipes sideways on a phone, so the table keeps the
 * height, and wraps normally on wider screens. */
const ROW = '-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden';

/** the "Uncategorized" option in industry filters */
const NONE = '__none';

interface Filters {
  scope: string; family: string; source: string; industry: string;
  targetOnly: boolean; hideAvoided: boolean; sort: Sort;
}
const DEFAULTS: Filters = {
  scope: 'all', family: '', source: '', industry: '', targetOnly: false, hideAvoided: true,
  sort: { key: 'score', desc: true },
};

/**
 * Every role JobHunt has seen, in one table: salary, when it was found, when you applied and
 * when applications close, sortable by any of them. The board answers "what is in flight";
 * this answers "what have we got". Filters and sort are remembered in this browser.
 */
export function AllRoles({ search, only, onClearOnly }: {
  search: string;
  only?: { ids: string[]; label: string } | null;
  onClearOnly?: () => void;
}) {
  const nav = useNav();
  const [f, setF] = usePersisted<Filters>('jobhunt.allroles.v1', DEFAULTS);
  const set = (patch: Partial<Filters>) => { setF((prev) => ({ ...prev, ...patch })); setShown(FIRST); };
  const [shown, setShown] = useState(FIRST);

  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const families = boot.data?.archetypes ?? [];
  const familyName = (id: number | null) => families.find((a) => a.id === id)?.name ?? '';

  // A flow-chart selection is an exact list of roles, so it looks across every status.
  const statuses = only ? undefined : SCOPES.find((s) => s.key === f.scope)?.statuses;
  const { data, isLoading } = useQuery({
    queryKey: ['jobs', 'list', statuses?.join(',') ?? 'all', search],
    queryFn: () => api.jobs({ status: statuses, q: search || undefined }),
  });

  const all = data?.rows ?? [];
  const sources = useMemo(() => [...new Set(all.map((j) => j.source))].sort(), [all]);

  const rows = useMemo(() => {
    let list = all;
    if (only) {
      const want = new Set(only.ids);
      list = list.filter((j) => want.has(j.id));
    }
    if (f.family) list = list.filter((j) => String(j.archetype) === f.family);
    if (f.source) list = list.filter((j) => j.source === f.source);
    if (f.industry) list = list.filter((j) => (f.industry === NONE ? !j.company_industry : j.company_industry === f.industry));
    if (f.targetOnly) list = list.filter((j) => j.company_priority === 'target');
    else if (f.hideAvoided && !only) list = list.filter((j) => j.company_priority !== 'avoid');
    return sortJobs(list, f.sort, familyName);
    // familyName only changes when bootstrap loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, only, f, families]);
  const avoidedHere = f.hideAvoided && !f.targetOnly && !only
    ? all.filter((j) => j.company_priority === 'avoid').length : 0;
  const industries = boot.data?.industries ?? [];
  const withSalary = rows.filter((j) => j.salary).length;

  const select = 'shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent';
  const preset = presetFor(f.sort);
  const sortBy = (key: SortKey) => set({
    sort: f.sort.key === key ? { key, desc: !f.sort.desc } : { key, desc: firstDirection(key) },
  });

  // Score and Role stay put while the other columns scroll sideways under them.
  const stickA = 'sticky left-0 z-[1] w-14 min-w-14';
  const stickB = 'sm:sticky sm:left-14 sm:z-[1] sm:shadow-[1px_0_0_var(--color-line)]';

  // Fills the window like the board: filters take the height they need and the table scrolls
  // inside what is left, both ways, so the page itself never scrolls.
  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col sm:h-[calc(100dvh-10.25rem)]">
      {only ? (
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs">
            Showing <strong>{only.label}</strong> ({only.ids.length}) from the pipeline flow
          </span>
          <button type="button" onClick={onClearOnly}
            className="text-xs text-muted underline underline-offset-2 hover:text-fg">
            show all
          </button>
        </div>
      ) : (
        <div className={`mb-2 flex shrink-0 gap-1 ${ROW}`}>
          {SCOPES.map((s) => (
            <button key={s.key} type="button" onClick={() => set({ scope: s.key })}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${f.scope === s.key
                ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className={`mb-3 flex shrink-0 items-center gap-2 ${ROW}`}>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          Sort by
          <select value={preset} onChange={(e) => {
            const p = SORT_PRESETS.find((x) => x.key === e.target.value);
            if (p) set({ sort: p.sort });
          }} className={`${select} font-medium text-fg`} aria-label="Sort by">
            {!preset && <option value="">{COLUMNS.find((c) => c.key === f.sort.key)?.label ?? 'Column'} {f.sort.desc ? '↓' : '↑'}</option>}
            {SORT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
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
            Hide companies you avoid{avoidedHere ? ` (${avoidedHere})` : ''}
          </label>
        )}
      </div>

      {isLoading ? <Empty>Loading…</Empty> : rows.length === 0 ? (
        <Empty>
          {search ? `No roles match "${search}" here.` : 'No roles here.'}
          {!only && f.scope !== 'all' && ' Try Everything.'}
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-line">
          <table className="w-max min-w-full text-sm">
            <thead className="sticky top-0 z-[2] bg-panel">
              <tr>
                {COLUMNS.map((c, i) => (
                  <th key={c.key} title={c.title}
                    className={`bg-panel p-0 text-left ${i === 0 ? stickA : i === 1 ? stickB : ''}`}>
                    <button type="button" onClick={() => sortBy(c.key)}
                      className="w-full whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted hover:text-fg">
                      {c.label}{f.sort.key === c.key ? (f.sort.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((j) => (
                <tr key={j.id} onClick={() => nav.openJob(j.id)}
                  className="group cursor-pointer border-t border-line align-top">
                  <td className={`bg-bg px-3 py-2 group-hover:bg-panel ${stickA}`}><ScoreBadge score={j.score} /></td>
                  <td className={`w-[13rem] min-w-[13rem] bg-bg px-3 py-2 group-hover:bg-panel sm:w-[20rem] sm:min-w-[20rem] ${stickB}`}>
                    <span className="line-clamp-2 font-medium leading-snug">{j.title}</span>
                    <span className="block truncate text-xs text-muted sm:hidden">{j.company}</span>
                  </td>
                  <td className="max-w-[13rem] px-3 py-2 group-hover:bg-panel">
                    <span className="flex items-center gap-1">
                      {j.company_priority === 'target' && <span className="text-warn" title="A company you target">★</span>}
                      <CompanyLink name={j.company} className="block" />
                    </span>
                    {j.company_industry && <span className="block truncate text-xs text-muted">{j.company_industry}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums group-hover:bg-panel">
                    {j.salary || <span className="text-muted">-</span>}
                  </td>
                  <td className="max-w-[11rem] px-3 py-2 text-xs group-hover:bg-panel">
                    <span className="line-clamp-2" title={j.location ?? ''}>{j.location || <span className="text-muted">-</span>}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs group-hover:bg-panel">{statusLabel(j.status)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted group-hover:bg-panel">{shortDate(j.created_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs group-hover:bg-panel">
                    {j.applied_at ? shortDate(j.applied_at) : <span className="text-muted">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs group-hover:bg-panel">
                    <Closes at={j.closes_at} source={j.closes_source} />
                  </td>
                  <td className="max-w-[10rem] px-3 py-2 text-xs text-muted group-hover:bg-panel">
                    <span className="line-clamp-2" title={familyName(j.archetype)}>{familyName(j.archetype) || '-'}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted group-hover:bg-panel">{j.source}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs group-hover:bg-panel">
                    {j.resume_count + j.cl_count > 0
                      ? <span className="rounded bg-line px-1 py-px">{j.resume_count + j.cl_count}</span>
                      : <span className="text-muted">-</span>}
                  </td>
                  <td className="px-3 py-2 group-hover:bg-panel" onClick={(e) => e.stopPropagation()}>
                    <Stars id={j.id} rating={j.rating} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          {Math.min(shown, rows.length)} of {rows.length} roles
          {rows.length ? ` · ${withSalary} with a posted salary` : ''}
        </span>
        {rows.length > shown && (
          <button type="button" onClick={() => setShown(rows.length)}
            className="rounded-md border border-line px-2.5 py-1 text-fg hover:border-accent">
            Show all {rows.length}
          </button>
        )}
      </div>
    </div>
  );
}
