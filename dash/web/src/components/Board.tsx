import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Job } from '../api.ts';
import { Closes, ScoreBadge, age, Empty } from './bits.tsx';
import { CompanyLink } from './nav.tsx';
import { Stars } from './Stars.tsx';
import { BOARD_PRESETS, type Sort, presetFor, sortJobs, usePersisted } from './sort.ts';

const COLUMNS: { key: string; label: string; hint: string }[] = [
  { key: 'New', label: 'New', hint: 'Matches a target role but not queued: below the auto bar, too senior, or waiting for a JD. Your call.' },
  { key: 'Generate', label: 'Queued', hint: 'In build order: your stars first, then score. Drop a role here to have its documents built.' },
  { key: 'Complete', label: 'Ready', hint: 'Documents built. Read, then submit.' },
  { key: 'Applied', label: 'Applied', hint: 'Submitted, waiting.' },
  { key: 'Interviewing', label: 'Interviewing', hint: 'In process.' },
];

/** A move waiting for the person to confirm: marking applied records what went out. */
interface Pending { job: Job; to: string }

export function Board({ onOpen, search }: { onOpen: (id: string) => void; search: string }) {
  const qc = useQueryClient();
  // Only the statuses the board shows, so it never needs a cap however much gets trashed.
  const { data, isLoading, error } = useQuery({
    queryKey: ['jobs', 'board', search],
    queryFn: () => api.jobs({ status: COLUMNS.map((c) => c.key), q: search || undefined }),
  });
  const [prefs, setPrefs] = usePersisted<{ sort: Sort }>('jobhunt.board.v1', { sort: { key: 'score', desc: true } });
  const [dragging, setDragging] = useState<Job | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Where a card was dropped, shown straight away and dropped again once the server answers.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === 'err' ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [notice]);

  if (isLoading) return <Empty>Loading…</Empty>;
  if (error) return <Empty>Could not load the pipeline: {String(error)}</Empty>;

  const jobs = (data?.rows ?? []).map((j) => (moved[j.id] ? { ...j, status: moved[j.id] } : j));
  // Queued always shows the order the build run takes them in, so the top card is the next built.
  const byStatus = (s: string) => sortJobs(jobs.filter((j) => j.status === s),
    s === 'Generate' ? { key: 'build', desc: false } : prefs.sort);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['jobs'] }),
      qc.invalidateQueries({ queryKey: ['bootstrap'] }),
      qc.invalidateQueries({ queryKey: ['companies'] }),
      qc.invalidateQueries({ queryKey: ['trash'] }),
    ]);
  };

  const move = async (job: Job, to: string) => {
    setMoved((m) => ({ ...m, [job.id]: to }));
    try {
      if (to === 'Applied') await api.apply(job.id, job.url ?? undefined);
      else await api.setStatus(job.id, to, 'Moved on the board');
      await refresh();
      setNotice({ tone: 'ok', text: to === 'Skip'
        ? `Skipped ${job.title}. It is in Trash if you want it back.`
        : `${job.title} moved to ${COLUMNS.find((c) => c.key === to)?.label ?? to}.` });
    } catch (e) {
      setNotice({ tone: 'err', text: `Could not move ${job.title}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setMoved((m) => { const rest = { ...m }; delete rest[job.id]; return rest; });
    }
  };

  const drop = (to: string) => {
    const job = dragging;
    setDragging(null);
    setOver(null);
    if (!job || job.status === to) return;
    if (to === 'Applied') setConfirm({ job, to });
    else void move(job, to);
  };

  const target = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || dragging.status === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(key); },
  });

  const select = 'rounded-md border border-line bg-panel px-2 py-1 text-xs font-medium outline-none focus:border-accent';

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col sm:h-[calc(100dvh-10.25rem)]">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          <span className="pointer-coarse:hidden">Drag a card to another column to move it.</span>
          <span className="hidden pointer-coarse:inline">Open a role to move it.</span>
        </span>
        <label className="flex items-center gap-1.5">
          Sort the other columns
          <select value={presetFor(prefs.sort) || 'best'} className={select} aria-label="Sort cards"
            onChange={(e) => {
              const p = BOARD_PRESETS.find((x) => x.key === e.target.value);
              if (p) setPrefs({ sort: p.sort });
            }}>
            {BOARD_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {/* A kanban board: columns sit side by side and each scrolls on its own. An empty column
          shrinks to a narrow rail so the columns with work in them get the width, except while
          a card is being dragged, when every column opens up as a place to drop it. */}
      <div className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:snap-none">
        {COLUMNS.map((col) => {
          const items = byStatus(col.key);
          const empty = items.length === 0;
          const droppable = dragging && dragging.status !== col.key;
          return (
            <section key={col.key} {...target(col.key)}
              className={`flex shrink-0 snap-start flex-col rounded-xl border bg-bg/40 transition-colors
                ${over === col.key ? 'border-accent bg-accent/5' : droppable ? 'border-dashed border-accent/50' : 'border-line'}
                ${empty && !dragging
                  ? 'w-36'
                  : 'w-[85vw] max-w-[340px] sm:w-[250px] lg:w-auto lg:min-w-[210px] lg:max-w-none lg:flex-1'}`}>
              <header className="border-b border-line px-3 pb-2 pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{col.label}</h2>
                  <span className="text-xs tabular-nums text-muted">{items.length}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{col.hint}</p>
              </header>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2">
                {items.map((job) => (
                  <Card key={job.id} job={job} onOpen={onOpen} saving={job.id in moved}
                    dragging={dragging?.id === job.id}
                    // after the browser has taken its drag image: re-rendering during
                    // dragstart can cancel the drag in Chrome
                    onDragStart={() => setTimeout(() => setDragging(job), 0)}
                    onDragEnd={() => { setDragging(null); setOver(null); }} />
                ))}
                {empty && (
                  <p className="px-1 py-2 text-xs text-muted">{droppable ? 'Drop here' : 'Nothing here'}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {dragging && (
        <div {...target('Skip')}
          className={`fixed inset-x-4 bottom-4 z-30 mx-auto max-w-md rounded-xl border-2 border-dashed px-4 py-3
            text-center text-sm shadow-lg transition-colors
            ${over === 'Skip' ? 'border-risk bg-risk/15 text-risk' : 'border-line bg-panel text-muted'}`}>
          Drop here to skip this role. It goes to Trash, where it can be restored.
        </div>
      )}

      {confirm && (
        <ConfirmApplied pending={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const c = confirm; setConfirm(null); void move(c.job, c.to); }} />
      )}

      {notice && (
        <div role="status"
          className={`fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-lg items-start gap-3 rounded-xl border px-4 py-2.5
            text-sm shadow-lg ${notice.tone === 'err' ? 'border-risk/40 bg-panel text-risk' : 'border-line bg-panel'}`}>
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-muted hover:text-fg" aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}

/** Marking applied is the one move that records something: which documents went out. It is
 * asked for, not assumed, because a stray drop should not start a follow-up clock. */
function ConfirmApplied({ pending, onCancel, onConfirm }: {
  pending: Pending; onCancel: () => void; onConfirm: () => void;
}) {
  const { job } = pending;
  const docs = job.resume_count + job.cl_count;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <>
      <button type="button" aria-label="Cancel" onClick={onCancel} className="fixed inset-0 z-40 bg-black/30" />
      <div role="alertdialog" aria-labelledby="confirm-applied"
        className="fixed left-1/2 top-1/3 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-line bg-bg p-5 shadow-2xl">
        <h2 id="confirm-applied" className="text-base font-semibold">Mark as applied?</h2>
        <p className="mt-1 text-sm">
          <strong>{job.title}</strong> at {job.company}
        </p>
        <p className="mt-2 text-sm text-muted">
          {docs > 0
            ? 'This records which resume and cover letter went out, so interview prep reads what the employer has, and starts the follow-up clock.'
            : 'No documents were built for this role, so none will be recorded. It still starts the follow-up clock.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">Cancel</button>
          <button type="button" onClick={onConfirm} autoFocus
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white">I applied</button>
        </div>
      </div>
    </>
  );
}

function Card({ job, onOpen, saving, dragging, onDragStart, onDragEnd }: {
  job: Job; onOpen: (id: string) => void; saving: boolean; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(job.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(job.id); } }}
      className={`cursor-pointer rounded-lg border border-line bg-panel px-2.5 py-2 text-left transition
                 hover:border-accent focus:border-accent focus:outline-none active:cursor-grabbing
                 ${dragging ? 'opacity-40' : ''} ${saving ? 'animate-pulse' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 min-w-0 text-[13px] font-medium leading-snug">{job.title}</span>
        <ScoreBadge score={job.score} />
      </div>
      <p className="mt-0.5 flex min-w-0 items-baseline gap-1 text-xs text-muted">
        <CompanyLink name={job.company} className="shrink-0" />
        {job.location && <span className="truncate">· {job.location}</span>}
      </p>
      {(job.salary || job.closes_at) && (
        <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted">
          {job.salary && <span className="truncate tabular-nums">{job.salary}</span>}
          {job.closes_at && (
            <span className="shrink-0">
              {job.salary ? '· ' : ''}{job.closes_source === 'listing' ? '' : 'closes '}
              <Closes at={job.closes_at} source={job.closes_source} />
            </span>
          )}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Stars id={job.id} rating={job.rating} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {job.resume_count > 0 && (
            <span className="rounded bg-line px-1 py-px font-medium text-fg">
              {job.resume_count + job.cl_count} docs
            </span>
          )}
          {job.followups_due > 0 && (
            <span className="rounded bg-warn/15 px-1 py-px font-medium text-warn">follow up</span>
          )}
          <span className="truncate">{job.source} · {age(job.created_at)}</span>
        </span>
      </div>
    </div>
  );
}
