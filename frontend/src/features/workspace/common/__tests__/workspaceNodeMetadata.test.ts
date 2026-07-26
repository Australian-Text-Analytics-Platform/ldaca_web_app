import { describe, expect, it } from 'vitest';
import type { WorkspaceGraphNode } from '@/api';
import { projectWorkspaceNodeMetadata } from '../workspaceNodeMetadata';

describe('projectWorkspaceNodeMetadata', () => {
  it('projects every selector preference from the complete graph resource', () => {
    const graphNode: WorkspaceGraphNode = {
      id: 'node-1',
      name: 'Renamed graph node',
      color: '#2563eb',
      document: 'document',
      shape: [12, 2],
      tokenizer_model: 'native:plain_words_en',
    };

    expect(projectWorkspaceNodeMetadata(graphNode)).toEqual({
      id: 'node-1',
      name: 'Renamed graph node',
      color: '#2563eb',
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
