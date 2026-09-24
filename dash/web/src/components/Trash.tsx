import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TrashedJob } from '../api.ts';
import { ScoreBadge, age, Empty } from './bits.tsx';

const LABEL: Record<string, string> = {
  Discarded: 'Filtered on arrival',
  Skip: 'Removed by sweep or you',
  'Dead link': 'Posting gone',
};

/** Nothing in JobHunt is ever deleted. Roles the scorer, the daily sweep or you turned away
 * land here with the reason, and one click puts any of them back in New. */
export function Trash({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['trash'], queryFn: api.trash });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((j) => (filter === 'all' || j.status === filter)
      && (!needle || `${j.title} ${j.company} ${j.reason ?? ''}`.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of data ?? []) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [data]);

  async function restore(id: string) {
    setBusy(id); setErr(null);
    try {
      await api.setStatus(id, 'New', 'Restored from trash');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['trash'] }),
        qc.invalidateQueries({ queryKey: ['jobs'] }),
        qc.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Empty>Loading…</Empty>;
  if ((data ?? []).length === 0) return <Empty>Trash is empty.</Empty>;

  return (
    <>
      <p className="mb-3 text-xs text-muted">
        Nothing is ever deleted. Restore puts a role back in New, where it waits for you
        (it is not re-queued for documents automatically).
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {['all', 'Skip', 'Discarded', 'Dead link'].map((s) => (
          <button key={s} type="button" onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === s
              ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}>
            {s === 'all' ? `All (${data!.length})` : `${LABEL[s]} (${counts[s] ?? 0})`}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, company or reason"
          className="ml-auto w-56 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent" />
      </div>
      {err && <p className="mb-2 text-xs text-warn">{err}</p>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Why it was removed</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} onClick={() => onOpen(j.id)}
                className="cursor-pointer border-t border-line hover:bg-panel">
                <td className="px-3 py-2"><ScoreBadge score={j.score} /></td>
                <td className="max-w-[20rem] px-3 py-2">
                  <span className="block truncate font-medium">{j.title}</span>
                  <span className="block truncate text-xs text-muted">{j.company} · {j.source}</span>
                </td>
                <td className="max-w-[28rem] px-3 py-2 text-xs">
                  <span className="mr-1.5 rounded bg-line px-1 py-px text-[11px]">{LABEL[j.status] ?? j.status}</span>
                  <span className="text-muted">{j.reason ?? 'no reason recorded'}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{age(j.status_changed_at ?? j.created_at)}</td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <button type="button" disabled={busy === j.id} onClick={() => restore(j.id)}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent disabled:opacity-50">
                    {busy === j.id ? 'Restoring…' : 'Restore'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
