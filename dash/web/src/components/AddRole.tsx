import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Resolved } from '../api.ts';
import { statusLabel } from './bits.tsx';
import { useNav } from './nav.tsx';

const VIA: Record<Resolved['via'], string> = {
  greenhouse: 'Read from Greenhouse',
  lever: 'Read from Lever',
  yc: 'Read from Y Combinator',
  schema: 'Read from the posting data on the page',
  page: 'Only the page text was readable, so check the title and company',
  none: '',
};

/** Paste a link and the role fills itself in; referrals and anything a scraper will never see
 * can still be typed. Saving opens the role, where its documents are one click away. */
export function AddRole({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNav();
  const [form, setForm] = useState({
    title: '', company: '', location: '', url: '', salary: '', jd_text: '', closes_at: '',
  });
  // Whether the closing date came from the posting's words or the listing's expiry.
  const [closesSource, setClosesSource] = useState<'stated' | 'listing' | null>(null);
  const [postedAt, setPostedAt] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [queue, setQueue] = useState(true);
  const [read, setRead] = useState<Resolved | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const prefill = useMutation({
    mutationFn: (url: string) => api.fetchJd(url),
    onSuccess: (r) => {
      setRead(r);
      if (!r.ok && !r.title) return;
      // the canonical link it returns is the same posting, so it must not trigger a re-read
      if (r.url) lastRead.current = r.url;
      // What the link gives replaces what is there: the link is the source of truth.
      setForm((f) => ({
        ...f,
        url: r.url || f.url,
        title: r.title ?? f.title,
        company: r.company ?? f.company,
        location: r.location ?? f.location,
        salary: r.salary ?? f.salary,
        jd_text: r.jd_text ?? f.jd_text,
        closes_at: r.closes_at ?? f.closes_at,
      }));
      if (r.closes_at) setClosesSource(r.closes_source ?? 'stated');
      setPostedAt(r.posted_at ?? null);
    },
    onError: (e: Error) => setRead({ ok: false, via: 'none', reason: e.message } as Resolved),
  });

  // Any complete link gets read, however it arrived (pasted, typed, autofilled), once.
  const lastRead = useRef('');
  const readUrl = (url: string) => {
    const u = url.trim();
    if (!/^https?:\/\/[^\s/]+\.[^\s]+/.test(u) || u === lastRead.current) return;
    lastRead.current = u;
    setErr(null);
    prefill.mutate(u);
  };
  useEffect(() => {
    const t = setTimeout(() => readUrl(form.url), 700);
    return () => clearTimeout(t);
    // readUrl is stable in effect: it only reads refs and the mutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.url]);

  const open = (id: string) => { onClose(); nav.openJob(id); };

  const save = useMutation({
    mutationFn: () => api.addJob({
      title: form.title, company: form.company,
      location: form.location || undefined, url: form.url || undefined,
      salary: form.salary || undefined, jd_text: form.jd_text || undefined,
      rating, queue, posted_at: postedAt,
      closes_at: form.closes_at || null, closes_source: form.closes_at ? (closesSource ?? 'stated') : null,
    }),
    onSuccess: (r) => {
      for (const k of ['jobs', 'bootstrap', 'companies', 'trash']) void qc.invalidateQueries({ queryKey: [k] });
      open(r.id);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const input = 'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-30 bg-black/25" />
      <div className="fixed left-1/2 top-8 z-40 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2
                      overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-xl
                      sm:p-6" style={{ maxHeight: 'calc(100dvh - 4rem)' }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Add a role</h2>
            <p className="text-xs text-muted">
              Paste the posting link and the rest fills in. Scored by the same rules as an automated find.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>

        <Field label="Posting link">
          <div className="flex gap-2">
            <input value={form.url} autoFocus placeholder="https://jobs.ashbyhq.com/..."
              onChange={set('url')}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); readUrl(form.url); } }}
              className={`min-w-0 flex-1 ${input}`} />
            <button type="button" disabled={!form.url || prefill.isPending}
              onClick={() => { lastRead.current = ''; readUrl(form.url); }}
              className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs hover:border-accent disabled:opacity-40">
              {prefill.isPending ? 'Reading…' : 'Read'}
            </button>
          </div>
        </Field>

        {read && (
          <div className={`-mt-1 mb-3 rounded-lg border px-3 py-2 text-xs ${read.ok
            ? 'border-good/40 bg-good/10' : 'border-warn/40 bg-warn/10 text-warn'}`}>
            {read.ok ? VIA[read.via] : (read.reason ?? 'Could not read that link.')}
            {read.existing && (
              <span className="mt-1 block text-fg">
                Already in JobHunt as {statusLabel(read.existing.status)} (score {read.existing.score}).{' '}
                <button type="button" onClick={() => open(read.existing!.id)}
                  className="font-semibold text-accent underline underline-offset-2">Open it</button>
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Title" required>
            <input value={form.title} onChange={set('title')} className={input} />
          </Field>
          <Field label="Company" required>
            <input value={form.company} onChange={set('company')} className={input} />
          </Field>
          <Field label="Location">
            <input value={form.location} onChange={set('location')} placeholder="Boston, MA or Remote" className={input} />
          </Field>
          <Field label="Salary">
            <input value={form.salary} onChange={set('salary')} placeholder="optional" className={input} />
          </Field>
          <Field label={closesSource === 'listing' && form.closes_at ? 'Listing ends (not a stated deadline)' : 'Applications close'}>
            <input type="date" value={form.closes_at}
              onChange={(e) => { setForm((f) => ({ ...f, closes_at: e.target.value })); setClosesSource('stated'); }}
              className={input} />
          </Field>
        </div>

        <Field label={`Job description${form.jd_text ? ` (${form.jd_text.length.toLocaleString()} characters)` : ''}`}>
          <textarea value={form.jd_text} onChange={set('jd_text')} rows={5}
            placeholder="Filled from the link. If the site blocks reading (Indeed does), paste it here."
            className={input} />
        </Field>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={queue} onChange={(e) => setQueue(e.target.checked)} />
            Queue resume and cover letter now
          </label>
          <span className="inline-flex items-center gap-1 text-lg" title="Your rating, optional">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-label={`Rate ${n} of 5`}
                onClick={() => setRating(rating === n ? null : n)}
                className={`leading-none ${(rating ?? 0) >= n ? 'text-warn' : 'text-line hover:text-muted'}`}>
                {(rating ?? 0) >= n ? '★' : '☆'}
              </button>
            ))}
          </span>
        </div>

        {err && (
          <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{err}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-line px-3 py-2 text-sm hover:border-accent">
            Cancel
          </button>
          <button type="button"
            disabled={!form.title.trim() || !form.company.trim() || save.isPending}
            onClick={() => { setErr(null); save.mutate(); }}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {save.isPending ? 'Saving…' : queue ? 'Add and queue documents' : 'Add and score it'}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-semibold">
        {label}{required && <span className="text-risk"> *</span>}
      </span>
      {children}
    </label>
  );
}
