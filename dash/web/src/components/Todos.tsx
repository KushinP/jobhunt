import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, TODO_KINDS, type TodoItem, type TodoItemKind } from '../api.ts';
import { Empty, dayDate } from './bits.tsx';
import { useNav } from './nav.tsx';

const LABEL: Record<TodoItemKind, { text: string; tone: string }> = {
  task: { text: 'To-do', tone: 'border-accent/40 text-accent' },
  interview: { text: 'Interview', tone: 'border-good/50 text-good' },
  debrief: { text: 'Debrief', tone: 'border-good/40 text-good' },
  follow_up: { text: 'Follow-up', tone: 'border-warn/40 text-warn' },
  outreach: { text: 'Outreach', tone: 'border-accent/40 text-accent' },
  send_draft: { text: 'Send', tone: 'border-accent/40 text-accent' },
  closing: { text: 'Closing', tone: 'border-risk/40 text-risk' },
  ready: { text: 'Submit', tone: 'border-line text-fg' },
};

/** The chips along the top: each shows a few kinds of item. */
const GROUPS: { key: string; label: string; kinds?: TodoItemKind[] }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'mine', label: 'My to-dos', kinds: ['task'] },
  { key: 'interviews', label: 'Interviews', kinds: ['interview', 'debrief'] },
  { key: 'follow', label: 'Follow-ups', kinds: ['follow_up'] },
  { key: 'outreach', label: 'Outreach', kinds: ['outreach', 'send_draft'] },
  { key: 'apply', label: 'Applications', kinds: ['closing', 'ready'] },
];

/** How many ready-to-submit roles Everything shows before "show all". */
const READY_CAP = 5;

const timeOf = (iso: string) => new Date(iso).toLocaleString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

/**
 * What you owe, in one list: your own to-dos (a HireVue and its deadline), interviews to prep
 * and debrief, applications to chase, outreach to send, and roles to submit before they close.
 * Only your own to-dos are written here; everything else comes from the page it belongs to and
 * clears itself when that work is recorded.
 */
