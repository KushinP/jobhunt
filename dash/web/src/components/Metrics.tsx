import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api.ts';
import { Empty } from './bits.tsx';
import { FlowChart } from './FlowChart.tsx';

export function Metrics({ onSelect }: {
  onSelect?: (sel: { ids: string[]; label: string }) => void;
}) {
  const { data, isLoading } = useQuery({ queryKey: ['metrics'], queryFn: api.metrics });
  if (isLoading || !data) return <Empty>Loading…</Empty>;

  const hasActivity = data.weekly.some((w) => w.found || w.applied || w.interviews);

  return (
    <div className="space-y-6">
      <Panel
        title="Pipeline flow"
        note="Every role that came in, how far it got, and where it left. Widths are role counts; each stage's branches sum to what reached it. Click any stage to list its roles."
      >
        <FlowChart onSelect={onSelect} />
      </Panel>

      <Panel
        title="Weekly activity"
        note="Applications out is the number that matters. Roles found is a vanity metric."
      >
        {hasActivity ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weekly} margin={{ top: 4, right: 4, bottom: 4, left: -16 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="week" stroke="var(--color-muted)" fontSize={11} tickLine={false} />
                <YAxis stroke="var(--color-muted)" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'var(--color-line)', fillOpacity: 0.35 }}
                  contentStyle={{
                    background: 'var(--color-panel)', border: '1px solid var(--color-line)',
                    borderRadius: 8, fontSize: 12, color: 'var(--color-fg)',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="found" name="found" fill="var(--color-muted)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="applied" name="applied" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="interviews" name="interviews" fill="var(--color-good)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <Empty>No activity recorded yet.</Empty>}
      </Panel>

      <Panel
        title="Source performance"
        note="Prune any source that produces roles but never an interview."
      >
        <Table
          head={['Source', 'Found', 'Kept', 'Applied', 'Interviews', 'Rate']}
          rows={data.sources.map((s) => [
            s.source, s.found, s.kept, s.applied, s.reached_interview,
            s.interview_rate_pct == null ? '-' : `${s.interview_rate_pct}%`,
          ])}
        />
      </Panel>

      <Panel
        title="Your rating vs the score"
        note={data.agreement && data.agreement.rated > 0
          ? `${data.agreement.agree} of ${data.agreement.rated} rated roles land within one band `
            + `of the score (average gap ${data.agreement.avg_gap ?? 0}). A large gap means the `
            + `rubric is measuring the wrong things.`
          : 'Rate a few roles and this will show whether the scoring agrees with you.'}
      >
        <Table
          head={['Your rating', 'Roles', 'Avg score', 'Applied', 'Interviews', 'Rate']}
          rows={data.rating_calibration.map((r) => [
            '★'.repeat(r.rating), r.rated, r.avg_score ?? '-', r.applied, r.reached_interview,
            r.interview_rate_pct == null ? '-' : `${r.interview_rate_pct}%`,
          ])}
        />
      </Panel>

      <Panel
        title="Does the score predict interviews?"
        note="If the interview rate is flat across bands, the weights are decoration and want retuning."
      >
        <Table
          head={['Score band', 'Scored', 'Applied', 'Interviews', 'Rate']}
          rows={data.calibration.map((c) => [
            c.score_band, c.scored, c.applied, c.reached_interview,
            c.interview_rate_pct == null ? '-' : `${c.interview_rate_pct}%`,
          ])}
        />
      </Panel>
    </div>
  );
}

function Panel({ title, note, children }: {
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

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <Empty>Nothing to show yet.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((h) => <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((cell, j) => (
                <td key={j} className={`py-1.5 pr-4 ${j === 0 ? '' : 'tabular-nums'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
