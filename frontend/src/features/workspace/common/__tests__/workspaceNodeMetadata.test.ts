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
    };
    const nodeInfo: WorkspaceNodeInfo = {
      id: 'node-1',
      name: 'Stale pre-rename name',
      color: '#dc2626',
      document: 'document',
      shape: [12, 2],
      tokenizer_model: 'native:plain_words_en',
    };

    expect(projectWorkspaceNodeMetadata(graphNode, nodeInfo)).toEqual({
      id: 'node-1',
      name: 'Renamed graph node',
      color: '#dc2626',
      document: 'document',
      shape: [12, 2],
      tokenizerModel: 'native:plain_words_en',
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
      shape: undefined,
      tokenizerModel: null,
    });
  });
});
