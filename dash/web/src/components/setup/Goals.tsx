import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, type SetupData } from '../../api.ts';
import { Panel } from '../Setup.tsx';

const KINDS: { value: string; label: string; measurable: boolean }[] = [
  { value: 'weekly_applications', label: 'Applications per week', measurable: true },
  { value: 'total_applications', label: 'Applications in total', measurable: true },
  { value: 'interviews', label: 'Interviews', measurable: true },
  { value: 'weekly_outreach', label: 'Outreach per week', measurable: false },
  { value: 'offer_by', label: 'Offer by a date', measurable: false },
  { value: 'target_comp', label: 'Target compensation', measurable: false },
  { value: 'custom', label: 'Something else', measurable: false },
];

export function Goals({ data }: { data: SetupData }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('weekly_applications');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [due, setDue] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['setup'] });

  const save = useMutation({
    mutationFn: () => setupApi.saveGoal({
      kind, title: title.trim(),
      target_value: target ? Number(target) : null,
      due_at: due || undefined,
    }),
    onSuccess: () => { setTitle(''); setTarget(''); setDue(''); refresh(); },
  });
  const close = useMutation({
    mutationFn: (g: { id: string; kind: string; title: string; status: string }) =>
      setupApi.saveGoal(g),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: setupApi.deleteGoal, onSuccess: refresh });

  const active = data.goals.filter((g) => g.status === 'active');
  const closed = data.goals.filter((g) => g.status !== 'active');

  return (
    <Panel
      title="Goals"
      note="Progress on the countable ones is computed from what actually happened, not self-reported. A goal with no number in it cannot tell you whether the search is working."
    >
      {active.length === 0 && (
        <p className="mb-3 text-sm text-muted">
          No active goals. Without one, the Monday review can report activity but not whether
          you are on track.
        </p>
      )}

      <ul className="mb-3 space-y-2">
        {active.map((g) => {
          const pct = g.measurable && g.target_value
            ? Math.min(100, Math.round(((g.current_value ?? 0) / g.target_value) * 100))
            : null;
          return (
            <li key={g.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-muted">
                    {KINDS.find((k) => k.value === g.kind)?.label ?? g.kind}
                    {g.target_value != null ? ` · target ${g.target_value}` : ''}
                    {g.due_at ? ` · by ${g.due_at}` : ''}
                    {!g.measurable && ' · tracked, not scored'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {(['met', 'missed', 'paused'] as const).map((s) => (
                    <button key={s} type="button"
                      onClick={() => close.mutate({ id: g.id, kind: g.kind, title: g.title, status: s })}
                      className="rounded-md border border-line px-2 py-0.5 text-xs
                                 hover:border-accent">
                      {s}
                    </button>
                  ))}
                  <button type="button" onClick={() => remove.mutate(g.id)}
                    className="rounded-md border border-line px-2 py-0.5 text-xs
                               hover:border-risk hover:text-risk">✕</button>
                </div>
              </div>
              {pct != null && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${pct >= 100 ? 'bg-good' : 'bg-accent'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {g.current_value ?? 0} / {g.target_value}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label>
          <span className="mb-1 block text-xs font-semibold">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-semibold">Goal</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Apply to 8 roles a week"
            className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Target</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} type="number"
            className="w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">By</span>
          <input value={due} onChange={(e) => setDue(e.target.value)} type="date"
            className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent" />
        </label>
        <button type="button" disabled={!title.trim() || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white
                     disabled:opacity-50">
          Add goal
        </button>
      </div>

      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted">
            {closed.length} closed
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {closed.map((g) => (
              <li key={g.id}>{g.title} — {g.status}</li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
