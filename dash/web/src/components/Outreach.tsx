import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, outreachApi, type OutreachRow } from '../api.ts';
import { Empty, shortDate } from './bits.tsx';
import { useNav } from './nav.tsx';

/** What can be recorded next, given where a touch is now. Every one of these is something
 * that happened in the world, so every one is a click the person makes. */
const ACTIONS: { label: string; status: string; from: string[] }[] = [
  { label: 'Mark Sent', status: 'Sent', from: ['Drafted'] },
  { label: 'Mark Accepted', status: 'Accepted', from: ['Sent'] },
  { label: 'Mark Replied', status: 'Replied', from: ['Sent', 'Accepted'] },
  { label: 'Mark Meeting', status: 'Meeting', from: ['Sent', 'Accepted', 'Replied'] },
  { label: 'Close', status: 'Closed', from: ['Drafted', 'Sent', 'Accepted', 'Replied', 'Meeting', 'No reply'] },
];

const TONE: Record<string, string> = {
  Drafted: 'border-line text-muted', Sent: 'border-accent/40 text-accent',
  Accepted: 'border-good/40 text-good', Replied: 'border-good/50 text-good',
  Meeting: 'border-good bg-good/10 text-good', 'No reply': 'border-line text-muted',
  Closed: 'border-line text-muted',
};

const pct = (v: number | null) => (v == null ? '-' : `${Math.round(v * 100)}%`);

/**
 * Outreach: messages sent to a person about a role. The dashboard never sends anything; these
 * buttons record what the person did, and the server checks the cadence rules before agreeing.
 */
