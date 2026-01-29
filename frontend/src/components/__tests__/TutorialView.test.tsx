import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import TutorialView from '@/components/TutorialView';

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

describe('TutorialView', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# Tutorial'),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('fetches tutorial content once per file change', async () => {
    const { rerender } = render(
      <TutorialView
        target={{ file: 'tutorials/index.md', anchor: 'help-tutorial-index' }}
      />
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    rerender(
      <TutorialView
        target={{ file: 'tutorials/index.md', anchor: 'help-tutorial-index-2' }}
      />
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });
});