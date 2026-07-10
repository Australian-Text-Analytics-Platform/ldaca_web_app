import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FillDefaultStopWordsDialog from '../FillDefaultStopWordsDialog';

vi.mock('@/features/views/common/hooks/useDetectedColumnLanguage', () => ({
  useDetectedColumnLanguage: () => ({ detectedLanguage: 'en', isDetecting: false }),
}));

/** Renders the open dialog with a detected English stoplist for action tests. */
function renderDialog(onFill: (language: string) => Promise<void>, isLoading = false) {
  const onOpenChange = vi.fn();
  render(
    <FillDefaultStopWordsDialog
      open
      onOpenChange={onOpenChange}
      workspaceId="workspace-1"
      nodeId="node-1"
      column="text"
      isLoading={isLoading}
      onFill={onFill}
    />,
  );
  return { onOpenChange };
}

describe('FillDefaultStopWordsDialog', () => {
  it('closes only after the chosen stoplist loads successfully', async () => {
    const user = userEvent.setup();
    const onFill = vi.fn().mockResolvedValue(undefined);
    const { onOpenChange } = renderDialog(onFill);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onFill).toHaveBeenCalledWith('en');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open and exposes a retryable load failure', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog(vi.fn().mockRejectedValue(new Error('offline')));

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the default stop words',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables both dialog actions while the stoplist is loading', () => {
    renderDialog(vi.fn().mockResolvedValue(undefined), true);

    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
