import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataRootSetupForm } from '../DataRootSetupForm';

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), open: vi.fn() }));

vi.mock('@/lib/isTauri', () => ({ isTauri: mocks.isTauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));

describe('DataRootSetupForm', () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    mocks.open.mockReset();
  });

  it('submits the native directory picker selection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue('/Users/example/Documents/Wordflow');
    render(<DataRootSetupForm suggestedPath="/recommended" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('/Users/example/Documents/Wordflow');
    });
  });

  it('leaves the Data Root unchanged when the picker is cancelled', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    mocks.open.mockResolvedValue(null);
    render(<DataRootSetupForm suggestedPath="/recommended" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => {
      expect(mocks.open).toHaveBeenCalledOnce();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the recommended browser path as a placeholder and submits it in one click', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mocks.isTauri.mockReturnValue(false);
    render(<DataRootSetupForm suggestedPath="/srv/recommended" onSubmit={onSubmit} />);

    const input = screen.getByRole('textbox', { name: 'Folder on the server' });
    expect(input.tagName).toBe('TEXTAREA');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', '/srv/recommended');
    expect(input).toHaveAttribute('wrap', 'soft');
    expect(input).toHaveClass('break-all', 'resize-none');
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Use recommended location' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit).toHaveBeenCalledWith('/srv/recommended');
  });
});
