import { describe, expect, it } from 'vitest';
import type { WorkspaceGraphNode, WorkspaceNodeInfo } from '@/api';
import { projectWorkspaceNodeMetadata } from '../workspaceNodeMetadata';

describe('projectWorkspaceNodeMetadata', () => {
  it('keeps the live graph name when hydrated node info still has the pre-rename name', () => {
    const graphNode: WorkspaceGraphNode = {
      id: 'node-1',
      name: 'Renamed graph node',
      color: '#2563eb',
      document: 'graph_text',
      can_undo: true,
      can_redo: false,
    };
    const nodeInfo: WorkspaceNodeInfo = {
      id: 'node-1',
      name: 'Stale pre-rename name',
      color: '#dc2626',
      document: 'document',
      columns: ['document', 'year'],
      schema: { document: 'String', year: 'Int64' },
      shape: [12, 2],
      tokenizer_models: { document: 'native:plain_words_en' },
    };

    expect(projectWorkspaceNodeMetadata(graphNode, nodeInfo)).toEqual({
      id: 'node-1',
      name: 'Renamed graph node',
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
