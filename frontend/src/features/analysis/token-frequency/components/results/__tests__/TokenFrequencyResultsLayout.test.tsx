import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenFrequencySingleTokenSection } from '../TokenFrequencySingleTokenSection';
import { TokenFrequencyUnifiedTokenSection } from '../TokenFrequencyUnifiedTokenSection';
import type { NodeResultView, TokenFrequencyStatisticsEntry } from '../../../tokenFrequencyAdapters';

vi.mock('@/components/help/HelpIcon', () => ({
  default: () => <span data-testid="help-icon" />,
}));

vi.mock('@visx/wordcloud', () => ({
  Wordcloud: ({ children, words }: { children: (cloudWords: Array<Record<string, unknown>>) => React.ReactNode; words: Array<Record<string, unknown>> }) => (
    <g data-testid="mock-wordcloud">
      {children(
        words.map((word, index) => ({
          ...word,
          x: index * 10,
          y: index * 12,
          rotate: 0,
          size: 18,
          font: 'sans-serif',
        }))
      )}
    </g>
  ),
}));

vi.mock('@visx/text', () => ({
  Text: ({ children, ...props }: React.SVGProps<SVGTextElement>) => <text {...props}>{children}</text>,
}));

const buildNodeResult = (overrides: Partial<NodeResultView> = {}): NodeResultView => ({
  nodeId: overrides.nodeId ?? 'node-1',
  displayName: overrides.displayName ?? 'Node 1',
  rows: overrides.rows ?? [{ token: 'alpha', frequency: 12 }],
  metadata: overrides.metadata ?? {},
  filteredRows: overrides.filteredRows ?? [{ token: 'alpha', frequency: 12 }],
  displayRows: overrides.displayRows ?? [{ token: 'alpha', frequency: 12 }],
  filteredOutCount: overrides.filteredOutCount ?? 0,
  appliedDisplayLimit: overrides.appliedDisplayLimit ?? 30,
  maxFrequency: overrides.maxFrequency ?? 12,
});

const baseSingleSectionProps = {
  getColorForNode: () => '#3b82f6',
  onTokenClick: vi.fn(),
  onTokenRightClick: vi.fn(),
  onDownloadWordCloud: vi.fn(),
  onDownloadFrequencyCsv: vi.fn(),
  registerWordCloudRef: vi.fn(),
};

const buildStatistic = (overrides: Partial<TokenFrequencyStatisticsEntry> = {}): TokenFrequencyStatisticsEntry => ({
  token: overrides.token ?? 'alpha',
  freq_corpus_0: overrides.freq_corpus_0 ?? 18,
  percent_corpus_0: overrides.percent_corpus_0 ?? 0.6,
  freq_corpus_1: overrides.freq_corpus_1 ?? 12,
  percent_corpus_1: overrides.percent_corpus_1 ?? 0.4,
  log_likelihood_llv: overrides.log_likelihood_llv ?? 3.1,
  percent_diff: overrides.percent_diff ?? 0.2,
  bayes_factor_bic: overrides.bayes_factor_bic ?? 1.4,
  effect_size_ell: overrides.effect_size_ell ?? 0.8,
  relative_risk: overrides.relative_risk ?? 1.2,
  log_ratio: overrides.log_ratio ?? 0.3,
  odds_ratio: overrides.odds_ratio ?? 1.1,
  significance: overrides.significance ?? '**',
});

const baseUnifiedSectionProps = {
  normalizedNodeResults: [buildNodeResult()],
  nodeDisplayResults: [buildNodeResult()],
  lastCompareNodeIds: [] as string[],
  statistics: [] as TokenFrequencyStatisticsEntry[],
  appliedStopSet: new Set<string>(),
  effectiveTokenLimit: 100,
  defaultTokenLimit: 100,
  computeDisplayName: (nodeId: string) => nodeId,
  getColorForNode: () => '#3b82f6',
  onDownloadWordCloud: vi.fn(),
  onTokenClick: vi.fn(),
  onTokenRightClick: vi.fn(),
  unifiedCloudWidth: 640,
  unifiedCloudHeight: 340,
  unifiedCloudContainerRef: { current: null },
  registerWordCloudRef: vi.fn(),
  sortedStatistics: [] as TokenFrequencyStatisticsEntry[],
  statsSortColumn: 'log_likelihood_llv',
  statsSortDirection: 'desc' as const,
  onToggleStatsSort: vi.fn(),
  statsPage: 1,
  onStatsPageChange: vi.fn(),
  statsRowsPerPage: 25,
  onStatsRowsPerPageChange: vi.fn(),
  onDownloadFrequencyCsv: vi.fn(),
  statsTokenFilter: '',
  onStatsTokenFilterChange: vi.fn(),
};

describe('Token frequency result layouts', () => {
  it('lets long node names wrap and keeps a single node card at full width', () => {
    const longName = 'sample_data/ADO/qldelection2020_candidate_tweets_with_an_extremely_long_name_that_should_wrap';
    render(
      <TokenFrequencySingleTokenSection
        {...baseSingleSectionProps}
        nodeDisplayResults={[buildNodeResult({ displayName: longName })]}
      />
    );

    const grid = screen.getByTestId('token-frequency-single-layout');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).not.toHaveClass('xl:grid-cols-2');

    const title = screen.getByText(longName);
    expect(title).toHaveClass('min-w-0', 'break-words', 'whitespace-normal');

    const actionRow = screen.getByTestId('token-frequency-actions-node-1');
    expect(actionRow).toHaveClass('flex-wrap');
  });

  it('shows the unified card only when two node results are available', () => {
    const { rerender } = render(<TokenFrequencyUnifiedTokenSection {...baseUnifiedSectionProps} />);

    expect(screen.queryByText('Unified Word Cloud')).not.toBeInTheDocument();

    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Node A' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Node B' });
    const statistics = [buildStatistic()];

    rerender(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[nodeA, nodeB]}
        nodeDisplayResults={[nodeA, nodeB]}
        lastCompareNodeIds={['node-a', 'node-b']}
        statistics={statistics}
        sortedStatistics={statistics}
      />
    );

    expect(screen.getByText('Unified Word Cloud')).toBeInTheDocument();
  });
});