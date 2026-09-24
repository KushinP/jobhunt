import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Empty } from './bits.tsx';

export function FollowUps() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['followups'], queryFn: api.followups });
  const done = useMutation({
    mutationFn: api.completeFollowup,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['followups'] });
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });

  if (isLoading) return <Empty>Loading…</Empty>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <Empty>Nothing to chase. Follow-ups appear once an application has sat quiet.</Empty>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((f) => (
        <li
          key={f.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border
                     border-line bg-panel p-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{f.title}</p>
            <p className="text-xs text-muted">
              {f.company} · applied {f.applied_at?.slice(0, 10) ?? 'unknown'} · due {f.due_at}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(f.portal_url ?? f.url) && (
              <a
                href={(f.portal_url ?? f.url)!}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent underline underline-offset-2"
              >
                posting
              </a>
            )}
            <button
              type="button"
              onClick={() => done.mutate(f.id)}
              className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent"
            >
              Handled
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
