import { describe, expect, it } from 'vitest';
import type { WorkspaceGraphNode, WorkspaceNodeInfo } from '@/api';
import { projectWorkspaceNodeMetadata } from '../workspaceNodeMetadata';

describe('projectWorkspaceNodeMetadata', () => {
  it('merges graph interaction state with canonical node-info metadata', () => {
    const graphNode: WorkspaceGraphNode = {
      id: 'node-1',
      name: 'Graph name',
      color: '#2563eb',
      document: 'graph_text',
      can_undo: true,
      can_redo: false,
    };
    const nodeInfo: WorkspaceNodeInfo = {
      id: 'node-1',
      name: 'Canonical name',
      color: '#dc2626',
      document: 'document',
      columns: ['document', 'year'],
      schema: { document: 'String', year: 'Int64' },
      shape: [12, 2],
      tokenizer_models: { document: 'native:plain_words_en' },
    };

    expect(projectWorkspaceNodeMetadata(graphNode, nodeInfo)).toEqual({
      id: 'node-1',
      name: 'Canonical name',
      color: '#dc2626',
      document: 'document',
      columns: ['document', 'year'],
      schema: { document: 'String', year: 'Int64' },
      shape: [12, 2],
      tokenizerModels: { document: 'native:plain_words_en' },
      canUndo: true,
      canRedo: false,
    });
  });

  it('projects a graph-only node without legacy nested aliases', () => {
    expect(
      projectWorkspaceNodeMetadata({
        id: 'node-2',
        name: 'Graph only',
      }),
    ).toEqual({
      id: 'node-2',
      name: 'Graph only',
      color: null,
      document: null,
      columns: [],
      schema: {},
      shape: undefined,
      tokenizerModels: {},
      canUndo: false,
      canRedo: false,
    });
  });
});
