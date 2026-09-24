import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, type SetupData } from '../../api.ts';
import { Panel } from '../Setup.tsx';

/** The answers auto-fill types into real application forms, so a leftover placeholder
 * would be submitted to an employer. Anything still CONFIRM is shown first and flagged. */
export function Answers({ data }: { data: SetupData }) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => setupApi.saveProfile(
      Object.entries(edits).map(([field, value]) => ({
        field, value,
        category: data.profile.find((p) => p.field === field)?.category ?? 'screening',
      }))),
    onSuccess: (r) => {
      setEdits({});
      setMsg(r.refused.length
        ? `Saved ${r.saved}. Refused ${r.refused.join(', ')}: those are yours to answer on the form itself.`
        : `Saved ${r.saved}.`);
      setTimeout(() => setMsg(null), 4000);
      void qc.invalidateQueries({ queryKey: ['setup'] });
    },
  });

  const rows = useMemo(() => {
    const needs = data.profile.filter((p) => p.value === 'CONFIRM');
    const rest = data.profile.filter((p) => p.value !== 'CONFIRM');
    return [...needs, ...rest];
  }, [data.profile]);

  const outstanding = data.profile.filter((p) => p.value === 'CONFIRM').length;

  return (
    <Panel
      title="Application answers"
      note="Used to auto-fill application forms so every application says the same thing. Demographic and EEO questions are deliberately not stored here: those are yours to answer on the form."
    >
      {outstanding > 0 && (
        <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {outstanding} still say CONFIRM. Auto-fill would type that into a real form.
        </p>
      )}
      <div className="max-h-96 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((p) => {
              const val = edits[p.field] ?? p.value;
              const needs = p.value === 'CONFIRM';
              return (
                <tr key={p.field} className="border-b border-line last:border-0">
                  <td className="w-52 px-3 py-1.5 align-top">
                    <span className="block text-xs font-medium">{p.field}</span>
                    <span className="text-[11px] text-muted">{p.category}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={val}
                      onChange={(e) => setEdits((m) => ({ ...m, [p.field]: e.target.value }))}
                      className={`w-full rounded-md border bg-bg px-2 py-1 text-sm outline-none
                        focus:border-accent ${needs ? 'border-warn' : 'border-line'}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button"
          disabled={Object.keys(edits).length === 0 || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white
                     disabled:opacity-50">
          {save.isPending ? 'Saving…' : `Save ${Object.keys(edits).length || ''} change${Object.keys(edits).length === 1 ? '' : 's'}`}
        </button>
        {msg && <span className="text-xs text-good">{msg}</span>}
      </div>
    </Panel>
  );
}
