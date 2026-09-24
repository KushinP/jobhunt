import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, type SetupData } from '../../api.ts';
import { Panel } from '../Setup.tsx';

export function BaseResumes({ data }: { data: SetupData }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [archetype, setArchetype] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['setup'] });
    void qc.invalidateQueries({ queryKey: ['bootstrap'] });
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a .docx file first.');
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (const b of buf) bin += String.fromCharCode(b);
      return setupApi.uploadBaseResume({
        label: label.trim() || file.name.replace(/\.docx$/i, ''),
        filename: file.name,
        content_base64: btoa(bin),
        archetype,
      });
    },
    onSuccess: (r) => {
      setErr(null);
      setMsg(r.text_extracted
        ? `${r.replaced ? 'Replaced' : 'Stored'}, and the text was read out of it.`
        : `${r.replaced ? 'Replaced' : 'Stored'}, but the text could not be read `
          + `(${r.text_reason ?? 'unknown'}). Tailoring will be weaker until that works.`);
      setFile(null); setLabel(''); setArchetype(null);
      refresh();
    },
    onError: (e: Error) => { setMsg(null); setErr(e.message); },
  });

  const remove = useMutation({
    mutationFn: setupApi.deleteBaseResume,
    onSuccess: refresh,
  });

  const uncovered = data.config.archetypes.filter(
    (a) => !data.base_resumes.some((r) => r.active && r.archetype === a.id));

  return (
    <Panel
      title="Base resumes"
      note="Your masters, one per archetype. Every tailored resume starts from one of these, which is what keeps dates, titles and credentials identical across a hundred applications. Fix mistakes here, not in the generated output."
    >
      {data.base_resumes.length === 0 ? (
        <p className="mb-3 text-sm text-muted">
          None uploaded. Document building will skip every role until there is at least one.
        </p>
      ) : (
        <ul className="mb-3 divide-y divide-line">
          {data.base_resumes.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-xs text-muted">
                  {r.filename} · {(r.byte_size / 1024).toFixed(0)}KB ·{' '}
                  {r.archetype
                    ? data.config.archetypes.find((a) => a.id === r.archetype)?.name
                      ?? `archetype ${r.archetype}`
                    : 'no archetype set'}
                  {r.has_text ? '' : ' · text unreadable'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href={`/api/base-resumes/${r.id}/file`}
                  className="text-xs text-accent underline underline-offset-2">download</a>
                <button type="button" onClick={() => remove.mutate(r.id)}
                  className="rounded-md border border-line px-2 py-1 text-xs hover:border-risk
                             hover:text-risk">
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {uncovered.length > 0 && (
        <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          No master for: {uncovered.map((a) => a.name).join(', ')}. Roles in those
          archetypes will be tailored from a less relevant resume.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-semibold">File (.docx)</span>
          <input type="file" accept=".docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="from filename"
            className="w-36 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold">Archetype</span>
          <select value={archetype ?? ''}
            onChange={(e) => setArchetype(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm
                       outline-none focus:border-accent">
            <option value="">none</option>
            {data.config.archetypes.map((a) => (
              <option key={a.id} value={a.id}>{a.id}. {a.name}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!file || upload.isPending}
          onClick={() => upload.mutate()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white
                     disabled:opacity-50">
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-good">{msg}</p>}
      {err && <p className="mt-2 text-xs text-risk">{err}</p>}
    </Panel>
  );
}
