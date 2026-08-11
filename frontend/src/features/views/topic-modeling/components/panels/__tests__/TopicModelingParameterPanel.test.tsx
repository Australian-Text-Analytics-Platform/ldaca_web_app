import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingParameterPanel } from '../TopicModelingParameterPanel';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

vi.mock('../../../../../../components/help/InfoIcon', () => ({
  default: () => null,
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: ({
    resolvedNodes,
    renderColumnAddon,
    columnAddonWidth,
  }: {
    resolvedNodes: ReturnType<typeof nodeInputsFixture>['resolvedNodes'];
    renderColumnAddon?: (args: {
      node: ReturnType<typeof nodeInputsFixture>['resolvedNodes'][number]['node'];
      nodeId: string;
      index: number;
      color: string;
      column: string;
      columns: string[];
    }) => React.ReactNode;
    columnAddonWidth?: 'fill' | 'auto';
  }) => (
    <div data-column-addon-width={columnAddonWidth} data-testid="node-inputs-panel">
      {resolvedNodes.map((resolved, index) => (
        <div key={resolved.id} data-testid={`node-card-${resolved.id}`}>
          {renderColumnAddon?.({
            node: resolved.node,
            nodeId: resolved.id,
            index,
            color: '#2563eb',
            column: resolved.column,
            columns: resolved.columnOptions.map((column) => column.name),
          })}
        </div>
      ))}
    </div>
  ),
}));

const workspaceNodeFixture = (
  overrides: Pick<WorkspaceNodeMetadata, 'id' | 'name'>,
): WorkspaceNodeMetadata => ({
  color: null,
  document: null,
  columns: ['text'],
  schema: { text: 'String' },
  shape: undefined,
  tokenizerModel: null,
  canUndo: false,
  canRedo: false,
  ...overrides,
});

const nodeInputsFixture = (
  selectedNodeSeeds: Pick<WorkspaceNodeMetadata, 'id' | 'name'>[] = [],
) => {
  const selectedNodes = selectedNodeSeeds.map(workspaceNodeFixture);
  return {
    inputs: selectedNodes.map((node) => ({ node_id: node.id, column: 'text' })),
    resolvedNodes: selectedNodes.map((node) => ({
      id: node.id,
      name: node.name,
      node,
      column: 'text',
      columnOptions: [{ name: 'text', dataType: 'string' }],
    })),
    selectedNodes,
    nodeColumnSelections: selectedNodes.map((node) => ({ nodeId: node.id, column: 'text' })),
    availableNodes: [],
    canAddMore: true,
    addNodes: vi.fn(() => []),
    getAddRejection: vi.fn(() => null),
    removeNode: vi.fn(),
    clear: vi.fn(),
    setColumn: vi.fn(),
    graphSelectedIds: [],
    workspaceId: 'workspace-1',
    recentPresets: [],
    nodeInfoById: {},
    getColumnInfos: vi.fn(() => []),
    getNodeInfo: vi.fn(() => undefined),
  };
};

