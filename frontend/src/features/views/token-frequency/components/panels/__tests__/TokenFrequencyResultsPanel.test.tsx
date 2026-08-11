import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TokenFrequencyResponse } from '@/api';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TokenFrequencyResultsPanel } from '../TokenFrequencyResultsPanel';

vi.mock('@/components/help/HelpIcon', () => ({ default: () => null }));
vi.mock('../../results/TokenFrequencySingleTokenSection', () => ({
  TokenFrequencySingleTokenSection: () => null,
}));
vi.mock('../../results/TokenFrequencyUnifiedTokenSection', () => ({
  TokenFrequencyUnifiedTokenSection: () => null,
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
});
