import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Run } from '../api.ts';
import { Empty } from './bits.tsx';

type Kind = 'search' | 'sweep' | 'build' | 'weekly' | 'other';

/** What each kind of run is called, and what its four counters mean for it: log_run has one
 * set of fields, and a sweep's "found" is roles reviewed, a build's "kept" is roles built. */
const KINDS: Record<Kind, {
  label: string; dot: string; stale: number;
  stats: [keyof Pick<Run, 'found' | 'kept' | 'duplicates' | 'dropped'>, string][];
}> = {
  search: { label: 'Daily search', dot: 'bg-accent', stale: 3, stats: [['found', 'found'], ['kept', 'new'], ['duplicates', 'already known'], ['dropped', 'filtered out']] },
  sweep: { label: 'Daily sweep', dot: 'bg-warn', stale: 3, stats: [['found', 'reviewed'], ['dropped', 'moved out'], ['kept', 'left alone']] },
  build: { label: 'Document build', dot: 'bg-good', stale: 3, stats: [['found', 'looked at'], ['kept', 'built'], ['dropped', 'turned away']] },
  weekly: { label: 'Weekly review', dot: 'bg-fg', stale: 8, stats: [] },
  other: { label: 'Other run', dot: 'bg-muted', stale: Infinity, stats: [['found', 'found'], ['kept', 'kept'], ['duplicates', 'duplicates'], ['dropped', 'dropped']] },
};

const SOURCE_NAME: Record<string, string> = {
  company_boards: 'Company boards', yc: 'YC', linkedin: 'LinkedIn', indeed: 'Indeed',
  ziprecruiter: 'ZipRecruiter', dice: 'Dice', builtin: 'Built In', linkedin_alerts: 'LinkedIn alerts',
  gmail_linkedin_alerts: 'LinkedIn alerts', linkedin_email: 'LinkedIn alerts', jd_pass: 'JD pass',
  jd_fetch: 'JD pass', gmail: 'Gmail', handshake: 'Handshake',
};

function kindOf(r: Run): Kind {
  if (r.kind === 'search') return 'search';
  if (r.kind === 'build_docs') return 'build';
  if (r.kind === 'weekly') return 'weekly';
  // the sweep logs as a manual run; its summary is how it is told apart
  if (/^daily sweep/i.test(r.summary ?? '')) return 'sweep';
  return 'other';
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw) as unknown; return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []; }
  catch { return []; }
}

/** "dice (Dice connector not available)" or "jd_pass (partial): 24 of 25..." -> name and reason. */
function splitSource(entry: string): { id: string; name: string; reason: string; partial: boolean } {
  const m = entry.match(/^([\w-]+)\s*[:(]?\s*([\s\S]*)$/);
  const id = (m?.[1] ?? entry).toLowerCase();
  const reason = (m?.[2] ?? '').replace(/^\(|\)$/g, '').replace(/^\s*[):]\s*/, '').trim();
  return { id, name: SOURCE_NAME[id] ?? id, reason, partial: /partial/i.test(entry) };
}

