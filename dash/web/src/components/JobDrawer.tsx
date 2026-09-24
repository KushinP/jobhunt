import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Job } from '../api.ts';
import { Breakdown, Closes, ScoreBadge, STATUSES, shortDate, statusLabel } from './bits.tsx';
import { CompanyLink } from './nav.tsx';
import { Stars } from './Stars.tsx';
import { DocPreview } from './DocPreview.tsx';

/** Who made a status change, in plain words. */
const ACTOR_LABEL: Record<string, string> = {
  human: 'you', 'human-via-chat': 'you, via Claude', automation: 'automation',
};

export function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['job', id], queryFn: () => api.job(id) });
  const [portalUrl, setPortalUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (data?.job) {
      setNotes(data.job.notes ?? '');
      setPortalUrl(data.job.url ?? '');
    }
  }, [data?.job]);

  useEffect(() => {
    // an open preview takes Escape first
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !previewId) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, previewId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['job', id] });
    void qc.invalidateQueries({ queryKey: ['jobs'] });
    void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    void qc.invalidateQueries({ queryKey: ['company'] });
    void qc.invalidateQueries({ queryKey: ['companies'] });
    void qc.invalidateQueries({ queryKey: ['trash'] });
  };

  const status = useMutation({
    mutationFn: (s: string) => api.setStatus(id, s),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  const apply = useMutation({
    mutationFn: () => api.apply(id, portalUrl || undefined),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e: Error) => setErr(e.message),
  });

  // The server refuses a file that went out with an application; its reason is shown here.
  const removeDoc = useMutation({
    mutationFn: (docId: string) => api.deleteDocument(docId),
    onSuccess: () => { setErr(null); invalidate(); void qc.invalidateQueries({ queryKey: ['documents'] }); },
    onError: (e: Error) => setErr(e.message),
  });

  const saveNotes = useMutation({
    mutationFn: () => api.saveNotes(id, notes),
    onSuccess: invalidate,
  });

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/25"
      />
      <aside
        className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l
                   border-line bg-bg p-5 sm:p-6"
      >
        {isLoading || !data ? <p className="text-sm text-muted">Loading…</p> : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">{data.job.title}</h2>
                <p className="text-sm text-muted">
                  <CompanyLink name={data.job.company} className="inline" />
                  {data.job.location ? ` · ${data.job.location}` : ''}
                  {data.job.salary ? ` · ${data.job.salary}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ScoreBadge score={data.job.score} />
                <button type="button" onClick={onClose} className="text-muted hover:text-fg">✕</button>
              </div>
            </div>

            {data.job.url && (
              <a
                href={data.job.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-accent underline underline-offset-2"
              >
                Open the posting
              </a>
            )}

            <Facts job={data.job} onSaved={invalidate} onError={setErr} />

            {err && (
              <p className="mt-3 rounded-lg border border-risk/40 bg-risk/10 px-3 py-2 text-sm text-risk">
                {err}
              </p>
            )}

            <GeneratePanel
              status={data.job.status}
              notes={data.job.notes ?? null}
              dropReason={data.job.drop_reason}
              docs={data.documents.length}
              prompt={data.build_prompt}
              busy={status.isPending}
              onMove={(s) => status.mutate(s)}
            />

            <Section title="Your rating">
              <div className="flex items-center gap-3">
                <Stars id={id} rating={data.job.rating} size="md" />
                <span className="text-xs text-muted">
                  {data.job.rating == null
                    ? 'Unrated. This is what tells you whether the score is worth anything.'
                    : data.job.rating >= 4
                      ? 'Prioritise this one.'
                      : 'Rated low: worth asking why the score disagrees.'}
                </span>
              </div>
            </Section>

            <Section title="Score">
              <Breakdown raw={data.job.score_breakdown} />
              {data.job.drop_reason && (
                <p className="mt-2 text-xs text-muted">
                  {data.job.status === 'Discarded'
                    ? `Filtered out: ${data.job.drop_reason}.`
                    : `The scorer would have filtered this out (${data.job.drop_reason}); your choice overrides it.`}
                </p>
              )}
            </Section>

            <Section title="Documents">
              {data.documents.length === 0
                ? <p className="text-sm text-muted">Nothing built yet.</p>
                : (
                  <ul className="space-y-1.5">
                    {data.documents.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                        <button type="button" onClick={() => setPreviewId(d.id)} title="Preview"
                          className="min-w-0 truncate text-left text-accent underline underline-offset-2">
                          {d.filename}
                        </button>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                          {d.kind === 'resume' ? 'resume' : 'cover letter'}
                          {d.page_count ? ` · ${d.page_count}p` : ''}
                          {d.page_count && !d.page_count_verified ? ' (est.)' : ''}
                          <a href={`/doc/${d.id}`} className="rounded px-1 text-muted hover:text-fg">download</a>
                          {data.job.status !== 'Applied' && (
                            <button type="button" disabled={removeDoc.isPending}
                              onClick={() => {
                                if (window.confirm(`Delete "${d.filename}"? This cannot be undone.`)) removeDoc.mutate(d.id);
                              }}
                              className="rounded px-1 text-muted hover:text-risk disabled:opacity-40">
                              delete
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
            </Section>

            <Section title="Move">
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.filter((s) => s !== 'Applied').map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={s === data.job.status || status.isPending}
                    onClick={() => status.mutate(s)}
                    className="rounded-md border border-line px-2.5 py-1 text-xs
                               hover:border-accent disabled:opacity-40"
                  >
                    {statusLabel(s)}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-line p-3">
                <p className="text-xs text-muted">
                  Marking applied snapshots exactly which documents went out, so interview prep
                  reads what the hiring manager actually has.
                </p>
                <input
                  value={portalUrl}
                  onChange={(e) => setPortalUrl(e.target.value)}
                  placeholder="Portal URL (optional)"
                  className="mt-2 w-full rounded-md border border-line bg-panel px-2.5 py-1.5
                             text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={apply.isPending || data.job.status === 'Applied'}
                  onClick={() => apply.mutate()}
                  className="mt-2 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold
                             text-white disabled:opacity-50"
                >
                  {data.job.status === 'Applied' ? 'Already applied' : 'I submitted this'}
                </button>
              </div>
            </Section>

            <Section title="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => saveNotes.mutate()}
                rows={3}
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm
                           outline-none focus:border-accent"
                placeholder="Anything worth remembering about this role"
              />
            </Section>

            {data.interviews.length > 0 && (
              <Section title="Interviews">
                <ul className="space-y-1.5 text-sm">
                  {data.interviews.map((iv) => (
                    <li key={iv.id} className="flex justify-between gap-3">
                      <span>
                        {iv.round.replace(/_/g, ' ')}
                        {iv.interviewer ? ` · ${iv.interviewer}` : ''}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {iv.scheduled_at?.slice(0, 16) ?? 'unscheduled'} · {iv.outcome}
                        {iv.hit_rate != null ? ` · ${iv.hit_rate}% predicted` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {data.job.jd_text && (
              <Section title="Job description">
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border
                                border-line bg-panel p-3 text-xs leading-relaxed">
                  {data.job.jd_text}
                </pre>
              </Section>
            )}

            <Section title="History">
              <ul className="space-y-1 text-xs text-muted">
                {data.history.map((h, i) => (
                  <li key={i}>
                    {h.at} · {h.from_status ?? 'new'} → {h.to_status}
                    <span className="ml-1 rounded bg-line px-1 py-px">{ACTOR_LABEL[h.actor] ?? h.actor}</span>
                  </li>
                ))}
                {data.history.length === 0 && <li>No moves yet.</li>}
              </ul>
            </Section>
          </>
        )}
      </aside>
      {previewId && data && (
        <DocPreview
          docs={[...data.documents].sort((a, b) => (a.kind === 'resume' ? -1 : 1) - (b.kind === 'resume' ? -1 : 1))}
          initialId={previewId}
          title={`${data.job.title} · ${data.job.company}`}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Getting documents for this role: queue it for the next build run, or build it right now in
 * a Claude chat prefilled with the instructions for this one role. The dashboard never calls
 * a model itself; the build runs in your own Claude, with your skills and evidence bank.
 */
function GeneratePanel({ status, notes, dropReason, docs, prompt, busy, onMove }: {
  status: string; notes: string | null; dropReason: string | null; docs: number;
  prompt: string; busy: boolean; onMove: (s: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const q = encodeURIComponent(prompt);
  const fitCheck = notes?.match(/Fit check:[^\n]*/)?.[0];
  const queued = status === 'Generate';
  const built = docs > 0 || status === 'Complete';
  const closed = ['Applied', 'Interviewing', 'Offer', 'Rejected'].includes(status);

  const link = 'rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent';
  return (
    <section className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {built ? 'Documents built' : queued ? 'Queued for documents' : 'Resume and cover letter'}
        </h3>
        {!queued && !built && !closed && (
          <button type="button" disabled={busy} onClick={() => onMove('Generate')}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Generate
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        {built
          ? 'Download them below. Build again if the JD or your evidence changed.'
          : queued
            ? 'Builds on the next document run. To have them now, build it in Claude:'
            : status === 'Discarded'
              ? `Filtered out${dropReason ? `: ${dropReason}` : ''}. Generate overrides that; your call wins.`
              : 'Generate queues it for the next document run. Or build it right now in Claude:'}
      </p>
      {fitCheck && !built && (
        <p className="mt-1 text-xs text-warn">{fitCheck}. Generate again to build it anyway.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <a href={`claude://cowork/new?q=${q}`} className={link}>{built ? 'Rebuild' : 'Build now'} in the Claude app</a>
        <a href={`https://claude.ai/new?q=${q}`} target="_blank" rel="noreferrer" className={link}>in a browser</a>
        <button type="button" className={link}
          onClick={async () => {
            try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
          }}>
          {copied ? 'Copied' : 'Copy instructions'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">Claude opens with the instructions filled in; press send. The files land here and in Documents.</p>
    </section>
  );
}

/**
 * What the role is, as facts you can correct: a salary a job board never gave, a location
 * written as a code, a link that goes to the wrong page, the deadline. The dates JobHunt
 * knows for itself (found, applied) are shown beside them but are not editable.
 */
function Facts({ job, onSaved, onError }: {
  job: Job; onSaved: () => void; onError: (m: string | null) => void;
}) {
  const save = useMutation({
    mutationFn: (patch: { salary?: string | null; location?: string | null; url?: string | null }) =>
      api.setDetails(job.id, patch),
    onSuccess: () => { onError(null); onSaved(); },
    onError: (e: Error) => onError(e.message),
  });
  const closes = useMutation({
    mutationFn: (v: string | null) => api.setCloses(job.id, v),
    onSuccess: () => { onError(null); onSaved(); },
    onError: (e: Error) => onError(e.message),
  });
  return (
    <dl className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-xs">
      <Fact label="Salary" value={job.salary} placeholder="$120,000 - $150,000"
        saving={save.isPending} onSave={(v) => save.mutate({ salary: v })} />
      <Fact label="Location" value={job.location} placeholder="Boston, MA or Remote"
        saving={save.isPending} onSave={(v) => save.mutate({ location: v })} />
      <Fact label="Closes" value={job.closes_at} type="date" saving={closes.isPending}
        onSave={(v) => closes.mutate(v)}
        display={<Closes at={job.closes_at} source={job.closes_source} />} />
      <div><dt className="inline text-muted">Found </dt><dd className="inline">{shortDate(job.created_at)}</dd></div>
      {job.applied_at && <div><dt className="inline text-muted">Applied </dt><dd className="inline">{shortDate(job.applied_at)}</dd></div>}
    </dl>
  );
}

/** One fact, read-only until you click it. Saving an empty box clears the field. */
function Fact({ label, value, display, placeholder, type = 'text', saving, onSave }: {
  label: string; value: string | null | undefined; display?: React.ReactNode;
  placeholder?: string; type?: 'text' | 'date'; saving: boolean; onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); setEditing(false); }, [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? '')) { setEditing(false); return; }
    onSave(next || null);
  };
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        {editing ? (
          <>
            <input type={type} value={draft} placeholder={placeholder} autoFocus disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
              }}
              className={`rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs outline-none
                          focus:border-accent ${type === 'date' ? '' : 'w-44'}`} />
            <button type="button" disabled={saving} onClick={commit} className="font-semibold text-accent">Save</button>
            <button type="button" onClick={() => { setDraft(value ?? ''); setEditing(false); }}
              className="text-muted hover:text-fg">Cancel</button>
          </>
        ) : (
          <>
            {value ? (display ?? <span>{value}</span>) : <span className="text-muted">-</span>}
            <button type="button" onClick={() => setEditing(true)}
              className="text-muted underline underline-offset-2 hover:text-fg">
              {value ? 'edit' : 'add'}
            </button>
          </>
        )}
      </dd>
    </div>
  );
}

