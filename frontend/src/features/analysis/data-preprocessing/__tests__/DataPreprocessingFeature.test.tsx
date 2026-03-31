import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DataPreprocessingFeature from '../DataPreprocessingFeature';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const mockSliceNode = vi.fn();
const mockSlicePreview = vi.fn();
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
    sliceNode: mockSliceNode,
    slicePreview: mockSlicePreview,
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
    mockSlicePreview.mockResolvedValue({
      columns: ['Body', 'Count'],
      dtypes: {
        Body: 'Utf8',
        Count: 'Int64',
      },
      data: [{ Body: 'Invoice 1', Count: 1 }],
      pagination: {
        page: 1,
        page_size: 10,
        total_rows: 1,
        total_pages: 1,
      },
    });
    mockSliceNode.mockResolvedValue({
      node_id: 'sample-node-1',
      data: {
        node_name: 'Corpus_sampled',
      },
    });
    mockReplacePreview.mockResolvedValue({
      columns: ['Body', 'Count'],
      dtypes: {
        Body: 'Utf8',
        Count: 'Int64',
      },
      data: [{ Body: 'Invoice #', Count: 1 }],
      pagination: {
        page: 1,
        page_size: 10,
        total_rows: 1,
        total_pages: 1,
      },
    });
    mockReplaceText.mockResolvedValue({
      state: 'successful',
      node_id: 'node-1',
      column_name: 'Body',
      message: 'Updated column Body',
    });
  });

  it('builds a regex replace expression from the Find tab', async () => {
    const user = userEvent.setup();
    const regexPattern = String.raw`\d+`;

    render(<DataPreprocessingFeature />);

    await user.click(screen.getByRole('tab', { name: 'Find' }));

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

  it('shows the Sample tab and submits a random sample request', async () => {
    // pointerEventsCheck disabled: jsdom does not compute CSS from Tailwind
    // classes, so Radix portal leftovers from prior tests can produce false
    // positives for `pointer-events: none`.
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(<DataPreprocessingFeature />);

    screen.getByRole('tab', { name: 'Filter' }).focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Sample' })).toHaveAttribute('aria-selected', 'true');
    });

    expect(screen.getByText('Sample rows')).toBeInTheDocument();
    expect(screen.getByLabelText('Offset')).toBeInTheDocument();

    screen.getByRole('combobox', { name: 'Sampling method' }).focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(screen.queryByLabelText('Offset')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fraction')).toBeInTheDocument();
    expect(screen.getByLabelText('Random seed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fraction'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('Random seed'), { target: { value: '7' } });

    await user.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    await waitFor(() => {
      const [nodeId, payload] = mockSliceNode.mock.calls[0] ?? [];
      expect(nodeId).toBe('node-1');
      expect(payload).toMatchObject({
        mode: 'random_sample',
        fraction: 0.4,
        random_seed: 7,
        new_node_name: 'Corpus_sampled',
      });
    });
  });
});