import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingParameterPanel } from '../TopicModelingParameterPanel';

vi.mock('../../../../../../components/help/HelpIcon', () => ({
  default: () => null,
}));

vi.mock('../../../../../../components/NodeSelectionPanel', () => ({
  default: () => <div data-testid="node-selection-panel" />,
}));

vi.mock('../../../../common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('TopicModelingParameterPanel', () => {
  it('renders controls for random seed and representative word count', () => {
    render(
      <TopicModelingParameterPanel
        selectedNodes={[]}
        nodeColumnSelections={[]}
        onColumnChange={vi.fn()}
        nodeColors={{}}
        onNodeColorChange={vi.fn()}
        defaultPalette={[]}
        isLocked={false}
        getNodeColumns={() => []}
        actionState={{ runDisabled: false, clearDisabled: false, runLabel: 'Run Analysis' }}
        minTopicSize={10}
        onMinTopicSizeChange={vi.fn()}
        randomSeed={42}
        onRandomSeedChange={vi.fn()}
        representativeWordsCount={5}
        onRepresentativeWordsCountChange={vi.fn()}
        isRunning={false}
        isClearing={false}
        onRun={vi.fn()}
        onClear={vi.fn()}
        hasMissingColumns={false}
      />
    );

    expect(screen.getByLabelText('Random Seed')).toBeInTheDocument();
    expect(screen.getByLabelText('Representative Words to Show')).toBeInTheDocument();
  });
});