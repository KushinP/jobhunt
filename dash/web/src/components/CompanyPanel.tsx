import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CompanyProfile, type Job, type Priority } from '../api.ts';
import { ScoreBadge, TRASH_STATUSES, shortDate, statusLabel } from './bits.tsx';
import { useNav } from './nav.tsx';

const ORDER = ['Generate', 'New', 'Complete', 'Applied', 'Interviewing', 'Offer', 'Rejected'];

/** Every role ever seen at one company, grouped by where it stands. Trashed roles are kept
 * behind a toggle: they are the record of what this company posts that does not fit. */
export function CompanyPanel({ name, covered, onClose }: {
  name: string; covered: boolean; onClose: () => void;
}) {
  const nav = useNav();
  const [showTrash, setShowTrash] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['company', name], queryFn: () => api.company(name) });

  useEffect(() => {
    // the role drawer on top handles Escape first
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !covered) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, covered]);

  const roles = data?.roles ?? [];
  const trashed = roles.filter((r) => (TRASH_STATUSES as readonly string[]).includes(r.status));
  const groups = ORDER.map((s) => ({ status: s, items: roles.filter((r) => r.status === s) }))
    .filter((g) => g.items.length > 0);
  const active = roles.length - trashed.length - roles.filter((r) => r.status === 'Rejected').length;

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-10 bg-black/25" />
      <aside className="fixed inset-y-0 right-0 z-20 w-full max-w-xl overflow-y-auto border-l border-line bg-bg p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted">Company</p>
            <h2 className="text-lg font-semibold leading-tight">{name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>

        {isLoading || !data ? <p className="mt-4 text-sm text-muted">Loading…</p> : (
          <>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span><strong className="tabular-nums">{active}</strong> <span className="text-muted">active</span></span>
              <span><strong className="tabular-nums">{roles.filter((r) => r.status === 'Generate').length}</strong> <span className="text-muted">queued</span></span>
              <span><strong className="tabular-nums">{roles.filter((r) => ['Applied', 'Interviewing', 'Offer', 'Rejected'].includes(r.status)).length}</strong> <span className="text-muted">applied</span></span>
              <span><strong className="tabular-nums">{trashed.length}</strong> <span className="text-muted">trashed</span></span>
            </div>

            <ProfileEditor name={name} profile={data.profile} />

            <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${data.watched
              ? 'border-good/40 bg-good/10' : 'border-line text-muted'}`}>
              {data.watched
                ? <>Its own job board is watched ({data.watched.ats}: <code>{data.watched.slug}</code>), so new postings arrive daily without an aggregator.</>
                : <>Its job board is not watched. If this company matters, ask Claude to find its Greenhouse, Lever or Ashby board and add it to <code>target_boards</code>.</>}
            </p>

            {groups.map((g) => (
              <RoleGroup key={g.status} title={statusLabel(g.status)} items={g.items} onOpen={nav.openJob} />
            ))}

            {trashed.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <button type="button" onClick={() => setShowTrash((v) => !v)}
                  className="text-xs font-semibold uppercase tracking-wide text-muted hover:text-fg">
                  {showTrash ? '▾' : '▸'} Trashed ({trashed.length})
                </button>
                {showTrash && <RoleList items={trashed} onOpen={nav.openJob} showReason />}
              </div>
            )}
            {roles.length === 0 && <p className="mt-4 text-sm text-muted">No roles recorded here.</p>}
          </>
        )}
      </aside>
    </>
  );
}

function RoleGroup({ title, items, onOpen }: { title: string; items: Job[]; onOpen: (id: string) => void }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title} ({items.length})</h3>
      <RoleList items={items} onOpen={onOpen} />
    </section>
  );
}

function RoleList({ items, onOpen, showReason }: { items: Job[]; onOpen: (id: string) => void; showReason?: boolean }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)}
            className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-panel">
            <span className="min-w-0">
              <span className="block text-sm leading-snug">{r.title}</span>
              <span className="block truncate text-xs text-muted">
                {[r.location, shortDate(r.created_at), r.source, showReason ? r.drop_reason : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            <ScoreBadge score={r.score} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Industry, stage and whether you target or avoid the company. What you set here is yours:
 * Claude fills in companies you have not touched, and never overwrites your choices. */
function ProfileEditor({ name, profile }: { name: string; profile: CompanyProfile | null }) {
  const qc = useQueryClient();
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [tags, setTags] = useState((profile?.tags ?? []).join(', '));
  useEffect(() => { setNotes(profile?.notes ?? ''); setTags((profile?.tags ?? []).join(', ')); }, [profile]);

  const save = useMutation({
    mutationFn: (patch: Partial<Omit<CompanyProfile, 'name' | 'categorized_by'>>) => api.saveCompany(name, patch),
    onSuccess: () => {
      for (const k of ['company', 'companies', 'jobs']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });

  const priority = profile?.priority ?? 'neutral';
  const select = 'min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent';
  const by = profile?.categorized_by === 'claude' ? 'Filled in by Claude from the job descriptions; change anything.'
    : profile?.categorized_by === 'you' ? 'Set by you. Claude will not change it.' : 'Not categorized yet.';

  return (
    <section className="mt-4 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
          {(['target', 'neutral', 'avoid'] as Priority[]).map((pr) => (
            <button key={pr} type="button" disabled={save.isPending} onClick={() => save.mutate({ priority: pr })}
              className={`rounded-md px-2.5 py-1 capitalize ${priority === pr
                ? pr === 'target' ? 'bg-warn/15 font-semibold text-warn' : pr === 'avoid' ? 'bg-risk/10 font-semibold text-risk' : 'bg-panel font-semibold'
                : 'text-muted hover:text-fg'}`}>
              {pr === 'target' ? '★ Target' : pr}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted">
          {priority === 'avoid' ? 'Its roles are hidden in Roles unless you untick "Hide companies you avoid".'
            : priority === 'target' ? 'Shown with a star, and filterable with "Target companies only".' : ''}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <select className={select} aria-label="Industry" value={profile?.industry ?? ''}
          onChange={(e) => save.mutate({ industry: e.target.value || null })}>
          <option value="">Industry…</option>
          {(boot.data?.industries ?? []).map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <select className={select} aria-label="Stage" value={profile?.stage ?? ''}
          onChange={(e) => save.mutate({ stage: e.target.value || null })}>
          <option value="">Stage…</option>
          {(boot.data?.stages ?? []).map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>
      <input value={tags} onChange={(e) => setTags(e.target.value)}
        onBlur={() => {
          const next = tags.split(',').map((t) => t.trim()).filter(Boolean);
          if (next.join('|') !== (profile?.tags ?? []).join('|')) save.mutate({ tags: next });
        }}
        placeholder="Tags, comma separated (e.g. YC W24, AI-native, NYC HQ)"
        className="mt-2 w-full rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
        onBlur={() => { if (notes !== (profile?.notes ?? '')) save.mutate({ notes: notes || null }); }}
        placeholder="Notes: people you know there, what you have heard, why it is a target"
        className="mt-2 w-full rounded-md border border-line bg-panel px-2 py-1 text-xs outline-none focus:border-accent" />
      <p className="mt-1 text-[11px] text-muted">{save.isPending ? 'Saving…' : save.isError ? `Not saved: ${(save.error as Error).message}` : by}</p>
    </section>
  );
}
