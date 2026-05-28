import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingParameterPanel } from '../TopicModelingParameterPanel';
import { sanitizeMinTopicSizeInput } from '../minTopicSize';

vi.mock('../../../../../../components/help/HelpIcon', () => ({
  // Used by: HelpIcon mock module factory so tests focus on parameter behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => null,
}));

vi.mock('../../../../../../components/help/InfoIcon', () => ({
  // Used by: InfoIcon mock module factory so tests focus on parameter behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => null,
}));

vi.mock('../../../../../../components/NodeSelectionPanel', () => ({
  // Used by: NodeSelectionPanel mock module factory to provide a stable marker because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  default: () => <div data-testid="node-selection-panel" />,
}));

vi.mock('../../../../common/components/AnalysisCardLayout', () => ({
  // Used by: AnalysisCardLayout mock module factory to preserve children under test because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * Used by: focused TopicModelingParameterPanel tests because the shared fixture keeps required props stable while each test overrides only the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
const baseProps = {
  selectedNodes: [],
  nodeColumnSelections: [],
  onColumnChange: vi.fn(),
  nodeColors: {},
  onNodeColorChange: vi.fn(),
  defaultPalette: [],
  isLocked: false,
  // Used by: baseProps to supply an empty schema unless a test overrides column options because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  getNodeColumns: () => [],
  actionState: { runDisabled: false, clearDisabled: false, runLabel: 'Run Analysis' },
  corpusSamples: [],
  nodeDocCounts: [],
  onCorpusSampleChange: vi.fn(),
  topicSizeMode: 'exact' as const,
  onTopicSizeModeChange: vi.fn(),
  topicSizeValue: 25,
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
  });

  it('keeps the raw topic size value input while editing', () => {
    render(<TopicModelingParameterPanel {...baseProps} topicSizeValue={25} />);

    const input = screen.getByLabelText('Topic size value') as HTMLInputElement;

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

  it('always renders two sampling rows; second is a placeholder when only one node', () => {
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        selectedNodes={[{ id: 'n1', name: 'Corpus A' }]}
        corpusSamples={[{ percent: '50', enabled: true }]}
        nodeDocCounts={[8000]}
      />,
    );

    // First row has the toggle
    expect(screen.getByLabelText('Disable sampling')).toBeInTheDocument();
    // Placeholder for the second row
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows 100% and full doc count when sampling is disabled', () => {
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        selectedNodes={[{ id: 'n1', name: 'Corpus A' }]}
        corpusSamples={[{ percent: '40', enabled: false }]}
        nodeDocCounts={[10000]}
      />,
    );

    const input = screen.getByLabelText('Sampling percentage for corpus 1') as HTMLInputElement;
    // Input shows 100 (not stored 40) when disabled
    expect(input.value).toBe('100');
    // Full doc count displayed
    expect(screen.getByText(/10,000/)).toBeInTheDocument();
  });

  it('shows sampling warning when enabled and nodes are present', () => {
    render(
      <TopicModelingParameterPanel
        {...baseProps}
        selectedNodes={[{ id: 'n1', name: 'Corpus A' }]}
        corpusSamples={[{ percent: '10', enabled: true }]}
        nodeDocCounts={[1000]}
        showSamplingWarning={true}
      />,
    );
    expect(screen.getByText(/sampled corpus may be too small/i)).toBeInTheDocument();
  });

  it('shows a target-mode slowdown tooltip icon when Target Topic Number is selected', () => {
    render(<TopicModelingParameterPanel {...baseProps} topicSizeMode="exact" />);

    const tooltipIcon = screen.getByLabelText(/Target Topic Number/i);
    const input = screen.getByLabelText('Topic size value');
    expect(tooltipIcon).toHaveAttribute(
      'title',
      expect.stringMatching(/may run slower than Min Topic Size/i),
    );
    expect(tooltipIcon.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
