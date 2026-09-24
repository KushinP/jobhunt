import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flowApi, type FlowNode } from '../api.ts';

const TONE: Record<FlowNode['tone'], string> = {
  progress: 'var(--color-good)',
  win: 'var(--color-good)',
  loss: 'var(--color-risk)',
  idle: 'var(--color-muted)',
  stalled: 'var(--color-warn)',
};

const W = 1120;          // viewBox width; the SVG scales to its container
const NODE_W = 9;
const PAD_T = 8;
const PAD_L = 4;
const LABEL_W = 170;     // room for the last column's labels
const LABEL_H = 34;      // two text lines: count, then label
const GAP = 8;
const MIN_H = 3;
const TARGET_ROOT_H = 340;

/** text halo: a stroke in the panel colour painted under the fill */
const HALO = {
  stroke: 'var(--color-panel)',
  strokeWidth: 4,
  strokeLinejoin: 'round' as const,
  paintOrder: 'stroke' as const,
};

interface Placed extends FlowNode { x: number; y: number; h: number; children: Placed[] }

/**
 * Tree layout. A node is as tall as its count (never shorter than its children stacked),
 * children tile the parent's height exactly so ribbons join without gaps, and each
 * column is spaced by label height so tiny branches stay readable and fan out, the way
 * a small "2 Demo booked" still gets its own row.
 */
function layout(nodes: FlowNode[], total: number) {
  const byId = new Map<string, Placed>();
  for (const n of nodes) byId.set(n.id, { ...n, x: 0, y: 0, h: 0, children: [] });
  for (const n of byId.values()) if (n.parent) byId.get(n.parent)?.children.push(n);

  const root = byId.get('found')!;
  const maxDepth = Math.max(1, ...nodes.map((n) => n.depth));
  const step = (W - PAD_L - LABEL_W) / maxDepth;
  const px = total > 0 ? Math.min(28, TARGET_ROOT_H / total) : 0;

  const size = (n: Placed): number => {
    const kids = n.children.reduce((a, c) => a + size(c), 0);
    n.h = Math.max(MIN_H, n.count * px, kids);
    return n.h;
  };
  size(root);

  const colBottom = new Map<number, number>();
  const place = (n: Placed, idealY: number) => {
    const floor = colBottom.get(n.depth) ?? PAD_T - GAP;
    n.y = Math.max(idealY, floor + GAP);
    n.x = PAD_L + n.depth * step;
    colBottom.set(n.depth, n.y + Math.max(n.h, LABEL_H));
    let offset = 0;
    for (const c of n.children) {
      place(c, n.y + offset);
      offset += c.h;
    }
  };
  place(root, PAD_T);

  const height = Math.max(...colBottom.values()) + PAD_T;
  return { root, byId, height: Math.max(height, 80) };
}

function ribbon(sx: number, sy0: number, sy1: number, tx: number, ty0: number, ty1: number) {
  const mx = (sx + tx) / 2;
  return `M${sx},${sy0} C${mx},${sy0} ${mx},${ty0} ${tx},${ty0}`
    + ` L${tx},${ty1} C${mx},${ty1} ${mx},${sy1} ${sx},${sy1} Z`;
}

export function FlowChart({ onSelect }: {
  onSelect?: (sel: { ids: string[]; label: string }) => void;
}) {
  const { data, isLoading } = useQuery({ queryKey: ['flow'], queryFn: flowApi.get });
  const [hover, setHover] = useState<string | null>(null);

  const drawn = useMemo(() => (data ? layout(data.nodes, data.total) : null), [data]);

  if (isLoading || !data || !drawn) return <p className="py-6 text-sm text-muted">Loading…</p>;
  if (data.total === 0) {
    return <p className="py-6 text-sm text-muted">No roles yet. The flow fills in as the search runs.</p>;
  }

  const { byId, height } = drawn;
  const placed = [...byId.values()];

  // a hovered node lights up its whole lineage: the path that led to it and what came after
  const lineage = new Set<string>();
  if (hover) {
    for (let id: string | null = hover; id; id = byId.get(id)?.parent ?? null) lineage.add(id);
    const down = (n: Placed) => { lineage.add(n.id); n.children.forEach(down); };
    const h = byId.get(hover);
    if (h) down(h);
  }
  const lit = (id: string) => !hover || lineage.has(id);

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block min-w-[720px]"
        role="img"
        aria-label={`Pipeline flow for ${data.total} roles`}
      >
        {placed.map((n) => {
          const parent = n.parent ? byId.get(n.parent) : null;
          if (!parent) return null;
          const before = parent.children.slice(0, parent.children.indexOf(n))
            .reduce((a, c) => a + c.h, 0);
          const sy0 = parent.y + before;
          const pct = Math.round((n.count / parent.count) * 100);
          return (
            <path
              key={`l-${n.id}`}
              d={ribbon(parent.x + NODE_W, sy0, sy0 + n.h, n.x, n.y, n.y + n.h)}
              fill={TONE[n.tone]}
              fillOpacity={lit(n.id) ? 0.3 : 0.07}
              className="transition-[fill-opacity] duration-150"
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect && n.ids.length && onSelect({ ids: n.ids, label: n.label })}
              style={{ cursor: onSelect && n.ids.length ? 'pointer' : undefined }}
            >
              <title>{`${parent.label} → ${n.label}: ${n.count} (${pct}% of ${parent.label})`}</title>
            </path>
          );
        })}

        {placed.map((n) => {
          const clickable = Boolean(onSelect) && n.ids.length > 0;
          return (
            <g
              key={n.id}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => clickable && onSelect?.({ ids: n.ids, label: n.label })}
              className={clickable ? 'cursor-pointer' : ''}
              opacity={lit(n.id) ? 1 : 0.35}
            >
              <rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={2} fill={TONE[n.tone]} />
              {/* hit areas: the bar, widened so a 3px node is still easy to grab, and the
                  label box. Not the space beside a tall bar, where its ribbons fan out. */}
              <rect x={n.x - 4} y={n.y - 2} width={NODE_W + 8} height={Math.max(n.h, 8) + 4}
                fill="transparent" />
              <rect x={n.x + NODE_W} y={n.y - 2} width={LABEL_W - 40} height={LABEL_H}
                fill="transparent" />
              <text x={n.x + NODE_W + 7} y={n.y + 13} fontSize={14} fontWeight={600}
                fill="var(--color-fg)" className="tabular-nums" {...HALO}>{n.count}</text>
              <text x={n.x + NODE_W + 7} y={n.y + 28} fontSize={11.5}
                fill="var(--color-muted)" {...HALO}>{n.label}</text>
              <title>
                {`${n.label}: ${n.count} of ${data.total} roles`
                  + (clickable ? '. Click to list them.' : '')}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
