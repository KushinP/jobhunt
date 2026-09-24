import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';

/**
 * Your own rating, 1-5. Clicking the star you already picked clears it, because an
 * accidental rating you cannot remove would quietly poison the calibration numbers.
 */
export function Stars({ id, rating, size = 'sm' }: {
  id: string; rating: number | null; size?: 'sm' | 'md';
}) {
  const qc = useQueryClient();
  const mutate = useMutation({
    mutationFn: (next: number | null) => api.setRating(id, next),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['job', id] });
      void qc.invalidateQueries({ queryKey: ['metrics'] });
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });

  const cls = size === 'md' ? 'text-lg' : 'text-[13px]';

  return (
    <span className={`inline-flex items-center gap-px ${cls}`} title="Your rating, 1 to 5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (rating ?? 0) >= n;
        return (
          <button
            key={n}
            type="button"
            aria-label={`Rate ${n} of 5`}
            disabled={mutate.isPending}
            onClick={(e) => {
              e.stopPropagation();
              mutate.mutate(rating === n ? null : n);
            }}
            className={`leading-none transition ${on ? 'text-warn' : 'text-line hover:text-muted'}`}
          >
            {on ? '★' : '☆'}
          </button>
        );
      })}
    </span>
  );
}
