import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AnalysisFeatureHeader } from '../AnalysisFeatureHeader';

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
    expect(
      screen.getByLabelText(/about concordance search/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/concordance parameters/i),
    ).toBeInTheDocument();
  });

  it('the snapshot actions slot is empty when demo mode is off', () => {
    renderHeader();
    const slot = screen.getByTestId('analysis-feature-header-actions');
    expect(slot.children.length).toBe(0);
  });

  it('the slot is still present (and empty in Phase 0j) once demo mode flips on', () => {
    // SnapshotActions returns null in Phase 0j even when enabled —
    // the real Save/Load buttons land in Phase 1. This test pins
    // down the gate so a regression in Phase 1 shows up immediately.
    renderHeader();
    act(() => {
      usePreferencesStore.getState().setDemoSnapshotsEnabled(true);
    });
    const slot = screen.getByTestId('analysis-feature-header-actions');
    expect(slot).toBeInTheDocument();
  });
});
