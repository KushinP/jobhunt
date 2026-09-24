import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DocRow } from '../api.ts';
import { Empty, shortDate, statusLabel } from './bits.tsx';
import { CompanyLink, useNav } from './nav.tsx';
import { DocPreview } from './DocPreview.tsx';

/** Every resume and cover letter Claude has built, in one place. The build run stores each
 * file here as it makes it; a role's drawer shows the same files for that role alone. */
export function Documents({ search }: { search: string }) {
  const nav = useNav();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'all' | 'resume' | 'cover_letter'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocRow | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['documents'], queryFn: api.documents });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data ?? []).filter((d) => (kind === 'all' || d.kind === kind)
      && (!needle || `${d.title} ${d.company} ${d.filename}`.toLowerCase().includes(needle)));
  }, [data, kind, search]);

  // One at a time, so a refusal (a file that went out with an application) stops only itself.
  const remove = useMutation({
    mutationFn: async (docs: DocRow[]) => {
      const failed: string[] = [];
      for (const d of docs) {
        try { await api.deleteDocument(d.id); } catch (e) { failed.push(`${d.filename}: ${(e as Error).message}`); }
      }
      return failed;
    },
    onSuccess: (failed) => {
      setPicked(new Set());
      setErr(failed.length ? failed.join(' ') : null);
      for (const k of ['documents', 'jobs', 'job', 'bootstrap', 'company', 'companies']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });

  const confirmDelete = (docs: DocRow[]) => {
    if (docs.length === 0) return;
    const what = docs.length === 1 ? `"${docs[0].filename}"` : `${docs.length} files`;
    if (window.confirm(`Delete ${what}? This cannot be undone. Generate on the role builds new ones.`)) {
      remove.mutate(docs);
    }
  };

  if (isLoading) return <Empty>Loading…</Empty>;
  if (error) return <Empty>Could not load documents: {String(error)}</Empty>;
  if ((data ?? []).length === 0) {
    return (
      <Empty>
        No documents yet. Every resume and cover letter the build run makes is stored here, with
        the role it was written for. Queue a role with Generate, or open it and use Build now.
      </Empty>
    );
  }

  const resumes = (data ?? []).filter((d) => d.kind === 'resume').length;
  const letters = (data ?? []).length - resumes;
  const deletable = rows.filter((d) => !d.submitted);
  const pickedRows = rows.filter((d) => picked.has(d.id));
  const allPicked = deletable.length > 0 && deletable.every((d) => picked.has(d.id));
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col sm:h-[calc(100dvh-10.25rem)]">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {([['all', `All (${resumes + letters})`], ['resume', `Resumes (${resumes})`], ['cover_letter', `Cover letters (${letters})`]] as const)
            .map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setKind(k); setPicked(new Set()); }}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${kind === k
                  ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}>
                {label}
              </button>
            ))}
        </div>
        {pickedRows.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">{pickedRows.length} selected</span>
            <button type="button" onClick={() => setPicked(new Set())}
              className="rounded-md border border-line px-2 py-1 hover:border-accent">Clear</button>
            <button type="button" disabled={remove.isPending} onClick={() => confirmDelete(pickedRows)}
              className="rounded-md border border-risk/50 bg-risk/10 px-2 py-1 font-semibold text-risk disabled:opacity-50">
              {remove.isPending ? 'Deleting…' : `Delete ${pickedRows.length}`}
            </button>
          </div>
        )}
      </div>

      {err && (
        <p className="mb-3 shrink-0 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</p>
      )}

      {rows.length === 0 ? <Empty>No documents match.</Empty> : (
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-panel text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" aria-label="Select every file that can be deleted"
                  checked={allPicked} disabled={deletable.length === 0}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(deletable.map((d) => d.id)))} />
              </th>
              <th className="px-3 py-2 font-semibold">File</th>
              <th className="px-3 py-2 font-semibold">For</th>
              <th className="hidden px-3 py-2 font-semibold sm:table-cell">Pages</th>
              <th className="hidden px-3 py-2 font-semibold md:table-cell">Role status</th>
              <th className="px-3 py-2 font-semibold">Built</th>
              <th className="px-3 py-2"><span className="sr-only">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={`border-t border-line align-top ${picked.has(d.id) ? 'bg-accent/5' : ''}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={`Select ${d.filename}`} checked={picked.has(d.id)}
                    disabled={!!d.submitted} onChange={() => toggle(d.id)}
                    title={d.submitted ? 'Sent with your application, so it is kept' : undefined} />
                </td>
                <td className="max-w-[10rem] px-3 py-2 sm:max-w-[18rem]">
                  <button type="button" onClick={() => setPreview(d)} title="Preview"
                    className="block max-w-full truncate text-left text-accent underline underline-offset-2">{d.filename}</button>
                  <span className="text-xs text-muted">
                    {d.kind === 'resume' ? 'Resume' : 'Cover letter'}
                    {d.submitted ? ' · sent with the application' : ''}
                  </span>
                </td>
                <td className="max-w-[9rem] px-3 py-2 sm:max-w-[20rem]">
                  <button type="button" onClick={() => nav.openJob(d.job_id)}
                    className="block max-w-full truncate text-left hover:text-accent hover:underline underline-offset-2">
                    {d.title}
                  </button>
                  <CompanyLink name={d.company} className="text-xs text-muted" />
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted sm:table-cell">
                  {d.page_count ? `${d.page_count}${d.page_count_verified ? '' : ' (est.)'}` : '-'}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs md:table-cell">{statusLabel(d.status)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{shortDate(d.generated_at)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  <a href={`/doc/${d.id}`} aria-label={`Download ${d.filename}`} title="Download"
                    className="mr-0.5 inline-block rounded-md px-1.5 py-1 text-muted hover:bg-panel hover:text-fg">
                    <DownloadIcon />
                  </a>
                  {d.submitted ? (
                    <span className="text-[11px] text-muted" title="Interview prep reads the exact file that went out">kept</span>
                  ) : (
                    <button type="button" aria-label={`Delete ${d.filename}`} title="Delete this file"
                      disabled={remove.isPending} onClick={() => confirmDelete([d])}
                      className="rounded-md px-1.5 py-1 text-muted hover:bg-risk/10 hover:text-risk disabled:opacity-40">
                      <TrashIcon />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {preview && (
        <DocPreview
          docs={(data ?? []).filter((x) => x.job_id === preview.job_id)
            .sort((a, b) => (a.kind === 'resume' ? -1 : 1) - (b.kind === 'resume' ? -1 : 1))}
          initialId={preview.id}
          title={`${preview.title} · ${preview.company}`}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5" />
    </svg>
  );
}
