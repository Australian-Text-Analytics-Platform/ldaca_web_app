import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '@/stores/uiStore';
import { GlobalHosts } from '../GlobalHosts';

vi.mock('@/features/feedback/components/FeedbackPanel', () => ({
  FeedbackPanel: () => <div data-testid="feedback-host" />,
}));

vi.mock('@/tutorials/DocsEolBanner', () => ({
  DocsEolBanner: () => <div data-testid="docs-host" />,
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div data-testid="toaster-host" />,
}));

describe('GlobalHosts', () => {
  beforeEach(() => {
    useUIStore.setState((state) => ({
      ...state,
      modals: { ...state.modals, feedback: false },
    }));
  });

  it('mounts exactly one feedback, docs, and toast host', async () => {
    render(<GlobalHosts />);

    expect(await screen.findAllByTestId('feedback-host')).toHaveLength(1);
    expect(screen.getAllByTestId('docs-host')).toHaveLength(1);
    expect(screen.getAllByTestId('toaster-host')).toHaveLength(1);
  });
});
