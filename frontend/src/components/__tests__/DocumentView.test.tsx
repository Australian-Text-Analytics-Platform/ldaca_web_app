import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import DocumentView from '@/components/DocumentView';

vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

describe('DocumentView (docType="tutorial")', () => {
  /** Original fetch implementation restored after tests that mock markdown loading. */
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      /** Called by: DocumentView test fetch mock when markdown content is requested because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
      text: () => Promise.resolve('# Tutorial'),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('fetches tutorial content once per file change', async () => {
    const { rerender } = render(
      <DocumentView
        docType="tutorial"
        target={{ file: 'tutorials/index.md', anchor: 'help-tutorial-index' }}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    rerender(
      <DocumentView
        docType="tutorial"
        target={{ file: 'tutorials/index.md', anchor: 'help-tutorial-index-2' }}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
