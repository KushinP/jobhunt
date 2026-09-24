import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { prefsApi, type TargetCity } from '../../api.ts';
import { Panel } from '../Setup.tsx';

const STATUS_LABEL: Record<string, string> = {
  built_in: 'built in', connector: 'needs a connector', api_key: 'needs a key', browser: 'in your browser',
  planned: 'not built yet', unsupported: 'not supported',
};

/** Preferences, cities and platforms. The same fields the onboarding interview fills. */
export function Preferences() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['prefs'], queryFn: prefsApi.get });
  const [p, setP] = useState<NonNullable<typeof data>['preferences'] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (data) setP(structuredClone(data.preferences)); }, [data]);

  const save = useMutation({
    // send only what changed, so an untouched field is never recorded as answered
    mutationFn: () => {
      const before = data!.preferences as unknown as Record<string, unknown>;
      const after = p as unknown as Record<string, unknown>;
      const diff = Object.fromEntries(Object.entries(after)
        .filter(([k, v]) => k !== 'answered' && JSON.stringify(v) !== JSON.stringify(before[k])));
      return prefsApi.save(diff);
    },
    onSuccess: (r) => {
      setMsg({
        ok: true,
        text: ['Saved.', ...r.warnings, r.synced_answers.length
          ? `Also updated application answers: ${r.synced_answers.join(', ')}.` : '']
          .filter(Boolean).join(' '),
      });
      void qc.invalidateQueries({ queryKey: ['prefs'] });
      void qc.invalidateQueries({ queryKey: ['setup'] });
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  if (!data || !p) return null;

  const input = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent';
  const list = (v: string[]) => v.join(', ');
  const parse = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const setCity = (i: number, c: Partial<TargetCity>) =>
    setP({ ...p, target_cities: p.target_cities.map((x, j) => (j === i ? { ...x, ...c } : x)) });

  const searches = p.sources.includes('indeed') ? data.query_count * (p.target_cities.length || 1) : 0;

  return (
    <Panel
      title="Preferences, cities and platforms"
      note="What makes a role acceptable beyond what it is. The comp floor filters postings that state less; ruled-out industries are filtered however well the role matches; every target city is searched."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-semibold">Work modes you accept</span>
          <div className="flex gap-3 text-sm">
            {['remote', 'hybrid', 'onsite'].map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="checkbox" checked={p.work_modes.includes(m)}
                  onChange={() => setP({ ...p, work_modes: toggle(p.work_modes, m) })} />
                {m}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="mb-1 block text-xs font-semibold">Comp floor (base)</span>
            <input className={input} type="number" value={p.comp_floor ?? ''}
              onChange={(e) => setP({ ...p, comp_floor: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold">Comp target</span>
            <input className={input} type="number" value={p.comp_target ?? ''}
              onChange={(e) => setP({ ...p, comp_target: e.target.value ? Number(e.target.value) : null })} />
          </label>
        </div>
        <label>
          <span className="mb-1 block text-xs font-semibold">Company stages you prefer</span>
          <input className={input} value={list(p.company_stages)} placeholder="seed, series a, growth, public"
            onChange={(e) => setP({ ...p, company_stages: parse(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Industries you prefer</span>
          <input className={input} value={list(p.industries_prefer)} placeholder="ai, proptech, hospitality"
            onChange={(e) => setP({ ...p, industries_prefer: parse(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Industries to rule out</span>
          <input className={input} value={list(p.industries_avoid)} placeholder="filtered however well the role matches"
            onChange={(e) => setP({ ...p, industries_avoid: parse(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Dealbreakers</span>
          <input className={input} value={list(p.dealbreakers)}
            onChange={(e) => setP({ ...p, dealbreakers: parse(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Relocation</span>
          <select className={input} value={p.relocation ?? ''}
            onChange={(e) => setP({ ...p, relocation: e.target.value || null })}>
            <option value="">not set</option>
            <option value="no">No</option>
            <option value="for_the_right_role">For the right role</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="mb-1 block text-xs font-semibold">Earliest start</span>
            <input className={input} type="date" value={p.earliest_start ?? ''}
              onChange={(e) => setP({ ...p, earliest_start: e.target.value || null })} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold">Need sponsorship?</span>
            <select className={input} value={p.sponsorship_needed == null ? '' : String(p.sponsorship_needed)}
              onChange={(e) => setP({ ...p, sponsorship_needed: e.target.value === '' ? null : e.target.value === 'true' })}>
              <option value="">not set</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
        </div>
      </div>

      <hr className="my-4 border-line" />

      <p className="text-xs font-semibold">Target cities</p>
      <p className="mb-2 text-xs text-muted">
        Each is searched. "Counts as" is the words in a posting's location that mean this city.
        Remote roles are always considered.
      </p>
      <div className="space-y-2">
        {p.target_cities.map((c, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[8rem_10rem_1fr_auto]">
            <input className={input} value={c.name} placeholder="Name" onChange={(e) => setCity(i, { name: e.target.value })} />
            <input className={input} value={c.search} placeholder="Search as" onChange={(e) => setCity(i, { search: e.target.value })} />
            <input className={input} value={list(c.match)} placeholder="Counts as"
              onChange={(e) => setCity(i, { match: parse(e.target.value) })} />
            <button type="button" onClick={() => setP({ ...p, target_cities: p.target_cities.filter((_, j) => j !== i) })}
              className="rounded-md border border-line px-2 text-xs text-muted hover:text-risk">remove</button>
          </div>
        ))}
      </div>
      <button type="button"
        onClick={() => setP({ ...p, target_cities: [...p.target_cities, { name: '', search: '', match: [] }] })}
        className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent">
        Add a city
      </button>

      <hr className="my-4 border-line" />

      <p className="text-xs font-semibold">Platforms to search</p>
      {searches > 0 && (
        <p className="mb-2 text-xs text-muted">
          About {searches} Indeed searches a day ({data.query_count} queries × {p.target_cities.length} cities).
        </p>
      )}
      <ul className="space-y-2">
        {data.sources.map((s) => {
          const on = p.sources.includes(s.id);
          const usable = s.status !== 'planned' && s.status !== 'unsupported';
          return (
            <li key={s.id} className={`rounded-lg border border-line p-2.5 ${usable ? '' : 'opacity-70'}`}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={on} disabled={!usable && !on}
                  onChange={() => setP({ ...p, sources: toggle(p.sources, s.id) })} />
                <span className="min-w-0">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="ml-2 rounded bg-line px-1.5 py-px text-[11px]">{STATUS_LABEL[s.status]}</span>
                  <span className="block text-xs text-muted">{s.how} {s.cost}.</span>
                  {on && s.setup.length > 0 && (
                    <ol className="mt-1 list-decimal pl-4 text-xs">
                      {s.setup.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs font-semibold">Connectors that power features</p>
      <ul className="mt-1 space-y-1 text-xs text-muted">
        {data.feature_connectors.map((c) => (
          <li key={c.id}><span className="font-medium text-fg">{c.name}</span>: {c.for}. {c.setup}</li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={save.isPending} onClick={() => { setMsg(null); save.mutate(); }}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {save.isPending ? 'Saving…' : 'Save preferences'}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-good' : 'text-risk'}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}
