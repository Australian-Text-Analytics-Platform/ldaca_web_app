import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TokenFrequencyResponse } from '@/api';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TokenFrequencyResultsPanel } from '../TokenFrequencyResultsPanel';

vi.mock('@/components/help/HelpIcon', () => ({ default: () => null }));
const { singleSectionSpy, unifiedSectionSpy } = vi.hoisted(() => ({
  singleSectionSpy: vi.fn(),
  unifiedSectionSpy: vi.fn(),
}));

vi.mock('../../results/TokenFrequencySingleTokenSection', () => ({
  TokenFrequencySingleTokenSection: (props: unknown) => {
    singleSectionSpy(props);
    return null;
  },
}));
vi.mock('../../results/TokenFrequencyUnifiedTokenSection', () => ({
  TokenFrequencyUnifiedTokenSection: (props: unknown) => {
    unifiedSectionSpy(props);
    return null;
  },
}));

const baseProps = {
  results: { statistics: [] } as unknown as TokenFrequencyResponse,
  isRunning: false,
  stopWords: 'the, and',
  onStopWordsChange: vi.fn(),
  onStopWordsApply: vi.fn(),
  isLoadingStopWords: false,
  onFillDefaultStopWords: vi.fn(),
  onSortStopWords: vi.fn(),
  stopWordsEnabled: false,
  onStopWordsEnabledChange: vi.fn(),
  tokenLimitInput: '25',
  onTokenLimitInputChange: vi.fn(),
  onTokenLimitBlur: vi.fn(),
  applyCloudTokenLimit: vi.fn(),
  tokenLimitError: null,
  isApplyingTokenLimit: false,
  appliedStopCount: 2,
  normalizedNodeResults: [],
  nodeDisplayResults: [],
  lastCompareNodeIds: [],
  appliedStopSet: new Set<string>(),
  effectiveTokenLimit: 25,
  defaultTokenLimit: 25,
  computeDisplayName: vi.fn((nodeId: string) => nodeId),
  getColorForNode: vi.fn(() => '#2563eb'),
  onDownloadWordCloud: vi.fn(),
  onTokenClick: vi.fn(),
  onTokenRightClick: vi.fn(),
  unifiedCloudWidth: 640,
  unifiedCloudHeight: 340,
  unifiedCloudContainerRef: { current: null },
  registerWordCloudRef: vi.fn(),
  onDownloadFrequencyCsv: vi.fn(),
};

describe('TokenFrequencyResultsPanel stop words', () => {
  it('preserves saved words while disabled and exposes the enable action', async () => {
    const user = userEvent.setup();
    const onStopWordsEnabledChange = vi.fn();
    render(
      <TooltipProvider>
        <TokenFrequencyResultsPanel
          {...baseProps}
          onStopWordsEnabledChange={onStopWordsEnabledChange}
        />
      </TooltipProvider>,
    );

    const editor = screen.getByRole('textbox', { name: 'Stop words filter (2)' });
    expect(editor).toHaveValue('the, and');
    expect(editor).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply Stop Words' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Default' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sort' })).toBeDisabled();

    await user.click(screen.getByRole('switch', { name: 'Enable stop words' }));
    expect(onStopWordsEnabledChange).toHaveBeenCalledWith(true);
  });

  it('places one persistent result-level filter before the Cloud/List selector', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TooltipProvider>
        <TokenFrequencyResultsPanel {...baseProps} />
      </TooltipProvider>,
    );

    const filterCard = screen.getByTestId('token-frequency-token-filter-card');
    const filterInput = screen.getByRole('textbox', { name: 'Filter tokens' });
    const viewTabs = screen.getByTestId('token-frequency-results-view-tabs');

    expect(filterCard.compareDocumentPosition(viewTabs)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getAllByText('Filter tokens')).toHaveLength(1);
    expect(screen.getByTestId('token-frequency-token-filter-card-content')).toHaveClass('flex-wrap');

    await user.type(filterInput, 'pre*');
    await waitFor(() => {
      expect(singleSectionSpy.mock.lastCall?.[0]).toMatchObject({ tokenFilter: 'pre*' });
      expect(unifiedSectionSpy.mock.lastCall?.[0]).toMatchObject({ tokenFilter: 'pre*' });
    });

    await user.click(screen.getByRole('tab', { name: 'List view' }));
    expect(filterInput).toHaveValue('pre*');

    rerender(
      <TooltipProvider>
        <TokenFrequencyResultsPanel
          {...baseProps}
          results={{ statistics: [] } as unknown as TokenFrequencyResponse}
        />
      </TooltipProvider>,
    );
    expect(filterInput).toHaveValue('pre*');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(filterInput).toHaveValue('');
  });
});
