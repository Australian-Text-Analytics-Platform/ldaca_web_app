import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenFrequencySingleTokenSection } from '../TokenFrequencySingleTokenSection';
import { TokenFrequencyUnifiedTokenSection } from '../TokenFrequencyUnifiedTokenSection';
import type {
  NodeResultView,
  TokenFrequencyStatisticsEntry,
} from '@/features/views/token-frequency/tokenFrequencyAdapters';

vi.mock('@/components/help/HelpIcon', () => ({
  /** Used by: HelpIcon mock module factory so layout assertions can ignore tutorial wiring because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  default: () => <span data-testid="help-icon" />,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  /** Used by: InfoIcon mock module factory so tests do not depend on shared chrome because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  default: () => <span data-testid="info-icon" />,
}));

vi.mock('@visx/wordcloud', () => ({
  /** Used by: Wordcloud mock module factory to render deterministic cloud words without d3 layout because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  Wordcloud: ({
    children,
    words,
  }: {
    children: (cloudWords: Record<string, unknown>[]) => React.ReactNode;
    words: Record<string, unknown>[];
  }) => (
    <g data-testid="mock-wordcloud">
      {children(
        words.map((word, index) => ({
          ...word,
          x: index * 10,
          y: index * 12,
          rotate: 0,
          size: 18,
          font: 'sans-serif',
        })),
      )}
    </g>
  ),
}));

vi.mock('@visx/text', () => ({
  /** Used by: Text mock module factory to replace VisX text with a plain SVG element because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  Text: ({ children, ...props }: React.SVGProps<SVGTextElement>) => (
    <text {...props}>{children}</text>
  ),
}));

/**
 * Used by: token-frequency result layout tests to build normalized node-result fixtures because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Flow: arrange the fixture, exercise the focused analysis path, then assert the observable result.
 */
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

/** Used by: TokenFrequencySingleTokenSection layout tests as overridable per-node default props because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
const baseSingleSectionProps = {
  /** Used by: baseSingleSectionProps to supply a stable swatch for every mocked node because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  getColorForNode: () => '#3b82f6',
  onTokenClick: vi.fn(),
  onTokenRightClick: vi.fn(),
  onDownloadWordCloud: vi.fn(),
  onDownloadFrequencyCsv: vi.fn(),
  registerWordCloudRef: vi.fn(),
  view: 'cloud' as const,
};

/**
 * Used by: unified token-frequency layout tests to build comparative statistics fixtures because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Flow: arrange the fixture, exercise the focused analysis path, then assert the observable result.
 */
const buildStatistic = (
  overrides: Partial<TokenFrequencyStatisticsEntry> = {},
): TokenFrequencyStatisticsEntry => ({
  token: overrides.token ?? 'alpha',
  freq_reference: overrides.freq_reference ?? 18,
  percent_reference: overrides.percent_reference ?? 0.6,
  freq_study: overrides.freq_study ?? 12,
  percent_study: overrides.percent_study ?? 0.4,
  log_likelihood_llv: overrides.log_likelihood_llv ?? 3.1,
  percent_diff: overrides.percent_diff ?? 0.2,
  expected_reference: overrides.expected_reference ?? 15,
  expected_study: overrides.expected_study ?? 15,
  reference_total: overrides.reference_total ?? 30,
  study_total: overrides.study_total ?? 30,
  bayes_factor_bic: overrides.bayes_factor_bic ?? 1.4,
  effect_size_ell: overrides.effect_size_ell ?? 0.8,
  relative_risk: overrides.relative_risk ?? 1.2,
  log_ratio: overrides.log_ratio ?? 0.3,
  odds_ratio: overrides.odds_ratio ?? 1.1,
  significance: overrides.significance ?? '**',
});

/** Used by: TokenFrequencyUnifiedTokenSection layout tests as overridable unified-section defaults because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
const baseUnifiedSectionProps = {
  normalizedNodeResults: [buildNodeResult()],
  nodeDisplayResults: [buildNodeResult()],
  lastCompareNodeIds: [] as string[],
  statistics: [] as TokenFrequencyStatisticsEntry[],
  appliedStopSet: new Set<string>(),
  effectiveTokenLimit: 25,
  defaultTokenLimit: 25,
  /** Used by: baseUnifiedSectionProps to echo node IDs as predictable display names because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  computeDisplayName: (nodeId: string) => nodeId,
  /** Used by: baseUnifiedSectionProps to supply a stable swatch for the unified cloud fixture because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
  getColorForNode: () => '#3b82f6',
  onDownloadWordCloud: vi.fn(),
  onTokenClick: vi.fn(),
  onTokenRightClick: vi.fn(),
  unifiedCloudWidth: 640,
  unifiedCloudHeight: 340,
  unifiedCloudContainerRef: { current: null },
  registerWordCloudRef: vi.fn(),
  onDownloadFrequencyCsv: vi.fn(),
  view: 'cloud' as const,
};

describe('Token frequency result layouts', () => {
  it('renders all configured tokens instead of truncating after thirty', () => {
    const displayRows = Array.from({ length: 50 }, (_, index) => ({
      token: `token-${String(index + 1)}`,
      frequency: 50 - index,
    }));

    render(
      <TokenFrequencySingleTokenSection
        {...baseSingleSectionProps}
        nodeDisplayResults={[
          buildNodeResult({
            displayRows,
            filteredRows: displayRows,
            rows: displayRows,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('token-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('token-50').length).toBeGreaterThan(0);
  });

  it('shows the unified card only when two node results are available', () => {
    const { rerender } = render(<TokenFrequencyUnifiedTokenSection {...baseUnifiedSectionProps} />);

    expect(screen.queryByText('Juxtorpus')).not.toBeInTheDocument();

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
      />,
    );

    expect(screen.getByText('Juxtorpus')).toBeInTheDocument();
  });
});
