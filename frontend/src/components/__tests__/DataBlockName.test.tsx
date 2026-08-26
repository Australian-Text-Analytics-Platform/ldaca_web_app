import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataBlockName } from '@/components/DataBlockName';

describe('DataBlockName', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clips a one-line head-fade name from the left so its suffix stays visible', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);

    render(
      <DataBlockName
        name="sample_data/ADO/qldelection2020_candidate_tweets"
        backgroundColor="#2563eb"
        maxLines={1}
        fadeEdge="head"
      />,
    );

    const viewport = screen.getByTestId('data-block-name');
    await waitFor(() => expect(viewport).toHaveAttribute('dir', 'rtl'));
    expect(viewport).toHaveClass('max-h-[1lh]');
    expect(screen.getByText(/qldelection2020_candidate_tweets/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('data-block-name-head-fade')).toHaveClass('left-0', 'opacity-100');
  });

  it('anchors an overflowing wrapped name to its final three lines', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(96);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(48);

    render(
      <DataBlockName
        name="sample_data/ADO/qldelection2020_candidate_tweets"
        backgroundColor="#2563eb"
        maxLines={3}
        fadeEdge="head"
      />,
    );

    const viewport = screen.getByTestId('data-block-name');
    expect(viewport).toHaveAttribute('dir', 'ltr');
    expect(viewport).toHaveClass('flex', 'flex-col', 'justify-end');
    expect(viewport).toHaveClass('max-h-[3lh]');
    await waitFor(() =>
      expect(screen.getByTestId('data-block-name-head-fade')).toHaveClass('opacity-100'),
    );
    expect(screen.getByTestId('data-block-name-head-fade')).toHaveClass('inset-x-0', 'top-0');
  });
});
