import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from 'sonner';
import { SaveSnapshotDialog } from '../components/SaveSnapshotDialog';

/**
 * Renders the save dialog with default spies and overridable props.
 * Used by: Vitest setup or assertions in snapshot-view/SaveSnapshotDialog.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 * Flow: create default save/open spies, render the dialog with toaster support, apply per-test overrides, and return spies for assertions.
 */
function setup(overrides: Partial<React.ComponentProps<typeof SaveSnapshotDialog>> = {}) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  render(
    <>
      <Toaster />
      <SaveSnapshotDialog
        open
        onOpenChange={onOpenChange}
        tool="concordance"
        existingFilenames={[]}
        onSave={onSave}
        {...overrides}
      />
    </>,
  );
  return { onSave, onOpenChange };
}

describe('SaveSnapshotDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the dialog with name + description inputs and Save disabled by default', () => {
    setup();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('shows the on-disk filename preview as the user types', async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByLabelText(/^name$/i);
    await user.type(input, 'pride');
    expect(screen.getByText(/concordance-pride\.ldaca-snapshot/)).toBeInTheDocument();
  });

  it('inline-validates name collisions against existingFilenames', async () => {
    const user = userEvent.setup();
    setup({ existingFilenames: ['concordance-foo.ldaca-snapshot'] });
    const input = screen.getByLabelText(/^name$/i);
    await user.type(input, 'foo');
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('rejects names with invalid characters', async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByLabelText(/^name$/i);
    await user.type(input, 'bad/name');
    expect(screen.getByText(/can't contain/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('rejects names exceeding the length cap', async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByLabelText(/^name$/i);
    const overlong = 'x'.repeat(81);
    await user.type(input, overlong);
    expect(screen.getByText(/too long/i)).toBeInTheDocument();
  });

  it('enables Save and calls onSave with the full filename when valid', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    setup({ onSave });

    await user.type(screen.getByLabelText(/^name$/i), 'pride');
    await user.type(screen.getByLabelText(/description/i), 'A short demo.');

    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('concordance-pride.ldaca-snapshot', 'A short demo.');
    });
  });

  it('shows a destructive toast when onSave throws', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('upload failed'));
    const onOpenChange = vi.fn();
    setup({ onSave, onOpenChange });

    await user.type(screen.getByLabelText(/^name$/i), 'pride');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Dialog stays open on failure so the user can retry / edit.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes the dialog on successful save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    setup({ onSave, onOpenChange });

    await user.type(screen.getByLabelText(/^name$/i), 'pride');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('prefills the name input with defaultName when opened', () => {
    setup({ defaultName: 'demo-2026-05-16' });
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('demo-2026-05-16');
  });

  it('Cancel button calls onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
