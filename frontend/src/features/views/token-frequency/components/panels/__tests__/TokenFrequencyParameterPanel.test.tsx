import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TokenFrequencyParameterPanel } from '../TokenFrequencyParameterPanel';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

vi.mock('@/components/help/HelpIcon', () => ({
  // Used by: panel tests so help widgets do not add tooltip behavior to layout assertions.
  default: () => null,
}));

vi.mock('@/features/views/common/components/AnalysisCardLayout', () => ({
  // Used by: parameter-panel tests to expose actions and children without card chrome.
  AnalysisCardLayout: ({
    actions,
    children,
  }: {
    actions?: { extraContent?: React.ReactNode };
    children: React.ReactNode;
  }) => (
    <section>
      <div data-testid="action-extra">{actions?.extraContent}</div>
      {children}
    </section>
  ),
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  // Used by: placement tests as the stable boundary for the selected-node selector.
  NodeInputsPanel: ({
    resolvedNodes,
    nodeColors,
    renderExtraNodeContent,
  }: {
    resolvedNodes: {
      id: string;
      node: { id: string; name: string };
      column: string;
      columnOptions: { name: string }[];
    }[];
    nodeColors?: Record<string, string>;
    renderExtraNodeContent?: (args: {
      node: { id: string; name: string };
      nodeId: string;
      index: number;
      color: string;
      column: string;
      columns: string[];
    }) => React.ReactNode;
  }) => (
    <div data-testid="node-inputs-panel">
      {resolvedNodes.map((resolved, index) => (
        <div key={resolved.id} data-testid={`node-card-${resolved.id}`}>
          {renderExtraNodeContent?.({
            node: resolved.node,
            nodeId: resolved.id,
            index,
            color: nodeColors?.[resolved.id] ?? '#000000',
            column: resolved.column,
            columns: resolved.columnOptions.map((column) => column.name),
          })}
        </div>
      ))}
    </div>
  ),
}));

const nodeInputsFixture = (): UseTabNodeInputsResult => {
  const nodeA = projectWorkspaceNodeMetadata({ id: 'node-a', name: 'Corpus A' });
  const nodeB = projectWorkspaceNodeMetadata({ id: 'node-b', name: 'Corpus B' });
  return {
    inputs: [
      { node_id: 'node-a', column: 'text' },
      { node_id: 'node-b', column: 'text' },
    ],
    resolvedNodes: [
      {
        id: 'node-a',
        name: 'Corpus A',
        node: nodeA,
        column: 'text',
        columnOptions: [{ name: 'text', dataType: 'string' }],
      },
      {
        id: 'node-b',
        name: 'Corpus B',
        node: nodeB,
        column: 'text',
        columnOptions: [{ name: 'text', dataType: 'string' }],
      },
    ],
    selectedNodes: [nodeA, nodeB],
    nodeColumnSelections: [
      { nodeId: 'node-a', column: 'text' },
      { nodeId: 'node-b', column: 'text' },
    ],
    availableNodes: [],
    canAddMore: false,
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
  };
};

const baseProps = {
  nodeInputs: nodeInputsFixture(),
  onColumnChange: vi.fn(),
  actionState: { runDisabled: false, clearDisabled: false, runLabel: 'Run' },
  isAnalyzing: false,
  onAnalyze: vi.fn(),
  onStop: vi.fn(),
  isStopping: false,
  onClearResults: vi.fn(),
  hasIncompleteSelections: false,
  hasResults: false,
  runLabel: 'Run',
  studyNodeId: 'node-a',
  onStudyNodeChange: vi.fn(),
  nodeColors: { 'node-a': '#2563eb', 'node-b': '#dc2626' },
  onNodeColorChange: vi.fn(),
  computeDisplayName: (nodeId: string) => (nodeId === 'node-a' ? 'Corpus A' : 'Corpus B'),
};

describe('TokenFrequencyParameterPanel', () => {
  it('renders synced corpus role switches inside the selected-node cards', () => {
    const onStudyNodeChange = vi.fn();
    render(<TokenFrequencyParameterPanel {...baseProps} onStudyNodeChange={onStudyNodeChange} />);

    expect(screen.queryByRole('radiogroup', { name: 'Study Data Block' })).not.toBeInTheDocument();
    expect(screen.getByTestId('action-extra')).toBeEmptyDOMElement();

    const cardA = within(screen.getByTestId('node-card-node-a'));
    const cardB = within(screen.getByTestId('node-card-node-b'));
    expect(cardA.getByText('Study Corpus')).toBeInTheDocument();
    expect(cardA.getByText('Reference Corpus')).toBeInTheDocument();
    expect(cardB.getByText('Study Corpus')).toBeInTheDocument();
    expect(cardB.getByText('Reference Corpus')).toBeInTheDocument();

    expect(cardA.getByRole('switch', { name: /Corpus A corpus role/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const corpusBSwitch = cardB.getByRole('switch', { name: /Corpus B corpus role/i });
    expect(corpusBSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(corpusBSwitch);

    expect(onStudyNodeChange).toHaveBeenCalledWith('node-b');
  });
});
