import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TokenFrequencyParameterPanel } from '../TokenFrequencyParameterPanel';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';

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
  NodeInputsPanel: () => <div data-testid="node-inputs-panel" />,
}));

const nodeInputsFixture = (): UseTabNodeInputsResult =>
  ({
    inputs: [
      { node_id: 'node-a', column: 'text' },
      { node_id: 'node-b', column: 'text' },
    ],
    resolvedNodes: [
      {
        id: 'node-a',
        name: 'Corpus A',
        node: { id: 'node-a', name: 'Corpus A' },
        column: 'text',
        columnOptions: [{ name: 'text', dataType: 'string' }],
      },
      {
        id: 'node-b',
        name: 'Corpus B',
        node: { id: 'node-b', name: 'Corpus B' },
        column: 'text',
        columnOptions: [{ name: 'text', dataType: 'string' }],
      },
    ],
    selectedNodes: [
      { id: 'node-a', name: 'Corpus A' },
      { id: 'node-b', name: 'Corpus B' },
    ],
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
  });

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
  getColorForNode: (nodeId: string) => (nodeId === 'node-a' ? '#2563eb' : '#dc2626'),
  nodeColors: { 'node-a': '#2563eb', 'node-b': '#dc2626' },
  onNodeColorChange: vi.fn(),
  computeDisplayName: (nodeId: string) => (nodeId === 'node-a' ? 'Corpus A' : 'Corpus B'),
};

describe('TokenFrequencyParameterPanel', () => {
  it('renders the study block toggle under the node selector and switches the study node', () => {
    const onStudyNodeChange = vi.fn();
    render(
      <TokenFrequencyParameterPanel {...baseProps} onStudyNodeChange={onStudyNodeChange} />,
    );

    const nodeSelector = screen.getByTestId('node-inputs-panel');
    const studyToggle = screen.getByRole('radiogroup', { name: 'Study Data Block' });
    expect(
      nodeSelector.compareDocumentPosition(studyToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('action-extra')).toBeEmptyDOMElement();

    expect(screen.getByRole('radio', { name: /Use Corpus A/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const corpusB = screen.getByRole('radio', { name: /Use Corpus B/i });
    expect(corpusB).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(corpusB);

    expect(onStudyNodeChange).toHaveBeenCalledWith('node-b');
  });
});
