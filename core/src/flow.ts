/**
 * The pipeline as a flow: every role that came in, how far it got, and where it left.
 *
 * Each role follows exactly one path from the root, and stops at the deepest stage it
 * reached. That makes the result a tree in which a stage's branches always sum to what
 * reached it, which is the property that makes a flow chart honest: nothing is double
 * counted and nothing disappears between columns.
 */

export type FlowTone = 'progress' | 'win' | 'loss' | 'idle' | 'stalled';

export interface FlowNode {
  id: string;
  label: string;
  depth: number;
  count: number;
  tone: FlowTone;
  parent: string | null;
  /** statuses a leaf corresponds to */
  statuses?: string[];
  /** the exact roles in this stage, so clicking a node can list precisely them */
  ids: string[];
}

export interface FlowLink { source: string; target: string; value: number }

export interface FlowRow {
  id?: string;
  status: string;
  drop_reason: string | null;
  resume_count: number;
  interview_count: number;
}

interface Def { label: string; tone: FlowTone; parent: string | null; statuses?: string[] }

/** Order here is the order children are stacked in, top to bottom. */
const TREE: Record<string, Def> = {
  found:              { label: 'Found', tone: 'progress', parent: null },

  kept:               { label: 'Kept', tone: 'progress', parent: 'found' },
  discarded:          { label: 'Filtered out', tone: 'loss', parent: 'found' },

  pursued:            { label: 'Pursued', tone: 'progress', parent: 'kept' },
  waiting:            { label: 'Waiting on you', tone: 'idle', parent: 'kept', statuses: ['New'] },
  skipped:            { label: 'Skipped', tone: 'loss', parent: 'kept', statuses: ['Skip'] },
  dead:               { label: 'Dead link', tone: 'idle', parent: 'kept', statuses: ['Dead link', 'Unverified'] },

  'discard:location': { label: 'Wrong location', tone: 'loss', parent: 'discarded', statuses: ['Discarded'] },
  'discard:level':    { label: 'Too senior', tone: 'loss', parent: 'discarded', statuses: ['Discarded'] },
  'discard:title':    { label: 'Excluded title', tone: 'loss', parent: 'discarded', statuses: ['Discarded'] },
  'discard:content':  { label: 'Excluded in JD', tone: 'loss', parent: 'discarded', statuses: ['Discarded'] },
  'discard:cutoff':   { label: 'Scored too low', tone: 'loss', parent: 'discarded', statuses: ['Discarded'] },
  'discard:other':    { label: 'Other', tone: 'loss', parent: 'discarded', statuses: ['Discarded'] },

  applied:            { label: 'Applied', tone: 'progress', parent: 'pursued' },
  queued:             { label: 'Queued for docs', tone: 'stalled', parent: 'pursued', statuses: ['Generate'] },
  unsent:             { label: 'Built, not sent', tone: 'stalled', parent: 'pursued', statuses: ['Complete'] },
  dropped:            { label: 'Dropped after docs', tone: 'loss', parent: 'pursued', statuses: ['Skip'] },

  interviewed:        { label: 'Interviewed', tone: 'progress', parent: 'applied' },
  awaiting:           { label: 'Awaiting reply', tone: 'stalled', parent: 'applied', statuses: ['Applied'] },
  rejected_cold:      { label: 'Rejected', tone: 'loss', parent: 'applied', statuses: ['Rejected'] },

  offer:              { label: 'Offer', tone: 'win', parent: 'interviewed', statuses: ['Offer'] },
  in_process:         { label: 'In process', tone: 'stalled', parent: 'interviewed', statuses: ['Interviewing'] },
  rejected_after:     { label: 'Rejected', tone: 'loss', parent: 'interviewed', statuses: ['Rejected'] },
};

function discardReason(reason: string | null): string {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('location')) return 'discard:location';
  if (r.includes('senior') || r.includes('level')) return 'discard:level';
  if (r.includes('title')) return 'discard:title';
  if (r.includes('content')) return 'discard:content';
  if (r.includes('cutoff') || r.includes('low')) return 'discard:cutoff';
  return 'discard:other';
}

/** The single deepest stage this role reached. Everything above it is implied. */
export function leafFor(row: FlowRow): string {
  switch (row.status) {
    case 'Discarded': return discardReason(row.drop_reason);
    case 'New': return 'waiting';
    case 'Dead link':
    case 'Unverified': return 'dead';
    // A role skipped after its documents were built is a different, more expensive loss
    // than one passed over at a glance, so it is counted separately.
    case 'Skip': return row.resume_count > 0 ? 'dropped' : 'skipped';
    case 'Generate': return 'queued';
    case 'Complete': return 'unsent';
    case 'Applied': return 'awaiting';
    case 'Interviewing': return 'in_process';
    case 'Offer': return 'offer';
    case 'Rejected': return row.interview_count > 0 ? 'rejected_after' : 'rejected_cold';
    default: return 'waiting';
  }
}

function pathTo(leaf: string): string[] {
  const path: string[] = [];
  for (let id: string | null = leaf; id; id = TREE[id].parent) path.unshift(id);
  return path;
}

export function pipelineFlow(rows: FlowRow[]): { nodes: FlowNode[]; links: FlowLink[]; total: number } {
  const counts = new Map<string, number>();
  const members = new Map<string, string[]>();
  for (const row of rows) {
    for (const id of pathTo(leafFor(row))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (row.id) {
        const list = members.get(id) ?? [];
        list.push(row.id);
        members.set(id, list);
      }
    }
  }

  const depthOf = (id: string) => pathTo(id).length - 1;
  const ids = Object.keys(TREE).filter((id) => id === 'found' || (counts.get(id) ?? 0) > 0);

  const nodes: FlowNode[] = ids.map((id) => ({
    id,
    label: TREE[id].label,
    depth: depthOf(id),
    count: counts.get(id) ?? 0,
    tone: TREE[id].tone,
    parent: TREE[id].parent,
    statuses: TREE[id].statuses,
    ids: members.get(id) ?? [],
  }));

  const links: FlowLink[] = nodes
    .filter((n) => n.parent && n.count > 0)
    .map((n) => ({ source: n.parent as string, target: n.id, value: n.count }));

  return { nodes, links, total: rows.length };
}
