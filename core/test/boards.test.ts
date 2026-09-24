import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoardEntry } from '../../mcp/src/sources/boards.ts';

test('a board entry can carry a display name', () => {
  assert.deepEqual(parseBoardEntry('scaleai:Scale AI'), { slug: 'scaleai', name: 'Scale AI' });
  assert.deepEqual(parseBoardEntry('ramp'), { slug: 'ramp', name: 'ramp' });
  assert.deepEqual(parseBoardEntry(' gleanwork : Glean '), { slug: 'gleanwork', name: 'Glean' });
  assert.deepEqual(parseBoardEntry('vts:'), { slug: 'vts', name: 'vts' }, 'an empty name falls back to the slug');
});
