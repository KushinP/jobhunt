import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setupApi, type SetupData } from '../api.ts';
import { Empty } from './bits.tsx';
import { BaseResumes } from './setup/BaseResumes.tsx';
import { Goals } from './setup/Goals.tsx';
import { IdealRoles } from './setup/IdealRoles.tsx';
import { Answers } from './setup/Answers.tsx';
import { Preferences } from './setup/Preferences.tsx';
import { ConnectGuide } from './setup/ConnectGuide.tsx';

export function Setup() {
  const { data, isLoading } = useQuery({ queryKey: ['setup'], queryFn: setupApi.get });
  if (isLoading || !data) return <Empty>Loading…</Empty>;

  return (
    <div className="space-y-6">
      <Checklist data={data} />
      <ConnectGuide />
      <BaseResumes data={data} />
      <Preferences />
      <IdealRoles data={data} />
      <Goals data={data} />
      <Plan plan={data.plan} />
      <Answers data={data} />
    </div>
  );
}

export function Panel({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-0.5 mb-3 text-xs text-muted">{note}</p>}
      {children}
    </section>
  );
}

function Checklist({ data }: { data: SetupData }) {
  const qc = useQueryClient();
  const confirm = useMutation({
    mutationFn: ({ key, done }: { key: string; done: boolean }) => setupApi.confirmStep(key, done),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['setup'] });
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });
  const { onboarding } = data;
  const pct = Math.round((onboarding.done / onboarding.total) * 100);
  return (
    <Panel
      title={onboarding.complete ? 'Setup complete' : `Setup: ${onboarding.done} of ${onboarding.total}`}
      note={onboarding.complete
        ? 'Everything the pipeline needs is in place.'
        : 'Each item below blocks something concrete. Claude can also work through these with you: ask it to check onboarding status.'}
    >
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {onboarding.next && (
        <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          <strong>Next: {onboarding.next.what}.</strong>{' '}
          {['connectors', 'claude_skills', 'scheduled_runs'].includes(onboarding.next.key)
            ? 'The "Connect Claude" section below walks through it step by step.'
            : 'Easiest in a chat with the JobHunt connector: ask Claude to "continue my JobHunt setup".'}
        </p>
      )}
      <ul className="space-y-1.5">
        {onboarding.steps.map((s) => (
          <li key={s.key} className="flex gap-2 text-sm">
            <span className={s.done ? 'text-good' : 'text-muted'}>{s.done ? '✓' : '○'}</span>
            <span className="min-w-0 flex-1">
              <span className={s.done ? 'text-muted line-through' : ''}>{s.what}</span>
              {!s.done && <span className="block text-xs text-muted">{s.why}</span>}
            </span>
            {/* the server cannot see this one (skills live in the Claude account), so it is yours to tick */}
            {s.verified_by === 'confirmed' && (
              <button type="button" disabled={confirm.isPending}
                onClick={() => confirm.mutate({ key: s.key, done: !s.done })}
                className={`h-fit shrink-0 rounded-md border px-2 py-0.5 text-xs ${s.done
                  ? 'border-line text-muted hover:text-fg' : 'border-accent text-accent hover:bg-accent/10'}`}>
                {s.done ? 'Undo' : 'Mark done'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Plan({ plan }: { plan: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(plan);
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(plan), [plan]);

  const save = useMutation({
    mutationFn: () => setupApi.savePlan(text),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void qc.invalidateQueries({ queryKey: ['setup'] });
    },
  });

  return (
    <Panel
      title="The plan"
      note="Positioning per archetype, weekly cadence, and what you have decided not to chase. Claude reads this before writing documents or giving strategic advice, so it builds on what you already decided."
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={'## Positioning\n- AI implementation: founder who has actually deployed software into hotels\n\n## Cadence\n- 8 applications a week, 3 warm intros\n\n## Not chasing\n- General consulting: no path to real estate'}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs
                   leading-relaxed outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={save.isPending || text === plan}
          onClick={() => save.mutate()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white
                     disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save plan'}
        </button>
        {saved && <span className="text-xs text-good">Saved.</span>}
      </div>
    </Panel>
  );
}
