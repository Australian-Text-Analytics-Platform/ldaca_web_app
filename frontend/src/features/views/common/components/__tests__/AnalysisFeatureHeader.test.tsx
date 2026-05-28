import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AnalysisFeatureHeader } from '../AnalysisFeatureHeader';

/**
 * Renders the header with the providers SnapshotActions needs even when the test
 * only asserts that demo snapshot controls stay hidden.
 * Used by: AnalysisFeatureHeader tests because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
function renderHeader() {
  // SnapshotActions uses useQuery to fetch the snapshot list for
  // collision-checking; it needs a QueryClient even when the demo
  // mode is off (component still renders the SnapshotActions tree,
  // which uses the hook unconditionally before its early return).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AnalysisFeatureHeader
          tool="concordance"
          title="Concordance Search"
          infoKey="concordance.overview"
          infoLabel="About Concordance Search"
          helpKey="analysis.concordance.parameters"
          helpLabel="Concordance parameters"
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('AnalysisFeatureHeader', () => {
  let originalSnapshot: ReturnType<typeof usePreferencesStore.getState>;

  beforeEach(() => {
    originalSnapshot = usePreferencesStore.getState();
    act(() => {
      usePreferencesStore.getState().setDemoSnapshotsEnabled(false);
    });
  });

  afterEach(() => {
    act(() => {
      usePreferencesStore.setState(originalSnapshot, true);
    });
  });

  it('renders the title and info/help icons', () => {
    renderHeader();
    expect(screen.getByText('Concordance Search')).toBeInTheDocument();
    expect(screen.getByLabelText(/about concordance search/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/concordance parameters/i)).toBeInTheDocument();
  });

  it('the snapshot actions slot is empty when demo mode is off', () => {
    renderHeader();
    const slot = screen.getByTestId('analysis-feature-header-actions');
    expect(slot).toBeEmptyDOMElement();
  });
});
