import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { evidenceApi, type EvidenceItem } from '../api.ts';
import { Empty } from './bits.tsx';

const KINDS: { key: EvidenceItem['kind']; label: string; hint: string }[] = [
  { key: 'boundary', label: 'Never claim', hint: 'Guardrails every generated document respects, however well a claim would fit the JD.' },
  { key: 'project', label: 'Projects', hint: 'Things you built or ran, with who actually did the work.' },
  { key: 'accomplishment', label: 'Accomplishments', hint: 'What you did and what came of it.' },
  { key: 'metric', label: 'Numbers', hint: 'Figures you can defend, with where they come from.' },
  { key: 'skill', label: 'Skills', hint: 'Only what you would be comfortable being tested on.' },
  { key: 'credential', label: 'Credentials', hint: 'Degrees, honours, certifications, languages.' },
  { key: 'story', label: 'Stories', hint: 'STAR stories for interviews, while the details are fresh.' },
];

const OWN: Record<string, string> = {
  built_myself: 'built it myself', led: 'led it', contributed: 'contributed', team: 'team effort',
};

/** The evidence bank: the only material generated documents are allowed to use. */
export function Evidence() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['evidence'], queryFn: evidenceApi.list });
  const [adding, setAdding] = useState<EvidenceItem['kind'] | null>(null);
  const [show, setShow] = useState<'all' | 'unconfirmed'>('all');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['evidence'] });
    void qc.invalidateQueries({ queryKey: ['setup'] });
    void qc.invalidateQueries({ queryKey: ['bootstrap'] });
  };
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string; note?: string }) =>
      evidenceApi.setStatus(v.id, v.status, v.note),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: evidenceApi.remove, onSuccess: refresh });

  const items = useMemo(() => (data?.items ?? [])
    .filter((e) => show === 'all' || e.status === 'unconfirmed'), [data, show]);

  if (isLoading) return <Empty>Loading…</Empty>;

  const unconfirmed = (data?.items ?? []).filter((e) => e.status === 'unconfirmed').length;
  const confirmed = (data?.items ?? []).filter((e) => e.status === 'confirmed').length;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Your evidence bank</h2>
        <p className="mt-0.5 text-xs text-muted">
          Every resume, cover letter and interview brief is built only from confirmed items
          here. Claims pulled from a document start unconfirmed until you say they are
          accurate; anything you reject is kept as a record of what not to claim.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span><strong className="tabular-nums">{confirmed}</strong> confirmed</span>
          <span className={unconfirmed ? 'text-warn' : 'text-muted'}>
            <strong className="tabular-nums">{unconfirmed}</strong> waiting for review
          </span>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={show === 'unconfirmed'}
              onChange={(e) => setShow(e.target.checked ? 'unconfirmed' : 'all')} />
            Only what needs review
          </label>
        </div>
      </section>

      {KINDS.map((k) => {
        const rows = items.filter((e) => e.kind === k.key);
        if (show === 'unconfirmed' && rows.length === 0) return null;
        return (
          <section key={k.key}
            className={`rounded-xl border bg-panel p-4 ${k.key === 'boundary' ? 'border-risk/40' : 'border-line'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{k.label}
                  <span className="ml-1.5 font-normal text-muted">{rows.length}</span></h3>
                <p className="text-xs text-muted">{k.hint}</p>
              </div>
              <button type="button" onClick={() => setAdding(k.key)}
                className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">
                Add
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="mt-2 text-xs text-muted">Nothing yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {rows.map((e) => (
                  <li key={e.id} className={`py-2.5 ${e.status === 'rejected' ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${e.status === 'rejected' ? 'line-through' : 'font-medium'}`}>
                          {e.title}
                        </p>
                        <p className="text-xs text-muted">
                          {[e.context,
                            e.start_date && `${e.start_date} - ${e.end_date ?? 'Present'}`,
                            e.ownership && OWN[e.ownership],
                            e.level,
                            e.source !== 'user' && `from ${e.source_ref ?? e.source}`,
                          ].filter(Boolean).join(' · ')}
                        </p>
                        {e.detail && <p className="mt-1 text-xs leading-relaxed">{e.detail}</p>}
                        {e.metrics && <p className="mt-1 text-xs text-good">{e.metrics}</p>}
                        {e.tools.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-1">
                            {e.tools.map((t) => (
                              <span key={t} className="rounded bg-line px-1.5 py-px text-[11px]">{t}</span>
                            ))}
                          </p>
                        )}
                        {e.notes && <p className="mt-1 text-xs italic text-muted">{e.notes}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <StatusPill status={e.status} />
                        {e.status !== 'confirmed' && (
                          <button type="button"
                            onClick={() => setStatus.mutate({ id: e.id, status: 'confirmed' })}
                            className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-good hover:text-good">
                            confirm
                          </button>
                        )}
                        {e.status !== 'rejected' && (
                          <button type="button"
                            onClick={() => {
                              const note = window.prompt('What is actually true? (kept as a note)') ?? undefined;
                              setStatus.mutate({ id: e.id, status: 'rejected', note });
                            }}
                            className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-risk hover:text-risk">
                            not true
                          </button>
                        )}
                        <button type="button" onClick={() => remove.mutate(e.id)} aria-label="Delete"
                          className="rounded-md border border-line px-1.5 py-0.5 text-xs text-muted hover:text-risk">
                          ✕
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {adding && <AddEvidence kind={adding} onClose={() => { setAdding(null); refresh(); }} />}
    </div>
  );
}

function StatusPill({ status }: { status: EvidenceItem['status'] }) {
  const cls = status === 'confirmed' ? 'text-good border-good/40'
    : status === 'rejected' ? 'text-risk border-risk/40' : 'text-warn border-warn/40';
  return <span className={`rounded-full border px-2 py-px text-[11px] ${cls}`}>{status}</span>;
}

function AddEvidence({ kind, onClose }: { kind: EvidenceItem['kind']; onClose: () => void }) {
  const [f, setF] = useState({
    title: '', detail: '', context: '', ownership: '', level: '', start_date: '', end_date: '',
    metrics: '', tools: '', proof_url: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => evidenceApi.save({
      kind, title: f.title,
      detail: f.detail || null, context: f.context || null,
      ownership: (f.ownership || null) as EvidenceItem['ownership'],
      level: f.level || null,
      start_date: f.start_date || null, end_date: f.end_date || null,
      metrics: f.metrics || null, proof_url: f.proof_url || null,
      tools: f.tools ? f.tools.split(',').map((t) => t.trim()).filter(Boolean) : [],
      source: 'user',
    }),
    onSuccess: onClose,
    onError: (e: Error) => setErr(e.message),
  });

  const input = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent';
  const label = KINDS.find((k) => k.key === kind)!.label;

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-10 bg-black/25" />
      <div className="fixed left-1/2 top-8 z-20 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto
                      rounded-2xl border border-line bg-bg p-5" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
        <h2 className="mb-1 text-base font-semibold">Add to {label.toLowerCase()}</h2>
        <p className="mb-4 text-xs text-muted">
          Only what is true and you would defend out loud. Saved as confirmed, since it comes from you.
        </p>
        <div className="space-y-3">
          <input className={input} placeholder={kind === 'boundary'
            ? 'What must never be claimed' : kind === 'skill' ? 'Skill or tool' : 'One-line summary'}
            value={f.title} onChange={set('title')} autoFocus />
          <textarea className={input} rows={3} value={f.detail} onChange={set('detail')}
            placeholder={kind === 'boundary' ? 'What is true instead'
              : kind === 'skill' ? 'Where you used it (the proof)' : 'The full fact, specifically'} />
          {kind !== 'boundary' && (
            <div className="grid grid-cols-2 gap-2">
              <input className={input} placeholder="Where (employer, project)" value={f.context} onChange={set('context')} />
              {kind === 'skill' ? (
                <select className={input} value={f.level} onChange={set('level')}>
                  <option value="">Level</option>
                  <option value="familiar">familiar</option>
                  <option value="working">working</option>
                  <option value="strong">strong</option>
                  <option value="expert">expert</option>
                </select>
              ) : (
                <select className={input} value={f.ownership} onChange={set('ownership')}>
                  <option value="">Who did the work</option>
                  <option value="built_myself">I built it myself</option>
                  <option value="led">I led it</option>
                  <option value="contributed">I contributed</option>
                  <option value="team">Team effort</option>
                </select>
              )}
              <input className={input} placeholder="Start MM/YYYY" value={f.start_date} onChange={set('start_date')} />
              <input className={input} placeholder="End MM/YYYY or Present" value={f.end_date} onChange={set('end_date')} />
              <input className={input} placeholder="Metric, if any" value={f.metrics} onChange={set('metrics')} />
              <input className={input} placeholder="Tools, comma separated" value={f.tools} onChange={set('tools')} />
            </div>
          )}
          <input className={input} placeholder="Proof link (optional)" value={f.proof_url} onChange={set('proof_url')} />
        </div>
        {err && <p className="mt-3 text-xs text-risk">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">Cancel</button>
          <button type="button" disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </>
  );
}
