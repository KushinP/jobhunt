import { daysUntil } from './sort.ts';

export const STATUSES = [
  'New', 'Generate', 'Complete', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Skip',
] as const;

/** What each stored status is called on screen. The pipeline stores "Generate" and
 * "Complete"; the board has always said Queued and Ready, and every screen now agrees. */
export const STATUS_LABEL: Record<string, string> = {
  New: 'New', Generate: 'Queued', Complete: 'Ready', Applied: 'Applied',
  Interviewing: 'Interviewing', Offer: 'Offer', Rejected: 'Rejected', Skip: 'Skipped',
  Discarded: 'Filtered out', 'Dead link': 'Posting gone', Unverified: 'Unverified',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

export const ACTIVE_STATUSES = ['New', 'Generate', 'Complete', 'Applied', 'Interviewing', 'Offer'] as const;
export const TRASH_STATUSES = ['Discarded', 'Skip', 'Dead link'] as const;

/** "Sep 18", or "Sep 18, 2025" outside the current year. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.replace(' ', 'T')}${iso.includes('Z') ? '' : 'Z'}`);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** A calendar day stored as YYYY-MM-DD ("Oct 2"), read as that day wherever the viewer is. */
export function dayDate(day: string | null | undefined): string {
  const m = day?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sameYear = Number(m[1]) === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** When applications close. A deadline the posting states is a date; a job board's own
 * listing expiry (LinkedIn sets 30 days after posting) is only a hint and reads as one. */
export function Closes({ at, source }: { at?: string | null; source?: string | null }) {
  if (!at) return <span className="text-muted">-</span>;
  const days = daysUntil(at);
  const label = dayDate(at);
  if (days < 0) {
    return <span className="text-muted line-through" title={source === 'listing' ? 'The listing has expired' : 'The deadline has passed'}>{label}</span>;
  }
  if (source === 'listing') {
    return (
      <span className="text-muted" title="When the job board's listing expires, not a deadline the employer stated">
        listing ends {label}
      </span>
    );
  }
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return (
    <span className={days <= 7 ? 'font-semibold text-warn' : ''}
      title={`Applications close ${when}${source === 'you' ? ' (you set this date)' : ''}`}>
      {label}{days <= 7 ? ` · ${days === 0 ? 'today' : `${days}d`}` : ''}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone = score >= 90 ? 'text-good border-good'
    : score >= 75 ? 'text-accent border-accent'
    : score >= 60 ? 'text-warn border-warn'
    : 'text-muted border-line';
  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}
      title="Match score out of 100"
    >
      {score}
    </span>
  );
}

export function Breakdown({ raw }: { raw: string | null }) {
  if (!raw) return null;
  let parsed: Record<string, number>;
  try { parsed = JSON.parse(raw) as Record<string, number>; } catch { return null; }
  const max: Record<string, number> = {
    title: 20, domain: 25, skill: 20, seniority: 20, location: 15,
  };
  const order = ['title', 'domain', 'skill', 'seniority', 'location'];
  return (
    <div className="space-y-1.5">
      {order.filter((k) => k in parsed).map((k) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-muted capitalize">{k}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round((parsed[k] / (max[k] ?? 20)) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right tabular-nums text-muted">
            {parsed[k]}/{max[k]}
          </span>
        </div>
      ))}
      {parsed.years_required != null && (
        <p className="pt-1 text-xs text-muted">
          JD asks for {parsed.years_required}+ years of experience
        </p>
      )}
    </div>
  );
}

export function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(`${iso.replace(' ', 'T')}Z`).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return '';
  return days <= 0 ? 'today' : days === 1 ? '1d' : `${days}d`;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-6 text-sm text-muted">{children}</p>;
}
