import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Empty, ScoreBadge, shortDate } from './bits.tsx';
import { useNav } from './nav.tsx';

/** the "Uncategorized" option in industry filters */
const NONE = '__none';

/** Every company a role has been seen at, with its profile. Open one for its roles. */
export function Companies({ search }: { search: string }) {
  // Fills the window like the board: the table scrolls inside, the page never does.
  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col sm:h-[calc(100dvh-10.25rem)]">
      <CompaniesTable search={search} />
    </div>
  );
}

function CompaniesTable({ search }: { search: string }) {
  const nav = useNav();
  const [sortKey, setSortKey] = useState<'active' | 'name' | 'best_score' | 'total' | 'last_seen'>('active');
  const [industry, setIndustry] = useState('');
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState<'all' | 'target' | 'avoid' | 'uncategorized'>('all');
  const [liveOnly, setLiveOnly] = useState(true);
  const { data, isLoading } = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (data ?? []).filter((c) => (!needle || `${c.name} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(needle))
      && (!liveOnly || c.active > 0)
      && (!industry || (industry === NONE ? !c.industry : c.industry === industry))
      && (!stage || c.stage === stage)
      && (priority === 'all' || (priority === 'uncategorized' ? !c.industry : c.priority === priority)));
    return [...list].sort((a, b) => sortKey === 'name'
      ? a.name.localeCompare(b.name)
      : sortKey === 'last_seen' ? b.last_seen.localeCompare(a.last_seen)
      : ((b[sortKey] ?? -1) as number) - ((a[sortKey] ?? -1) as number));
  }, [data, search, sortKey, industry, stage, priority, liveOnly]);

  const select = 'rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent';
  const th = (key: typeof sortKey | null, label: string, cls = '') => (
    <th className={`p-0 text-left ${cls}`}>
      {key ? (
        <button type="button" onClick={() => setSortKey(key)}
          className="w-full whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted hover:text-fg">
          {label}{sortKey === key ? ' ↓' : ''}
        </button>
      ) : <span className="block whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted">{label}</span>}
    </th>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {([['all', 'All'], ['target', '★ Target'], ['avoid', 'Avoid'], ['uncategorized', 'Uncategorized']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPriority(k)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${priority === k
                ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={select} aria-label="Industry">
          <option value="">All industries</option>
          {(boot.data?.industries ?? []).map((i) => <option key={i} value={i}>{i}</option>)}
          <option value={NONE}>Uncategorized</option>
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={select} aria-label="Stage">
          <option value="">Any stage</option>
          {(boot.data?.stages ?? []).map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
          Only companies with live roles
        </label>
      </div>

      {isLoading ? <Empty>Loading…</Empty> : rows.length === 0 ? (
        <Empty>{search ? `No company matches "${search}".` : 'No companies match these filters.'}</Empty>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr>
              {th('name', 'Company')}
              {th(null, 'Industry', 'hidden md:table-cell')}
              {th(null, 'Stage', 'hidden xl:table-cell')}
              {th('active', 'Live')}
              {th('total', 'All roles', 'hidden sm:table-cell')}
              {th(null, 'Queued', 'hidden lg:table-cell')}
              {th('best_score', 'Best')}
              {th('last_seen', 'Last seen', 'hidden sm:table-cell')}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.name} onClick={() => nav.openCompany(c.name)}
                className={`cursor-pointer border-t border-line hover:bg-panel ${c.priority === 'avoid' ? 'opacity-60' : ''}`}>
                <td className="max-w-[16rem] px-3 py-2">
                  <span className="flex items-center gap-1">
                    {c.priority === 'target' && <span className="text-warn" title="Target">★</span>}
                    <span className="truncate font-medium">{c.name}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {[c.watched ? 'board watched' : null, c.priority === 'avoid' ? 'avoided' : null,
                      c.industry ? null : 'uncategorized'].filter(Boolean).join(' · ')}
                    <span className="md:hidden">{c.industry ?? ''}</span>
                  </span>
                </td>
                <td className="hidden max-w-[12rem] truncate px-3 py-2 text-xs md:table-cell">{c.industry ?? <span className="text-muted">-</span>}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted xl:table-cell">{c.stage ?? '-'}</td>
                <td className="px-3 py-2 tabular-nums">{c.active}</td>
                <td className="hidden px-3 py-2 tabular-nums text-muted sm:table-cell">{c.total}</td>
                <td className="hidden px-3 py-2 tabular-nums lg:table-cell">{c.queued || <span className="text-muted">-</span>}</td>
                <td className="px-3 py-2">{c.best_score != null ? <ScoreBadge score={c.best_score} /> : <span className="text-muted">-</span>}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted sm:table-cell">{shortDate(c.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <p className="mt-2 shrink-0 text-xs text-muted">
        {rows.length} of {(data ?? []).length} companies. Open one to set its industry, stage and whether you target or avoid it.
      </p>
    </div>
  );
}