/** Run times are stored in UTC ("2026-09-21 14:54:39"). */
const when = (iso: string) => new Date(`${iso.replace(' ', 'T')}Z`);
const dayKey = (d: Date) => d.toLocaleDateString('en-CA');
function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const base = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (dayKey(d) === dayKey(today)) return `Today · ${base}`;
  if (dayKey(d) === dayKey(yesterday)) return `Yesterday · ${base}`;
  return base;
}
const timeOf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
function ago(d: Date): string {
  const h = (Date.now() - d.getTime()) / 3_600_000;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function health(r: Run, kind: Kind): { tone: 'ok' | 'warn' | 'bad'; label: string } {
  const errors = parseList(r.errors);
  const unavailable = parseList(r.sources_unavailable);
  if (/^(aborted|stopped|failed|blocked)/i.test(r.summary ?? '') || (kind === 'build' && r.kept === 0 && errors.length > 0)) {
    return { tone: 'bad', label: 'Stopped' };
  }
  if (unavailable.length || errors.length) {
    const n = unavailable.length + errors.length;
    return { tone: 'warn', label: `${n} ${n === 1 ? 'issue' : 'issues'}` };
  }
  return { tone: 'ok', label: 'Clean' };
}

const TONE = {
  ok: 'border-good/40 bg-good/10 text-good',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  bad: 'border-risk/40 bg-risk/10 text-risk',
};

/**
 * What the scheduled runs did, newest first and grouped by day: one line of counts in each
 * run's own terms, which sources worked, and the problems behind a click rather than in a wall
 * of text. The strip at the top answers the first question: is each task still running?
 */
export function Runs() {
  const { data, isLoading } = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const runs = useMemo(() => (data ?? []).map((r) => ({ r, kind: kindOf(r), at: when(r.started_at) })), [data]);

  if (isLoading) return <Empty>Loading…</Empty>;
  if (runs.length === 0) {
    return <Empty>No runs recorded yet. The scheduled tasks log here each time they run.</Empty>;
  }

  const shown = runs.filter((x) => filter === 'all' || x.kind === filter);
  const days: { key: string; label: string; items: typeof runs }[] = [];
  for (const x of shown) {
    const key = dayKey(x.at);
    if (days[days.length - 1]?.key !== key) days.push({ key, label: dayLabel(x.at), items: [] });
    days[days.length - 1].items.push(x);
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col sm:h-[calc(100dvh-10.25rem)]">
      <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        {(['search', 'sweep', 'build', 'weekly'] as const).map((k) => {
          const last = runs.find((x) => x.kind === k);
          const days = last ? (Date.now() - last.at.getTime()) / 86_400_000 : Infinity;
          const late = days > KINDS[k].stale;
          const h = last ? health(last.r, k) : null;
          return (
            <button key={k} type="button" onClick={() => setFilter(filter === k ? 'all' : k)}
              className={`rounded-lg border px-3 py-2 text-left transition hover:border-accent
                ${filter === k ? 'border-accent bg-accent/5' : 'border-line bg-panel'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <span className={`h-2 w-2 rounded-full ${KINDS[k].dot}`} />{KINDS[k].label}
              </span>
              <span className={`mt-0.5 block text-xs ${!last || late ? 'text-warn' : 'text-muted'}`}>
                {!last ? 'Has not run yet' : `Last ran ${ago(last.at)}${late ? ', overdue' : ''}`}
                {h && h.tone !== 'ok' && !late ? ` · ${h.label.toLowerCase()}` : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1">
        {(['all', 'search', 'sweep', 'build', 'weekly', 'other'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === k
              ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'}`}>
            {k === 'all' ? 'All runs' : KINDS[k].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">{shown.length} runs</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-line">
        {days.length === 0 && <Empty>No runs of this kind yet.</Empty>}
        {days.map((d) => (
          <section key={d.key}>
            <h3 className="sticky top-0 z-[1] border-b border-line bg-panel px-3 py-1.5 text-xs font-semibold text-muted">{d.label}</h3>
            <ul className="divide-y divide-line">
              {d.items.map((x) => <RunRow key={x.r.id} run={x.r} kind={x.kind} at={x.at} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function RunRow({ run, kind, at }: { run: Run; kind: Kind; at: Date }) {
  const [open, setOpen] = useState(false);
  const def = KINDS[kind];
  const errors = parseList(run.errors);
  const unavailable = parseList(run.sources_unavailable).map(splitSource);
  const used = [...new Set(parseList(run.sources_used).map((s) => splitSource(s).id))];
  const h = health(run, kind);
  // one chip per source: worked, worked in part, or did not run
  const chips = new Map<string, { name: string; tone: 'ok' | 'warn' | 'bad' }>();
  for (const id of used) chips.set(SOURCE_NAME[id] ?? id, { name: SOURCE_NAME[id] ?? id, tone: 'ok' });
  for (const u of unavailable) {
    const wasUsed = chips.has(u.name);
    chips.set(u.name, { name: u.name, tone: u.partial || wasUsed ? 'warn' : 'bad' });
  }
  const stats = def.stats.filter(([k], i) => i === 0 || run[k] > 0);
  const hasDetail = errors.length > 0 || unavailable.length > 0 || (run.summary ?? '').length > 160;

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`h-2 w-2 shrink-0 rounded-full ${def.dot}`} />
        <span className="text-sm font-semibold">{def.label}</span>
        <span className="text-xs text-muted">{timeOf(at)}</span>
        <span className={`rounded-full border px-2 py-px text-[11px] font-medium ${TONE[h.tone]}`}>{h.label}</span>
        {stats.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-x-3 text-xs text-muted">
            {stats.map(([k, label]) => (
              <span key={k}><b className="font-semibold tabular-nums text-fg">{run[k].toLocaleString()}</b> {label}</span>
            ))}
          </span>
        )}
      </div>
      {chips.size > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {[...chips.values()].map((c) => (
            <span key={c.name} title={c.tone === 'ok' ? 'Worked' : c.tone === 'warn' ? 'Worked in part' : 'Did not run'}
              className={`rounded border px-1.5 py-px text-[11px] ${c.tone === 'ok' ? 'border-line text-muted' : TONE[c.tone]}`}>
              {c.tone === 'bad' ? '✕ ' : c.tone === 'warn' ? '! ' : ''}{c.name}
            </span>
          ))}
        </div>
      )}
      {run.summary && (
        <p className={`mt-1.5 text-xs leading-relaxed ${open ? '' : 'line-clamp-2'}`}>{run.summary}</p>
      )}
      {open && (unavailable.length > 0 || errors.length > 0) && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-bg p-2.5 text-xs">
          {unavailable.length > 0 && (
            <div>
              <p className="font-semibold text-warn">Sources that did not fully run</p>
              <ul className="mt-0.5 space-y-0.5">
                {unavailable.map((u, i) => (
                  <li key={i}><b className="font-medium">{u.name}</b>{u.reason ? `: ${u.reason}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          {errors.length > 0 && (
            <div>
              <p className="font-semibold text-risk">Errors</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {errors.map((e, i) => <li key={i} className="break-words">{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      {hasDetail && (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="mt-1 text-xs text-accent underline-offset-2 hover:underline">
          {open ? 'Show less' : errors.length || unavailable.length
            ? `Show details (${[unavailable.length && `${unavailable.length} source${unavailable.length === 1 ? '' : 's'}`, errors.length && `${errors.length} error${errors.length === 1 ? '' : 's'}`].filter(Boolean).join(', ')})`
            : 'Show more'}
        </button>
      )}
    </li>
  );
}
