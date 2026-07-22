import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  NodeResultView,
  TokenFrequencyStatisticsEntry,
} from '@/features/views/token-frequency/tokenFrequencyAdapters';
import { TokenFrequencySingleTokenSection } from '../TokenFrequencySingleTokenSection';
import { TokenFrequencyUnifiedTokenSection } from '../TokenFrequencyUnifiedTokenSection';

vi.mock('@/components/help/HelpIcon', () => ({
  default: () => <span data-testid="help-icon" />,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  default: () => <span data-testid="info-icon" />,
}));

vi.mock('@visx/wordcloud', () => ({
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
  Text: ({ children, ...props }: React.SVGProps<SVGTextElement>) => (
    <text {...props}>{children}</text>
  ),
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
  view: 'cloud' as const,
};

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

const baseUnifiedSectionProps = {
  normalizedNodeResults: [buildNodeResult()],
  nodeDisplayResults: [buildNodeResult()],
  lastCompareNodeIds: [] as string[],
  statistics: [] as TokenFrequencyStatisticsEntry[],
  appliedStopSet: new Set<string>(),
  effectiveTokenLimit: 25,
  defaultTokenLimit: 25,
  computeDisplayName: (nodeId: string) => nodeId,
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
  tokenFilter: '',
  onTokenFilterChange: vi.fn(),
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

  it('shows the unified card only when two node results are available', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TokenFrequencyUnifiedTokenSection {...baseUnifiedSectionProps} />);

    expect(screen.queryByText('Juxtorpus')).not.toBeInTheDocument();

    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Reference Data Block' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Study Data Block' });
    const statistics = [buildStatistic()];

    rerender(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[nodeA, nodeB]}
        nodeDisplayResults={[nodeA, nodeB]}
        lastCompareNodeIds={['node-a', 'node-b']}
        statistics={statistics}
        computeDisplayName={(nodeId) =>
          nodeId === 'node-a' ? 'Reference Data Block' : 'Study Data Block'
        }
        getColorForNode={(_nodeId, index) => (index === 0 ? '#2563eb' : '#dc2626')}
      />,
    );

    expect(screen.getByText('Juxtorpus')).toBeInTheDocument();
    expect(screen.queryByText('Reference Data Block')).not.toBeInTheDocument();
    expect(screen.queryByText('Study Data Block')).not.toBeInTheDocument();
    const colorScale = within(screen.getByLabelText('Reference to Study color scale'));
    expect(colorScale.getByText('Reference')).toBeInTheDocument();
    expect(colorScale.getByText('Study')).toBeInTheDocument();

    const referenceTrigger = colorScale.getByLabelText('Reference: Reference Data Block');
    const studyTrigger = colorScale.getByLabelText('Study: Study Data Block');

    expect(referenceTrigger).toHaveTextContent('Reference');
    expect(studyTrigger).toHaveTextContent('Study');

    await user.hover(referenceTrigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reference Data Block');
  });

  it('shows the Study Data Block name from the combined Study legend trigger', async () => {
    const user = userEvent.setup();
    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Reference Data Block' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Study Data Block' });

    render(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[nodeA, nodeB]}
        nodeDisplayResults={[nodeA, nodeB]}
        lastCompareNodeIds={['node-a', 'node-b']}
        statistics={[buildStatistic()]}
      />,
    );

    const colorScale = within(screen.getByLabelText('Reference to Study color scale'));
    const studyTrigger = colorScale.getByLabelText('Study: Study Data Block');

    expect(studyTrigger).toHaveTextContent('Study');
    await user.hover(studyTrigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Study Data Block');
  });

  it('keeps comparison roles tied to result identity when panel order is reversed', () => {
    const reference = buildNodeResult({
      nodeId: 'reference-node',
      displayName: 'Reference Data Block',
    });
    const study = buildNodeResult({ nodeId: 'study-node', displayName: 'Study Data Block' });

    render(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[study, reference]}
        nodeDisplayResults={[study, reference]}
        lastCompareNodeIds={['reference-node', 'study-node']}
        statistics={[buildStatistic()]}
      />,
    );

    const colorScale = within(screen.getByLabelText('Reference to Study color scale'));
    expect(colorScale.getByLabelText('Reference: Reference Data Block')).toBeInTheDocument();
    expect(colorScale.getByLabelText('Study: Study Data Block')).toBeInTheDocument();
  });

  it('keeps the token filter and compact corpus legend inside the statistics card', async () => {
    const user = userEvent.setup();
    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Reference Data Block' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Study Data Block' });

    render(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[nodeA, nodeB]}
        nodeDisplayResults={[nodeA, nodeB]}
        lastCompareNodeIds={['node-a', 'node-b']}
        statistics={[buildStatistic()]}
        computeDisplayName={(nodeId) =>
          nodeId === 'node-a' ? 'Reference Data Block' : 'Study Data Block'
        }
        view="list"
      />,
    );

    const statisticsCard = screen.getByRole('region', {
      name: 'Keyword Analysis statistics',
    });

    expect(within(statisticsCard).getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Filter tokens (use * as wildcard, e.g. pre* or *ing)',
    );
    expect(
      within(statisticsCard).getByLabelText('Reference: Reference Data Block'),
    ).toBeInTheDocument();
    expect(within(statisticsCard).getByLabelText('Study: Study Data Block')).toBeInTheDocument();
    expect(within(statisticsCard).queryByText(/Reference corpus:/)).toBeNull();

    await user.hover(within(statisticsCard).getByLabelText('Reference: Reference Data Block'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reference Data Block');

    expect(within(statisticsCard).getByLabelText('Study: Study Data Block')).toBeInTheDocument();
  });

  it.each([
    ['Token', 'The token being compared across the Reference and Study Data Blocks.'],
    ['OR', 'Observed frequency: the token count in the Reference Data Block.'],
    ['%R', 'The token count as a percentage of all tokens in the Reference Data Block.'],
    ['OS', 'Observed frequency: the token count in the Study Data Block.'],
    ['%S', 'The token count as a percentage of all tokens in the Study Data Block.'],
    [
      'LL',
      'Log-likelihood score measuring the strength of the frequency difference between the two Data Blocks.',
    ],
    ['Overuse', 'Which Data Block has the higher observed token frequency: Reference or Study.'],
    [
      'Signed LL',
      'The log-likelihood score, positive when Study has the higher frequency and negative when Reference does.',
    ],
    [
      '%DIFF',
      'Reference relative frequency minus Study relative frequency, shown as a percentage.',
    ],
    [
      'Bayes',
      'A BIC-adjusted evidence score for the frequency difference; larger values indicate stronger evidence.',
    ],
    [
      'ELL',
      'ELL effect-size estimate for the frequency difference, adjusted for corpus size and expected frequency.',
    ],
    [
      'RRisk',
      'Reference relative frequency divided by Study relative frequency; 1 means equal relative frequency.',
    ],
    [
      'LogRatio',
      'Natural logarithm of the Reference-to-Study relative-frequency ratio; 0 means equal relative frequency.',
    ],
    ['OddsRatio', 'Reference token odds divided by Study token odds; 1 means equal odds.'],
    [
      'Significance',
      'Significance level derived from log likelihood: more stars indicate stronger evidence of a difference.',
    ],
  ])('immediately explains the %s statistics header', async (header, explanation) => {
    const user = userEvent.setup();
    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Reference Data Block' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Study Data Block' });

    render(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[nodeA, nodeB]}
        nodeDisplayResults={[nodeA, nodeB]}
        lastCompareNodeIds={['node-a', 'node-b']}
        statistics={[buildStatistic()]}
        view="list"
      />,
    );

    const statisticsCard = screen.getByRole('region', {
      name: 'Keyword Analysis statistics',
    });
    await user.hover(within(statisticsCard).getByRole('button', { name: header }));

    expect(screen.getByRole('tooltip')).toHaveTextContent(explanation);
  });

  it('labels numeric-string frequency direction as Reference or Study', () => {
    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Reference Data Block' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Study Data Block' });

    render(
      <TokenFrequencyUnifiedTokenSection
        {...baseUnifiedSectionProps}
        normalizedNodeResults={[nodeA, nodeB]}
        nodeDisplayResults={[nodeA, nodeB]}
        lastCompareNodeIds={['node-a', 'node-b']}
        statistics={[
          buildStatistic({ token: 'reference-token', freq_reference: '59', freq_study: '8' }),
          buildStatistic({ token: 'study-token', freq_reference: '8', freq_study: '59' }),
        ]}
        getColorForNode={(_nodeId, index) => (index === 0 ? '#2563eb' : '#dc2626')}
        view="list"
      />,
    );

    const statisticsCard = within(
      screen.getByRole('region', {
        name: 'Keyword Analysis statistics',
      }),
    );
    const referenceBadge = within(
      statisticsCard.getByRole('row', { name: /reference-token/ }),
    ).getByText('Reference');
    const studyBadge = within(statisticsCard.getByRole('row', { name: /study-token/ })).getByText(
      'Study',
    );

    expect(referenceBadge).toHaveStyle({ backgroundColor: '#2563eb' });
    expect(studyBadge).toHaveStyle({ backgroundColor: '#dc2626' });
  });
});
