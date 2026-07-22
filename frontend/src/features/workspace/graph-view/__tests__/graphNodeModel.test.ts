import { describe, expect, it } from 'vitest';

import type { WorkspaceGraphNode } from '@/api';
import { projectWorkspaceGraphNodeCard } from '../graphNodeModel';

const graphNode = (shape?: WorkspaceGraphNode['shape']): WorkspaceGraphNode => ({
  id: 'node-1',
  name: 'Joined data',
  provenance: { type: 'source' },
  derivation_description: 'source snapshot',
  shape,
  can_undo: false,
  can_redo: false,
});

describe('projectWorkspaceGraphNodeCard', () => {
  it('projects the complete Data Block shape returned by the graph query', () => {
    expect(projectWorkspaceGraphNodeCard(graphNode([2380, 21])).shape).toEqual([2380, 21]);
  });

  it('retains the unknown fallback when node metadata omits shape', () => {
    expect(projectWorkspaceGraphNodeCard(graphNode()).shape).toEqual([null, null]);
  });
});
