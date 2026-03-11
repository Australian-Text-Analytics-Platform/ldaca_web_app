import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TokenFrequencyDownloadDialog } from '../TokenFrequencyDownloadDialog';

describe('TokenFrequencyDownloadDialog', () => {
  it('resets the selected format and stop-word option when reopened in a different mode', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TokenFrequencyDownloadDialog
        open
        onOpenChange={vi.fn()}
        mode="wordcloud"
        onConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'SVG' }));
    await user.click(screen.getByRole('checkbox', { name: /download stop words as well/i }));

    expect(screen.getByRole('checkbox', { name: 'SVG' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /download stop words as well/i })).not.toBeChecked();

    rerender(
      <TokenFrequencyDownloadDialog
        open={false}
        onOpenChange={vi.fn()}
        mode="wordcloud"
        onConfirm={vi.fn()}
      />
    );

    rerender(
      <TokenFrequencyDownloadDialog
        open
        onOpenChange={vi.fn()}
        mode="frequencies"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: 'CSV' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Markdown' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /download stop words as well/i })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'SVG' })).not.toBeInTheDocument();
  });
});