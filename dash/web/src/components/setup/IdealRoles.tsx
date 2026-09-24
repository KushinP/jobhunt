import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, type SetupData } from '../../api.ts';
import { Panel } from '../Setup.tsx';

/** The archetypes drive both scoring and which master a role is tailored from, so this is
 * the highest-leverage thing on the page. Simple fields are forms; the term lists are
 * edited as JSON, which is honest about what they are rather than hiding them behind a
 * chip editor that would take longer to use. */
export function IdealRoles({ data }: { data: SetupData }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['setup'] });

  const [cutoff, setCutoff] = useState(String(data.config.thresholds.hard_cutoff));
  const [auto, setAuto] = useState(String(data.config.thresholds.auto_generate));
  const [gh, setGh] = useState(data.config.target_boards.greenhouse.join(', '));
  const [lv, setLv] = useState(data.config.target_boards.lever.join(', '));
  const [ab, setAb] = useState(data.config.target_boards.ashby.join(', '));
  const [locs, setLocs] = useState(data.config.locations_local.join(', '));
  const [json, setJson] = useState(JSON.stringify(data.config.archetypes, null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => setJson(JSON.stringify(data.config.archetypes, null, 2)), [data.config.archetypes]);

  const flash = (m: string) => { setSaved(m); setTimeout(() => setSaved(null), 2000); };
  const save = useMutation({
    mutationFn: (v: { key: string; value: unknown }) => setupApi.saveConfig(v.key, v.value),
    onSuccess: (_r, v) => { flash(`${v.key} saved.`); refresh(); },
  });

  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  return (
    <Panel
      title="Ideal roles and filters"
      note="What counts as a good role, in priority order. These terms are matched with word boundaries against the title and job description, so 'intern' will not catch 'International'."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Hard cutoff" hint="below this, a role is discarded and never shown">
          <input value={cutoff} onChange={(e) => setCutoff(e.target.value)} type="number"
            className="w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent" />
        </Row>
        <Row label="Auto-generate at" hint="at or above this, documents are built unattended">
          <input value={auto} onChange={(e) => setAuto(e.target.value)} type="number"
            className="w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent" />
        </Row>
      </div>
      <button type="button"
        onClick={() => save.mutate({
          key: 'thresholds',
          value: { hard_cutoff: Number(cutoff), auto_generate: Number(auto) },
        })}
        className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
        Save thresholds
      </button>

      <hr className="my-4 border-line" />

      <p className="mb-2 text-xs font-semibold">Commutable locations</p>
      <input value={locs} onChange={(e) => setLocs(e.target.value)}
        className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                   outline-none focus:border-accent" />
      <p className="mt-1 text-xs text-muted">
        Comma separated. A role that is neither in this list nor remote is filtered out
        entirely, not merely scored lower.
      </p>
      <button type="button"
        onClick={() => save.mutate({ key: 'locations_local', value: list(locs) })}
        className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
        Save locations
      </button>

      <hr className="my-4 border-line" />

      <p className="mb-1 text-xs font-semibold">Target company boards</p>
      <p className="mb-2 text-xs text-muted">
        The company slug from its board URL. These postings are the freshest and least
        contested source you have, and this is empty by default.
      </p>
      <div className="space-y-2">
        {([['Greenhouse', gh, setGh], ['Lever', lv, setLv], ['Ashby', ab, setAb]] as const).map(
          ([name, val, set]) => (
            <label key={name} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-muted">{name}</span>
              <input value={val} onChange={(e) => set(e.target.value)}
                placeholder="ramp, figma, linear"
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1.5
                           text-sm outline-none focus:border-accent" />
            </label>
          ))}
      </div>
      <button type="button"
        onClick={() => save.mutate({
          key: 'target_boards',
          value: { greenhouse: list(gh), lever: list(lv), ashby: list(ab) },
        })}
        className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
        Save boards
      </button>

      <hr className="my-4 border-line" />

      <p className="mb-1 text-xs font-semibold">Archetypes</p>
      <ul className="mb-2 space-y-1 text-xs text-muted">
        {data.config.archetypes.map((a) => (
          <li key={a.id}>
            <span className="font-medium text-fg">{a.id}. {a.name}</span>
            {' — '}{a.title_terms.length} title, {a.domain_terms.length} domain,{' '}
            {a.skill_terms.length} skill terms
          </li>
        ))}
      </ul>
      <textarea value={json} onChange={(e) => { setJson(e.target.value); setJsonErr(null); }}
        rows={12}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs
                   outline-none focus:border-accent" />
      {jsonErr && <p className="mt-1 text-xs text-risk">{jsonErr}</p>}
      <button type="button"
        onClick={() => {
          try {
            const parsed = JSON.parse(json) as unknown;
            if (!Array.isArray(parsed) || parsed.length === 0) {
              setJsonErr('Needs to be a non-empty array of archetypes.'); return;
            }
            for (const a of parsed as Record<string, unknown>[]) {
              if (typeof a.id !== 'number' || typeof a.name !== 'string'
                  || !Array.isArray(a.title_terms)) {
                setJsonErr('Each archetype needs a numeric id, a name, and title_terms.');
                return;
              }
            }
            save.mutate({ key: 'archetypes', value: parsed });
          } catch (e) {
            setJsonErr(`That is not valid JSON: ${String(e)}`);
          }
        }}
        className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white">
        Save archetypes
      </button>
      {saved && <p className="mt-2 text-xs text-good">{saved}</p>}
    </Panel>
  );
}

function Row({ label, hint, children }: {
  label: string; hint: string; children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold">{label}</span>
      {children}
      <span className="mt-1 block text-xs text-muted">{hint}</span>
    </div>
  );
}
