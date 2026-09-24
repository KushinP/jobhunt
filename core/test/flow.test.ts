import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineFlow, leafFor, type FlowRow } from '../src/flow.ts';

const row = (status: string, extra: Partial<FlowRow> = {}): FlowRow => ({
  status, drop_reason: null, resume_count: 0, interview_count: 0, ...extra,
});

/** A realistic spread: every branch of the tree represented at least once. */
const SAMPLE: FlowRow[] = [
  ...Array(9).fill(0).map(() => row('Discarded', { drop_reason: 'location not acceptable and not remote' })),
  ...Array(4).fill(0).map(() => row('Discarded', { drop_reason: 'below hard cutoff' })),
  row('Discarded', { drop_reason: 'level mismatch: too senior' }),
  row('Discarded', { drop_reason: 'excluded by title term' }),
  ...Array(6).fill(0).map(() => row('New')),
  ...Array(3).fill(0).map(() => row('Skip')),
  row('Skip', { resume_count: 1 }),
  row('Dead link'),
  ...Array(2).fill(0).map(() => row('Generate')),
  ...Array(3).fill(0).map(() => row('Complete', { resume_count: 1 })),
  ...Array(4).fill(0).map(() => row('Applied', { resume_count: 1 })),
  row('Rejected', { resume_count: 1 }),
  row('Rejected', { resume_count: 1, interview_count: 2 }),
  row('Interviewing', { resume_count: 1, interview_count: 1 }),
  row('Offer', { resume_count: 1, interview_count: 3 }),
];

test('every stage\'s branches sum to exactly what reached it', () => {
  const { nodes, links } = pipelineFlow(SAMPLE);
  for (const n of nodes) {
    const out = links.filter((l) => l.source === n.id).reduce((a, l) => a + l.value, 0);
    const isLeaf = !links.some((l) => l.source === n.id);
    if (!isLeaf) {
      assert.equal(out, n.count, `${n.id}: ${n.count} arrived but ${out} left`);
    }
  }
});

test('the root counts every role once', () => {
  const { nodes, total } = pipelineFlow(SAMPLE);
  assert.equal(total, SAMPLE.length);
  assert.equal(nodes.find((n) => n.id === 'found')!.count, SAMPLE.length);
});

test('the leaves partition the roles: each is counted in exactly one', () => {
  const { nodes, links } = pipelineFlow(SAMPLE);
  const leaves = nodes.filter((n) => !links.some((l) => l.source === n.id));
  assert.equal(leaves.reduce((a, n) => a + n.count, 0), SAMPLE.length);
});

test('filter reasons fan out under "filtered out" and sum to it', () => {
  const { nodes } = pipelineFlow(SAMPLE);
  const discarded = nodes.find((n) => n.id === 'discarded')!;
  const reasons = nodes.filter((n) => n.parent === 'discarded');
  assert.equal(discarded.count, 15);
  assert.equal(reasons.reduce((a, n) => a + n.count, 0), 15);
  assert.equal(nodes.find((n) => n.id === 'discard:location')!.count, 9,
    'the location filter is visibly the one eating the most roles');
});

test('a rejection after an interview routes through "interviewed", a cold one does not', () => {
  assert.equal(leafFor(row('Rejected', { interview_count: 2 })), 'rejected_after');
  assert.equal(leafFor(row('Rejected')), 'rejected_cold');
  const { nodes } = pipelineFlow(SAMPLE);
  assert.equal(nodes.find((n) => n.id === 'interviewed')!.count, 3,
    'offer + in process + rejected after interview');
});

test('skipping after documents were built is counted separately from skipping at a glance', () => {
  assert.equal(leafFor(row('Skip')), 'skipped');
  assert.equal(leafFor(row('Skip', { resume_count: 1 })), 'dropped');
});

test('empty branches are left out rather than drawn at zero', () => {
  const { nodes } = pipelineFlow([row('New'), row('New')]);
  assert.deepEqual(nodes.map((n) => n.id).sort(), ['found', 'kept', 'waiting']);
});

test('no roles at all yields just an empty root, not an error', () => {
  const { nodes, links, total } = pipelineFlow([]);
  assert.equal(total, 0);
  assert.deepEqual(nodes.map((n) => n.id), ['found']);
  assert.equal(links.length, 0);
});

test('depth follows the tree, so columns line up', () => {
  const { nodes } = pipelineFlow(SAMPLE);
  const d = (id: string) => nodes.find((n) => n.id === id)!.depth;
  assert.equal(d('found'), 0);
  assert.equal(d('kept'), 1);
  assert.equal(d('pursued'), 2);
  assert.equal(d('applied'), 3);
  assert.equal(d('interviewed'), 4);
  assert.equal(d('offer'), 5);
});

test('each node carries exactly the roles in it, so a click can list precisely them', () => {
  const rows = SAMPLE.map((r, i) => ({ ...r, id: `job-${i}` }));
  const { nodes, links } = pipelineFlow(rows);
  for (const n of nodes) {
    assert.equal(n.ids.length, n.count, `${n.id} lists ${n.ids.length} roles but counts ${n.count}`);
  }
  const leaves = nodes.filter((n) => !links.some((l) => l.source === n.id));
  const all = leaves.flatMap((n) => n.ids);
  assert.equal(new Set(all).size, rows.length, 'every role appears in exactly one leaf');
});
