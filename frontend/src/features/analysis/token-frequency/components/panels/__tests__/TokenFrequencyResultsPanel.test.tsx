import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TokenFrequencyResultsPanel } from '../TokenFrequencyResultsPanel';

vi.mock('@/components/help/HelpIcon', () => ({
  default: ({ label }: { label?: string }) => <button type="button">{label ?? 'Help'}</button>,
}));

vi.mock('@/features/analysis/common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/analysis/common/components/AnalysisRunningStateCard', () => ({
  AnalysisRunningStateCard: () => <div>running</div>,
}));

vi.mock('../results/TokenFrequencySingleTokenSection', () => ({
  TokenFrequencySingleTokenSection: () => <div>single section</div>,
}));

vi.mock('../results/TokenFrequencyUnifiedTokenSection', () => ({
  TokenFrequencyUnifiedTokenSection: () => <div>unified section</div>,
}));

describe('TokenFrequencyResultsPanel', () => {
  it('shows stop-word actions without extra helper text under the buttons', () => {
    render(
      <TokenFrequencyResultsPanel
        results={{ state: 'successful', message: 'ok', data: {}, statistics: [] } as never}
        isRunning={false}
        runningTask={null}
        stopWords=""
        onStopWordsChange={vi.fn()}
        onStopWordsApply={vi.fn()}
        isLoadingStopWords={false}
        onFillDefaultStopWords={vi.fn()}
        onSortStopWords={vi.fn()}
        tokenLimitInput="25"
        onTokenLimitInputChange={vi.fn()}
        onTokenLimitBlur={vi.fn()}
        tokenLimitError={null}
        isApplyingTokenLimit={false}
        appliedStopCount={0}
        normalizedNodeResults={[]}
        nodeDisplayResults={[]}
        lastCompareNodeIds={[]}
        appliedStopSet={new Set()}
        effectiveTokenLimit={25}
        defaultTokenLimit={25}
        computeDisplayName={vi.fn()}
        getColorForNode={vi.fn()}
        onDownloadWordCloud={vi.fn()}
        onTokenClick={vi.fn()}
        onTokenRightClick={vi.fn()}
        unifiedCloudWidth={600}
        unifiedCloudHeight={400}
        unifiedCloudContainerRef={{ current: null }}
        registerWordCloudRef={vi.fn()}
        onDownloadFrequencyCsv={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Apply Stop Words' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fill Default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About default stop words' })).toBeInTheDocument();
    expect(screen.getByText('Currently displaying top 25 tokens per table (default: 25).')).toBeInTheDocument();
    expect(screen.queryByText('Bundled default stop words')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Fill Default loads the bundled English stop-word list shipped with the app/i)
    ).not.toBeInTheDocument();
  });
});