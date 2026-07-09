import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingParameterPanel } from '../TopicModelingParameterPanel';
import { sanitizeMinTopicSizeInput } from '../minTopicSize';

vi.mock('../../../../../../components/help/InfoIcon', () => ({
  // Used by: InfoIcon mock module factory so tests focus on parameter behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => null,
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  // Used by: NodeInputsPanel mock module factory to provide a stable marker because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
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

const nodeInputsFixture = (selectedNodes: { id?: string; name?: string }[] = []) => ({
  inputs: selectedNodes.map((node) => ({ node_id: node.id ?? '', column: 'text' })),
  resolvedNodes: selectedNodes.map((node) => ({
    id: node.id ?? '',
    name: node.name ?? node.id ?? '',
    node,
    column: 'text',
    columnOptions: [{ name: 'text', dataType: 'string' }],
  })),
  selectedNodes,
  nodeColumnSelections: selectedNodes.map((node) => ({ nodeId: node.id ?? '', column: 'text' })),
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
  nodeInfoCache: {},
  getColumnInfos: vi.fn(() => []),
  getNodeInfo: vi.fn(() => undefined),
});

vi.mock('../../../../common/components/AnalysisCardLayout', () => ({
  // Used by: AnalysisCardLayout mock module factory to preserve children under test because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * Used by: focused TopicModelingParameterPanel tests because the shared fixture keeps required props stable while each test overrides only the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
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
  randomSeed: 42,
  randomSeedUserSet: false,
  onRandomSeedChange: vi.fn(),
  representativeWordsCount: 5,
  representativeWordsCountUserSet: false,
  onRepresentativeWordsCountChange: vi.fn(),
  isRunning: false,
  isClearing: false,
  onRun: vi.fn(),
  onClear: vi.fn(),
  hasMissingColumns: false,
};

describe('TopicModelingParameterPanel', () => {
  it('renders controls for random seed and words per topic', () => {
    render(<TopicModelingParameterPanel {...baseProps} />);

    expect(screen.getByLabelText('Random Seed')).toBeInTheDocument();
    expect(screen.getByLabelText('Words per topic')).toBeInTheDocument();
    expect(screen.queryByText('Topic Modelling Options')).not.toBeInTheDocument();
  });

  it('keeps the raw topic size value input while editing', () => {
    render(<TopicModelingParameterPanel {...baseProps} topicSizeValue={25} />);

    const input = screen.getByLabelText<HTMLInputElement>('Minimum topic size');

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '30' } });
    expect(input.value).toBe('30');
  });

  it('sanitizes min topic size values on commit', () => {
    expect(sanitizeMinTopicSizeInput('')).toBe(2);
    expect(sanitizeMinTopicSizeInput('1')).toBe(2);
    expect(sanitizeMinTopicSizeInput('15')).toBe(15);
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