export function Outreach() {
  const qc = useQueryClient();
  const nav = useNav();
  const [status, setStatus] = useState('');
  const [company, setCompany] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const touches = useQuery({ queryKey: ['outreach'], queryFn: () => outreachApi.list({ limit: 200 }) });
  const due = useQuery({ queryKey: ['outreach-due'], queryFn: outreachApi.due });
  const followups = useQuery({ queryKey: ['followups'], queryFn: api.followups });
  const metrics = useQuery({ queryKey: ['metrics'], queryFn: api.metrics });

  const move = useMutation({
    mutationFn: ({ id, status: to }: { id: string; status: string }) => outreachApi.update(id, { status: to }),
    onSuccess: () => {
      setError(null);
      for (const k of ['outreach', 'outreach-due', 'metrics', 'jobs', 'job']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error, vars) => setError({ id: vars.id, message: e.message }),
  });

  const rows = useMemo(() => (touches.data ?? []).filter((t) => (!status || t.status === status)
    && (!company || t.company.toLowerCase().includes(company.toLowerCase()))), [touches.data, status, company]);

  const sentThisWeek = (touches.data ?? []).filter((t) => t.sent_at
    && Date.now() - new Date(`${t.sent_at.replace(' ', 'T')}Z`).getTime() < 7 * 86_400_000).length;
  const m = metrics.data?.outreach;
  const queue = [
    ...(due.data?.due ?? []).map((d) => ({
      key: `o-${d.id}`, kind: 'Outreach' as const, id: d.id, title: `${d.contact_name} at ${d.company}`,
      detail: d.detail, reason: d.reason, job_id: d.job_id,
    })),
    ...(followups.data ?? []).map((f) => ({
      key: `f-${f.id}`, kind: 'Application' as const, id: f.id, title: `${f.title} at ${f.company}`,
      detail: `Applied ${shortDate(f.applied_at)}, no movement since.`, reason: f.kind.replace(/_/g, ' '),
      job_id: f.job_id,
    })),
  ];

  const select = 'rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent';

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col sm:h-[calc(100dvh-10.25rem)]">
      {/* what the numbers say, and whether this is working at all */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line bg-panel px-3 py-2 text-xs">
        <span><b className="tabular-nums">{sentThisWeek}</b> sent this week</span>
        <span className="text-muted">|</span>
        <span>Accept rate <b className="tabular-nums">{pct(m?.accept_rate ?? null)}</b></span>
        <span>Reply rate <b className="tabular-nums">{pct(m?.reply_rate ?? null)}</b>
          <span className="text-muted"> of {m?.sent ?? 0} sent</span></span>
        {m?.interview_rate && (
          <span className="text-muted">
            Interviews: {pct(m.interview_rate.with_outreach.rate)} with outreach (n={m.interview_rate.with_outreach.applied}),
            {' '}{pct(m.interview_rate.without_outreach.rate)} without (n={m.interview_rate.without_outreach.applied})
          </span>
        )}
        <span className="ml-auto text-muted">Nothing here sends: you send, then record it.</span>
      </div>
      {m?.warning && (
        <p className="mb-3 shrink-0 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {m.warning_text}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        <section className="mb-4">
          <h2 className="mb-1.5 text-sm font-semibold">Due today</h2>
          {due.isLoading ? <Empty>Loading…</Empty> : queue.length === 0 ? (
            <p className="rounded-lg border border-line px-3 py-2 text-xs text-muted">
              Nothing owed today. {due.data?.swept.length ? `${due.data.swept.length} nudge(s) timed out and were marked No reply.` : ''}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {queue.map((q) => (
                <li key={q.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs">
                  <span className={`rounded border px-1.5 py-px font-medium ${q.kind === 'Outreach'
                    ? 'border-accent/40 text-accent' : 'border-line text-muted'}`}>{q.kind}</span>
                  <span className="font-medium">{q.title}</span>
                  <span className="rounded bg-line px-1.5 py-px text-[11px]">{q.reason}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{q.detail}</span>
                  {q.job_id && (
                    <button type="button" onClick={() => nav.openJob(q.job_id!)}
                      className="shrink-0 text-muted underline underline-offset-2 hover:text-fg">open role</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">All touches</h2>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Status">
              <option value="">Any status</option>
              {['Drafted', 'Sent', 'Accepted', 'Replied', 'Meeting', 'No reply', 'Closed'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company"
              className={`${select} w-40`} aria-label="Company" />
            <span className="text-xs text-muted">{rows.length} of {touches.data?.length ?? 0}</span>
          </div>

          {touches.isLoading ? <Empty>Loading…</Empty> : rows.length === 0 ? (
            <Empty>No touches logged yet. Draft one with Claude, send it yourself, then log it here.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((t) => (
                <li key={t.id} className="rounded-lg border border-line bg-panel px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded border px-1.5 py-px font-medium ${TONE[t.status] ?? 'border-line'}`}>{t.status}</span>
                    <span className="font-medium text-sm">{t.contact_name}</span>
                    <span className="text-muted">{t.contact_role ? `${t.contact_role}, ` : ''}{t.company}</span>
                    <span className="rounded bg-line px-1.5 py-px text-[11px]">{t.touch_kind.replace(/_/g, ' ')}</span>
                    <span className="text-muted">{t.channel}</span>
                    {t.job_title && (
                      <button type="button" onClick={() => t.job_id && nav.openJob(t.job_id)}
                        className="truncate text-muted underline underline-offset-2 hover:text-fg">{t.job_title}</button>
                    )}
                    <span className="ml-auto text-muted">
                      {t.sent_at ? `sent ${shortDate(t.sent_at)}` : `drafted ${shortDate(t.drafted_at)}`}
                      {t.follow_up_due && t.status === 'Sent' ? ` · follow up ${t.follow_up_due}` : ''}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button type="button" className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(t.body); setCopied(t.id); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
                      }}>{copied === t.id ? 'Copied' : 'Copy message'}</button>
                    {t.contact_url && (
                      <a href={t.contact_url} target="_blank" rel="noreferrer"
                        className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent">Open contact</a>
                    )}
                    {ACTIONS.filter((a) => a.from.includes(t.status)).map((a) => (
                      <button key={a.status} type="button" disabled={move.isPending}
                        onClick={() => move.mutate({ id: t.id, status: a.status })}
                        className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent disabled:opacity-50">
                        {a.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)}
                      className="text-xs text-muted underline underline-offset-2 hover:text-fg">
                      {open === t.id ? 'hide message' : 'show message'}
                    </button>
                  </div>

                  {error?.id === t.id && (
                    <p className="mt-1.5 rounded-md border border-risk/40 bg-risk/10 px-2 py-1 text-xs text-risk">{error.message}</p>
                  )}
                  {open === t.id && (
                    <div className="mt-1.5 space-y-1 text-xs">
                      {t.hook && <p className="text-muted">Hook ({t.hook_type ?? 'unset'}): {t.hook}</p>}
                      <pre className="whitespace-pre-wrap rounded-md border border-line bg-bg p-2 leading-relaxed">{t.body}</pre>
                      {t.notes && <p className="text-muted">{t.notes}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** The thread for one role, oldest first, with a nudge or backup shown under its parent. */
export function OutreachThread({ touches }: { touches: OutreachRow[] }) {
  if (!touches.length) return <p className="text-xs text-muted">No outreach logged for this role.</p>;
  const ordered = [...touches].sort((a, b) => a.drafted_at.localeCompare(b.drafted_at));
  return (
    <ul className="space-y-1.5">
      {ordered.map((t) => (
        <li key={t.id} className={`rounded-lg border border-line px-2.5 py-2 text-xs ${t.parent_id ? 'ml-4' : ''}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-px font-medium ${TONE[t.status] ?? 'border-line'}`}>{t.status}</span>
            <span className="font-medium">{t.contact_name}</span>
            {t.contact_role && <span className="text-muted">{t.contact_role}</span>}
            <span className="rounded bg-line px-1.5 py-px text-[11px]">{t.touch_kind.replace(/_/g, ' ')}</span>
            <span className="ml-auto text-muted">
              {t.sent_at ? `sent ${shortDate(t.sent_at)}` : `drafted ${shortDate(t.drafted_at)}`}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-muted">{t.body}</p>
        </li>
      ))}
    </ul>
  );
}
