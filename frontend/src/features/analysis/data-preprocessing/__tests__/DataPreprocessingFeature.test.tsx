import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DataPreprocessingFeature from '../DataPreprocessingFeature';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const mockSliceNode = vi.fn();
const mockSlicePreview = vi.fn();
const mockFilterNode = vi.fn();
const mockFilterPreview = vi.fn();
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
    filterNode: mockFilterNode,
    filterPreview: mockFilterPreview,
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
    mockFilterPreview.mockResolvedValue({
      columns: ['Body', 'Count'],
      dtypes: {
        Body: 'Utf8',
        Count: 'Int64',
      },
      data: [{ Body: 'candidate tweet', Count: 1 }],
      pagination: {
        page: 1,
        page_size: 10,
        total_rows: 1,
        total_pages: 1,
      },
    });
    mockFilterNode.mockResolvedValue(undefined);
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
    const user = userEvent.setup();

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
    expect(screen.getByLabelText('Fraction / Count')).toBeInTheDocument();
    expect(screen.getByLabelText('Random seed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fraction / Count'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('Random seed'), { target: { value: '7' } });

    const sampleNameInput = screen.getByLabelText('New data block name');
    expect(sampleNameInput).toHaveValue('');
    expect(sampleNameInput).toHaveAttribute('placeholder', 'Corpus_sampled_fr_0_4_rs_7');

    fireEvent.click(screen.getByRole('button', { name: 'Add to Workspace' }));

    await waitFor(() => {
      const [nodeId, payload] = mockSliceNode.mock.calls[0] ?? [];
      expect(nodeId).toBe('node-1');
      expect(payload).toMatchObject({
        mode: 'random_sample',
        sample_size: 0.4,
        random_seed: 7,
        new_node_name: 'Corpus_sampled_fr_0_4_rs_7',
      });
    });
  });

  it('fills the suggested sample name when tab is pressed on an empty name field', async () => {
    const user = userEvent.setup();

    render(<DataPreprocessingFeature />);

    const [filterTab] = screen.getAllByRole('tab', { name: 'Filter' });
    filterTab.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Sample' })).toHaveAttribute('aria-selected', 'true');
    });

    const samplePanel = screen.getByRole('tabpanel', { name: 'Sample' });

    const [samplingMethodSelect] = within(samplePanel).getAllByRole('combobox');
    samplingMethodSelect.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    fireEvent.change(within(samplePanel).getByPlaceholderText('e.g. 0.4 for 40% or 100 for 100 rows'), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText('Random seed'), { target: { value: '7' } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Corpus_sampled_fr_0_4_rs_7')).toBeInTheDocument();
    });
    const sampleNameInput = screen.getByPlaceholderText('Corpus_sampled_fr_0_4_rs_7');
    expect(sampleNameInput).toHaveValue('');
    expect(sampleNameInput).toHaveAttribute('placeholder', 'Corpus_sampled_fr_0_4_rs_7');

    fireEvent.keyDown(sampleNameInput, { key: 'Tab', code: 'Tab' });

    expect(sampleNameInput).toHaveValue('Corpus_sampled_fr_0_4_rs_7');
  });

  it('uses a smart filter placeholder name and preserves typed overrides', async () => {
    const user = userEvent.setup();

    render(<DataPreprocessingFeature />);

    const filterPanel = screen.getByRole('tabpanel', { name: 'Filter' });
    const [columnSelect] = within(filterPanel).getAllByRole('combobox');
    columnSelect.focus();
    await user.keyboard('{ArrowDown}{Enter}');

    const valueInput = await screen.findByPlaceholderText('Enter value');
    fireEvent.change(valueInput, { target: { value: 'candidate' } });

    const nameInput = within(filterPanel).getByLabelText('New data block name');
    expect(nameInput).toHaveValue('');
    expect(nameInput).toHaveAttribute('placeholder', 'Corpus_filtered_by_Body_eq_candidate');

    fireEvent.change(nameInput, { target: { value: 'custom_filter_name' } });
    fireEvent.change(valueInput, { target: { value: 'election' } });

    expect(nameInput).toHaveValue('custom_filter_name');

    fireEvent.click(within(filterPanel).getByRole('button', { name: 'Add to Workspace' }));

    await waitFor(() => {
      const [nodeId, payload] = mockFilterNode.mock.calls[0] ?? [];
      expect(nodeId).toBe('node-1');
      expect(payload).toMatchObject({
        logic: 'and',
        new_node_name: 'custom_filter_name',
      });
      expect(payload.conditions).toMatchObject([
        {
          column: 'Body',
          operator: 'eq',
          value: 'election',
        },
      ]);
    });
  });
});