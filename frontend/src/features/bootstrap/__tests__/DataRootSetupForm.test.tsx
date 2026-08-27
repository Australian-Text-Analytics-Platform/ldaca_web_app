import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataRootSetupForm } from '../DataRootSetupForm';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/lib/isTauri', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));

describe('DataRootSetupForm in Tauri', () => {
  beforeEach(() => {
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
});
