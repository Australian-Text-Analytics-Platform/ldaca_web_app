import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DataPreprocessingFeature from '../DataPreprocessingFeature';

const mockComputeColumnPreview = vi.fn();
const mockComputeColumn = vi.fn();
const mockReplacePreview = vi.fn();
const mockReplaceText = vi.fn();
const mockRefreshNodeSchema = vi.fn();

const mockSelectedNode = {
  id: 'node-1',
  name: 'Corpus',
  columns: ['Body', 'Count'],
  dtypes: {
    Body: 'Utf8',
    Count: 'Int64',
  },
  shape: [2, 2] as [number, number],
};

vi.mock('@/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => ({
    selectedNodeId: 'node-1',
    selectedNode: mockSelectedNode,
    selectedNodes: [mockSelectedNode],
    selectedNodeIds: ['node-1'],
  }),
}));

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    nodeData: {
      columns: ['Body', 'Count'],
      dtypes: {
        Body: 'Utf8',
        Count: 'Int64',
      },
    },
    currentWorkspaceId: 'ws-1',
    nodes: [mockSelectedNode],
  }),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    filterNode: vi.fn(),
    filterPreview: vi.fn(),
    joinNodes: vi.fn(),
    concatNodes: vi.fn(),
    concatPreview: vi.fn(),
    sliceNode: vi.fn(),
    slicePreview: vi.fn(),
    computeColumn: mockComputeColumn,
    computeColumnPreview: mockComputeColumnPreview,
    replaceText: mockReplaceText,
    replaceTextPreview: mockReplacePreview,
    refreshNodeSchema: mockRefreshNodeSchema,
  }),
}));

vi.mock('@/hooks/useWorkspaceStatus', () => ({
  useWorkspaceStatus: () => ({
    isLoading: {
      nodeData: false,
      graph: false,
      operations: false,
    },
  }),
}));

vi.mock('@/components/help/HelpIcon', () => ({
  default: () => null,
}));

describe('DataPreprocessingFeature replace tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplacePreview.mockResolvedValue({
      columns: ['Body', 'Count'],
      dtypes: {
        Body: 'Utf8',
        Count: 'Int64',
      },
      data: [{ Body: 'Invoice #', Count: 1 }],
    });
    mockReplaceText.mockResolvedValue({
      state: 'successful',
      node_id: 'node-1',
      column_name: 'Body',
      message: 'Updated column Body',
    });
  });

  it('builds a regex replace expression from the Replace tab', async () => {
    const user = userEvent.setup();
    const regexPattern = String.raw`\d+`;

    render(<DataPreprocessingFeature />);

    await user.click(screen.getByRole('tab', { name: 'Replace' }));

    await user.type(screen.getByLabelText('Regex pattern'), regexPattern);
    await user.type(screen.getByLabelText('Replacement'), '#');

    await waitFor(() => {
      const [nodeId, payload] = mockReplacePreview.mock.calls[0] ?? [];
      expect(nodeId).toBe('node-1');
      expect(payload).toMatchObject({
        source_column: 'Body',
        pattern: regexPattern,
        replacement: '#',
        output_column_name: 'Body',
        preview_limit: 25,
      });
    });

    expect(screen.getByText('Invoice #')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to Data Block' }));

    await waitFor(() => {
      const [nodeId, payload] = mockReplaceText.mock.calls[0] ?? [];
      expect(nodeId).toBe('node-1');
      expect(payload).toMatchObject({
        source_column: 'Body',
        pattern: regexPattern,
        replacement: '#',
        output_column_name: 'Body',
      });
    });
  });
});