vi.mock('../../../../common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * Used by: focused TopicModelingParameterPanel tests because the shared fixture keeps required props stable while each test overrides only the behavior under assertion.
 */
const baseProps = {
  nodeInputs: nodeInputsFixture(),
  onColumnChange: vi.fn(),
  nodeColors: {},
  onNodeColorChange: vi.fn(),
  defaultPalette: [],
  actionState: { runDisabled: false, clearDisabled: false, runLabel: 'Run Analysis' },
  corpusSamples: [],
  nodeDocCounts: [],
  onCorpusSampleChange: vi.fn(),
  topicSizeValue: 10,
  topicSizeUserSet: false,
  topicSizeWarning: null as 'orange' | 'red' | null,
  onTopicSizeValueChange: vi.fn(),
  showSamplingWarning: false,
  randomSeed: 0,
  randomSeedUserSet: false,
  onRandomSeedChange: vi.fn(),
  representativeWordsCount: 5,
  representativeWordsCountUserSet: false,
  onRepresentativeWordsCountChange: vi.fn(),
  segmentationMethod: 'automatic' as const,
  onSegmentationMethodChange: vi.fn(),
  maxSegmentTokens: 256,
  onMaxSegmentTokensChange: vi.fn(),
  isRunning: false,
  isClearing: false,
  onRun: vi.fn(),
  onClear: vi.fn(),
  hasMissingColumns: false,
};

describe('TopicModelingParameterPanel', () => {
  it('renders run parameters without result-only words per topic', () => {
    render(<TopicModelingParameterPanel {...baseProps} />);

    expect(screen.getByLabelText('Random Seed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Words per topic')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Segmentation method')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum tokens per segment')).toHaveValue(256);
    expect(screen.queryByText('Topic Modelling Options')).not.toBeInTheDocument();
  });

  it('commits maximum tokens per segment within the supported model window', () => {
    const onMaxSegmentTokensChange = vi.fn();
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        onMaxSegmentTokensChange={onMaxSegmentTokensChange}
      />,
    );

    const input = screen.getByLabelText<HTMLInputElement>('Maximum tokens per segment');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    expect(onMaxSegmentTokensChange).toHaveBeenLastCalledWith(32);

    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(onMaxSegmentTokensChange).toHaveBeenLastCalledWith(510);
  });

  it('keeps the raw topic size value input while editing', () => {
    render(<TopicModelingParameterPanel {...baseProps} topicSizeValue={25} />);

    const input = screen.getByLabelText<HTMLInputElement>('Minimum topic size');

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '30' } });
    expect(input.value).toBe('30');
  });

  it('commits a bounded integer minimum topic size from the rendered control', () => {
    const onTopicSizeValueChange = vi.fn();
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        onTopicSizeValueChange={onTopicSizeValueChange}
      />,
    );

    const input = screen.getByLabelText<HTMLInputElement>('Minimum topic size');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.blur(input);
    expect(onTopicSizeValueChange).toHaveBeenLastCalledWith(2);

    fireEvent.change(input, { target: { value: '14.6' } });
    fireEvent.blur(input);
    expect(onTopicSizeValueChange).toHaveBeenLastCalledWith(15);
  });

  it('renders percentage sampling inside the selected node card', () => {
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        nodeInputs={nodeInputsFixture([{ id: 'n1', name: 'Corpus A' }])}
        corpusSamples={[{ percent: '100' }]}
        nodeDocCounts={[8000]}
      />,
    );

    expect(screen.getByLabelText('Sampling (8,000 documents)')).toHaveValue(100);
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByTestId('node-inputs-panel')).toHaveAttribute(
      'data-column-addon-width',
      'auto',
    );
    expect(screen.getByTestId('topic-sampling-control')).toHaveClass('w-full');
    expect(screen.getByTestId('topic-sampling-wrapper')).toHaveClass('inline-grid', 'w-max');
    expect(screen.queryByText('Data Block Sampling')).not.toBeInTheDocument();
  });

  it('forwards sampling percentage edits from the node card', () => {
    const onCorpusSampleChange = vi.fn();

    render(
      <TopicModelingParameterPanel
        {...baseProps}
        nodeInputs={nodeInputsFixture([{ id: 'n1', name: 'Corpus A' }])}
        corpusSamples={[{ percent: '50' }]}
        nodeDocCounts={[8000]}
        onCorpusSampleChange={onCorpusSampleChange}
      />,
    );

    const input = screen.getByLabelText<HTMLInputElement>('Sampling (4,000 documents)');
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);

    expect(onCorpusSampleChange).toHaveBeenCalledWith(0, { percent: '25' });
  });

  it('shows sampling warning when the sampled document count is small', () => {
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        nodeInputs={nodeInputsFixture([{ id: 'n1', name: 'Corpus A' }])}
        corpusSamples={[{ percent: '1' }]}
        nodeDocCounts={[1000]}
        showSamplingWarning={true}
      />,
    );
    expect(screen.getByText(/sampled corpus may be too small/i)).toBeInTheDocument();
  });

  it('renders a Minimum topic size control with an explanatory help icon', () => {
    render(<TopicModelingParameterPanel {...baseProps} topicSizeValue={10} />);

    const tooltipIcon = screen.getByLabelText(/Minimum topic size is the smallest/i);
    const input = screen.getByLabelText('Minimum topic size');
    expect(tooltipIcon).toHaveAttribute(
      'title',
      expect.stringMatching(/smallest number of documents that can form a topic/i),
    );
    expect(input).toBeInTheDocument();
  });
});
