import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** Supplies the layout boundary that JSDOM omits so TanStack Virtual can determine a visible range. */
const mockVirtualListViewport = () => {
  const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);

  return () => {
    offsetHeight.mockRestore();
    offsetWidth.mockRestore();
  };
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

  it('does not mount list rows while the cloud view is active', () => {
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

    expect(
      screen.queryAllByTitle('Click to inspect in concordance. Right-click to add to stop words.'),
    ).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Download word cloud' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download frequencies' })).not.toBeInTheDocument();
  });

  it('keeps full-vocabulary list DOM bounded to the visible window', async () => {
    const restoreViewport = mockVirtualListViewport();
    const fullVocabulary = Array.from({ length: 5_068 }, (_, index) => ({
      token: `token-${String(index + 1)}`,
      frequency: 5_068 - index,
    }));
    const cloudRows = fullVocabulary.slice(0, 25);

    try {
      render(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={5_068}
          nodeDisplayResults={[
            buildNodeResult({
              nodeId: 'node-a',
              displayName: 'Data Block A',
              rows: fullVocabulary,
              filteredRows: fullVocabulary,
              displayRows: cloudRows,
            }),
            buildNodeResult({
              nodeId: 'node-b',
              displayName: 'Data Block B',
              rows: fullVocabulary,
              filteredRows: fullVocabulary,
              displayRows: cloudRows,
            }),
          ]}
        />,
      );

      const mountedTokenRows = await screen.findAllByTitle(
        'Click to inspect in concordance. Right-click to add to stop words.',
      );
      expect(mountedTokenRows.length).toBeGreaterThan(0);
      expect(mountedTokenRows.length).toBeLessThan(100);
      expect(screen.queryByText('token-5068')).not.toBeInTheDocument();
    } finally {
      restoreViewport();
    }
  });

  it('scrolls to the final token and keeps paired full-vocabulary lists aligned', async () => {
    const restoreViewport = mockVirtualListViewport();
    const fullVocabulary = Array.from({ length: 5_068 }, (_, index) => ({
      token: `token-${String(index + 1)}`,
      frequency: 5_068 - index,
    }));

    try {
      render(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={5_068}
          nodeDisplayResults={[
            buildNodeResult({
              nodeId: 'node-a',
              displayName: 'Data Block A',
              rows: fullVocabulary,
              filteredRows: fullVocabulary,
              displayRows: fullVocabulary.slice(0, 25),
            }),
            buildNodeResult({
              nodeId: 'node-b',
              displayName: 'Data Block B',
              rows: fullVocabulary,
              filteredRows: fullVocabulary,
              displayRows: fullVocabulary.slice(0, 25),
            }),
          ]}
        />,
      );

      const lists = screen.getAllByRole('list');
      const bottomOffset = 5_068 * 40 - 400;
      lists[0].scrollTop = bottomOffset;
      fireEvent.scroll(lists[0]);

      await waitFor(() => {
        expect(screen.getAllByText('token-5068').length).toBeGreaterThan(0);
      });
      expect(lists[1].scrollTop).toBe(bottomOffset);
    } finally {
      restoreViewport();
    }
  });

  it('preserves actions and full CSV exports on virtualized rows', async () => {
    const restoreViewport = mockVirtualListViewport();
    const user = userEvent.setup();
    const onTokenClick = vi.fn();
    const onTokenRightClick = vi.fn();
    const onDownloadFrequencyCsv = vi.fn();
    const fullVocabulary = Array.from({ length: 100 }, (_, index) => ({
      token: `token-${String(index + 1)}`,
      frequency: 100 - index,
    }));

    try {
      render(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={100}
          nodeDisplayResults={[
            buildNodeResult({
              rows: fullVocabulary,
              filteredRows: fullVocabulary,
              displayRows: fullVocabulary.slice(0, 25),
            }),
          ]}
          onTokenClick={onTokenClick}
          onTokenRightClick={onTokenRightClick}
          onDownloadFrequencyCsv={onDownloadFrequencyCsv}
        />,
      );

      const firstToken = await screen.findByText('token-1');
      await user.click(firstToken);
      fireEvent.contextMenu(firstToken);
      await user.click(screen.getByRole('button', { name: 'Download frequencies' }));

      expect(onTokenClick).toHaveBeenCalledWith('token-1');
      expect(onTokenRightClick).toHaveBeenCalledWith('token-1', expect.anything());
      expect(onDownloadFrequencyCsv).toHaveBeenCalledWith('Node 1', fullVocabulary);
    } finally {
      restoreViewport();
    }
  });

  it('preserves cloud downloads and SVG ref registration across view toggles', async () => {
    const user = userEvent.setup();
    const onDownloadWordCloud = vi.fn();
    const registerWordCloudRef = vi.fn();
    const nodeDisplayResults = [buildNodeResult()];
    const { rerender } = render(
      <TokenFrequencySingleTokenSection
        {...baseSingleSectionProps}
        nodeDisplayResults={nodeDisplayResults}
        onDownloadWordCloud={onDownloadWordCloud}
        registerWordCloudRef={registerWordCloudRef}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Download word cloud' }));
    expect(onDownloadWordCloud).toHaveBeenCalledWith('node-1', 'Node 1');
    expect(registerWordCloudRef).toHaveBeenCalledWith('node-1', expect.any(SVGSVGElement));

    rerender(
      <TokenFrequencySingleTokenSection
        {...baseSingleSectionProps}
        view="list"
        nodeDisplayResults={nodeDisplayResults}
        onDownloadWordCloud={onDownloadWordCloud}
        registerWordCloudRef={registerWordCloudRef}
      />,
    );

    expect(registerWordCloudRef).toHaveBeenCalledWith('node-1', null);
    expect(screen.queryByRole('button', { name: 'Download word cloud' })).not.toBeInTheDocument();
  });

  it('keeps original ranks and resets scrolling when the list filter changes', async () => {
    const restoreViewport = mockVirtualListViewport();
    const fullVocabulary = Array.from({ length: 100 }, (_, index) => ({
      token: `token-${String(index + 1)}`,
      frequency: 100 - index,
    }));
    const nodeDisplayResults = [
      buildNodeResult({
        rows: fullVocabulary,
        filteredRows: fullVocabulary,
        displayRows: fullVocabulary.slice(0, 25),
      }),
    ];

    try {
      const { rerender } = render(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={100}
          nodeDisplayResults={nodeDisplayResults}
        />,
      );
      const list = screen.getByRole('list');
      list.scrollTop = 660;
      fireEvent.scroll(list);

      rerender(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={100}
          tokenFilter="token-50"
          nodeDisplayResults={nodeDisplayResults}
        />,
      );

      await waitFor(() => {
        expect(list.scrollTop).toBe(0);
        expect(screen.getByText('token-50')).toBeInTheDocument();
      });
      expect(screen.getByText('50.')).toBeInTheDocument();
    } finally {
      restoreViewport();
    }
  });

  it('retains the shared list offset across Cloud and List toggles', async () => {
    const restoreViewport = mockVirtualListViewport();
    const fullVocabulary = Array.from({ length: 100 }, (_, index) => ({
      token: `token-${String(index + 1)}`,
      frequency: 100 - index,
    }));
    const nodeDisplayResults = [
      buildNodeResult({
        rows: fullVocabulary,
        filteredRows: fullVocabulary,
        displayRows: fullVocabulary.slice(0, 25),
      }),
    ];

    try {
      const { rerender } = render(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={100}
          nodeDisplayResults={nodeDisplayResults}
        />,
      );
      const list = screen.getByRole('list');
      list.scrollTop = 660;
      fireEvent.scroll(list);

      rerender(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="cloud"
          listLimit={100}
          nodeDisplayResults={nodeDisplayResults}
        />,
      );
      expect(screen.queryByRole('list')).not.toBeInTheDocument();

      rerender(
        <TokenFrequencySingleTokenSection
          {...baseSingleSectionProps}
          view="list"
          listLimit={100}
          nodeDisplayResults={nodeDisplayResults}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('list').scrollTop).toBe(660);
      });
    } finally {
      restoreViewport();
    }
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

  it('mounts only the active Juxtorpus or statistics surface', () => {
    const nodeA = buildNodeResult({ nodeId: 'node-a', displayName: 'Reference Data Block' });
    const nodeB = buildNodeResult({ nodeId: 'node-b', displayName: 'Study Data Block' });
    const comparativeProps = {
      ...baseUnifiedSectionProps,
      normalizedNodeResults: [nodeA, nodeB],
      nodeDisplayResults: [nodeA, nodeB],
      lastCompareNodeIds: ['node-a', 'node-b'],
      statistics: [buildStatistic()],
    };
    const { rerender } = render(
      <TokenFrequencyUnifiedTokenSection {...comparativeProps} view="list" />,
    );

    expect(screen.getByRole('region', { name: 'Keyword Analysis statistics' })).toBeInTheDocument();
    expect(screen.queryByText('Juxtorpus')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-wordcloud')).not.toBeInTheDocument();

    rerender(<TokenFrequencyUnifiedTokenSection {...comparativeProps} view="cloud" />);

    expect(screen.getByText('Juxtorpus')).toBeInTheDocument();
    expect(screen.getByTestId('mock-wordcloud')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Keyword Analysis statistics' }),
    ).not.toBeInTheDocument();
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