export function Todos({ onTab }: { onTab: (tab: 'outreach') => void }) {
  const qc = useQueryClient();
  const [group, setGroup] = useState('all');
  const [adding, setAdding] = useState(false);
  const [allReady, setAllReady] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['todos'], queryFn: api.todos, staleTime: 60_000 });

  const refresh = () => {
    for (const k of ['todos', 'followups', 'bootstrap', 'jobs']) void qc.invalidateQueries({ queryKey: [k] });
  };

  if (isLoading) return <Empty>Loading…</Empty>;
  if (error || !data) return <Empty>Could not load the list: {String(error)}</Empty>;

  const kinds = GROUPS.find((g) => g.key === group)?.kinds;
  // Built roles waiting to submit can run to dozens; in Everything they are capped so they do
  // not bury the drafts and to-dos beside them. Applications shows them all.
  const readyTotal = data.anytime.filter((x) => x.kind === 'ready').length;
  const capReady = group === 'all' && !allReady && readyTotal > READY_CAP;
  const keep = (xs: TodoItem[]) => {
    let out = kinds ? xs.filter((x) => kinds.includes(x.kind)) : xs;
    if (capReady) {
      let n = 0;
      out = out.filter((x) => x.kind !== 'ready' || n++ < READY_CAP);
    }
    return out;
  };
  const sections = [
    { key: 'overdue', title: 'Overdue', items: keep(data.overdue), tone: 'text-risk' },
    { key: 'today', title: 'Today', items: keep(data.today_items), tone: '' },
    { key: 'upcoming', title: 'Next two weeks', items: keep(data.upcoming), tone: '' },
    { key: 'anytime', title: 'When you can', items: keep(data.anytime), tone: 'text-muted' },
  ];
  const all = [...data.overdue, ...data.today_items, ...data.upcoming, ...data.anytime];
  const count = (g: (typeof GROUPS)[number]) => (g.kinds ? all.filter((x) => g.kinds!.includes(x.kind)) : all).length;
  const shown = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="app-pane">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1">
        {GROUPS.map((g) => (
          <button key={g.key} type="button" onClick={() => setGroup(g.key)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${group === g.key
              ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}>
            {g.label} <span className="tabular-nums opacity-70">{count(g)}</span>
          </button>
        ))}
        <button type="button" onClick={() => setAdding((v) => !v)}
          className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white">
          {adding ? 'Cancel' : 'Add a to-do'}
        </button>
      </div>

      {adding && <AddTodo onDone={() => { setAdding(false); refresh(); }} />}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        {shown === 0 && (
          <Empty>
            {group === 'all'
              ? 'Nothing owed. Add a HireVue or assessment here, or ask Claude to, when one arrives.'
              : 'Nothing of this kind right now.'}
          </Empty>
        )}
        {sections.filter((s) => s.items.length).map((s) => (
          <section key={s.key} className="mb-4">
            <h2 className={`mb-1.5 text-sm font-semibold ${s.tone}`}>
              {s.title} <span className="font-normal tabular-nums text-muted">{s.items.length}</span>
            </h2>
            <ul className="space-y-1.5">
              {s.items.map((item) => (
                <Row key={item.key} item={item} today={data.today} onChanged={refresh} onTab={onTab} />
              ))}
            </ul>
            {s.key === 'anytime' && capReady && (
              <button type="button" onClick={() => setAllReady(true)}
                className="mt-1.5 rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">
                Show all {readyTotal} roles ready to submit
              </button>
            )}
          </section>
        ))}
        {data.swept_outreach.length > 0 && (
          <p className="text-xs text-muted">
            {data.swept_outreach.length} outreach nudge(s) timed out and were marked No reply.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ item, today, onChanged, onTab }: {
  item: TodoItem; today: string; onChanged: () => void; onTab: (tab: 'outreach') => void;
}) {
  const nav = useNav();
  const [err, setErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setErr(null); onChanged(); },
    onError: (e: Error) => setErr(e.message),
  });
  const label = LABEL[item.kind];
  const btn = 'shrink-0 rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent disabled:opacity-50';
  const when = item.at ? timeOf(item.at)
    : item.due ? (item.due === today ? 'today' : `${item.due < today ? 'was due' : 'due'} ${dayDate(item.due)}`) : '';

  return (
    <li className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded border px-1.5 py-px text-[11px] font-medium ${label.tone}`}>{label.text}</span>
        <span className="min-w-0 text-sm font-medium">{item.title}</span>
        {item.task?.created_by === 'claude' && <span className="text-[11px] text-muted">added by Claude</span>}
        {when && (
          <span className={`ml-auto shrink-0 text-xs ${item.due && item.due < today ? 'text-risk' : 'text-muted'}`}>{when}</span>
        )}
      </div>
      {item.detail && <p className="mt-0.5 text-xs text-muted">{item.detail}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {item.kind === 'task' && (
          <button type="button" className={btn} disabled={act.isPending}
            onClick={() => act.mutate(() => api.completeTodo(item.ref_id))}>Done</button>
        )}
        {item.kind === 'follow_up' && (
          <button type="button" className={btn} disabled={act.isPending} title="You followed up, or decided not to"
            onClick={() => act.mutate(() => api.completeFollowup(item.ref_id))}>Handled</button>
        )}
        {(item.kind === 'outreach' || item.kind === 'send_draft') && (
          <button type="button" className={btn} onClick={() => onTab('outreach')}>Go to Outreach</button>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className={btn}>
            {item.kind === 'task' ? 'Open link' : 'Posting'}
          </a>
        )}
        {item.job_id && (
          <button type="button" onClick={() => nav.openJob(item.job_id!)}
            className="text-xs text-muted underline underline-offset-2 hover:text-fg">open role</button>
        )}
        {item.kind === 'task' && (
          <button type="button" disabled={act.isPending}
            onClick={() => { if (confirm(`Delete "${item.title}"?`)) act.mutate(() => api.deleteTodo(item.ref_id)); }}
            className="ml-auto text-xs text-muted hover:text-risk">Delete</button>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-risk">{err}</p>}
    </li>
  );
}

/** A to-do JobHunt cannot work out itself: usually an assessment invite with a deadline. */
function AddTodo({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('assessment');
  const [due, setDue] = useState('');
  const [jobId, setJobId] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  // the roles a to-do is usually for: ones in flight
  const roles = useQuery({
    queryKey: ['jobs', 'todo-roles'],
    queryFn: () => api.jobs({ status: ['Interviewing', 'Applied', 'Complete', 'Generate', 'Offer'] }),
  });
  const save = useMutation({
    mutationFn: () => api.addTodo({
      title, kind, due_at: due || null, job_id: jobId || null, url: url || null, notes: notes || null,
    }),
    onSuccess: onDone,
  });
  const field = 'rounded-md border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent';
  const list = [...(roles.data?.rows ?? [])].sort((a, b) => a.company.localeCompare(b.company));

  return (
    <form className="mb-3 grid shrink-0 gap-2 rounded-xl border border-line bg-panel p-3 sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) save.mutate(); }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What to do, e.g. HireVue for Ramp"
        className={`${field} sm:col-span-2`} autoFocus aria-label="Title" />
      <select value={kind} onChange={(e) => setKind(e.target.value)} className={field} aria-label="Kind">
        {TODO_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-muted">
        Due
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={`${field} flex-1`} />
      </label>
      <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={field} aria-label="Role">
        <option value="">No particular role</option>
        {list.map((j) => <option key={j.id} value={j.id}>{j.company}: {j.title}</option>)}
      </select>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link to the invite (optional)"
        className={field} aria-label="Link" />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
        className={`${field} sm:col-span-2`} aria-label="Notes" />
      <div className="flex items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={!title.trim() || save.isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {save.isPending ? 'Saving…' : 'Add'}
        </button>
        {save.error && <span className="text-xs text-risk">{save.error.message}</span>}
      </div>
    </form>
  );
}
