import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DataRootContext, type DataRootResource } from '@/features/bootstrap/DataRootContext';
import { DataFolderSettingsPanel } from '../DataFolderSettingsPanel';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const mutableResource: DataRootResource = {
  state: 'ready',
  source: 'config',
  data_root: '/srv/original',
  suggested_data_root: '/srv/recommended',
  mutable: true,
  runtime_generation: 1,
  error: null,
  change_token: 'token',
};

describe('DataFolderSettingsPanel', () => {
  it('switches browser mode through the shared backend Data Root operation', async () => {
    const user = userEvent.setup();
    const configureDataRoot = vi.fn().mockResolvedValue({
      ...mutableResource,
      data_root: '/srv/updated',
      runtime_generation: 2,
    });
    render(
      <DataRootContext.Provider value={{ resource: mutableResource, configureDataRoot }}>
        <DataFolderSettingsPanel />
      </DataRootContext.Provider>,
    );

    expect(screen.getByText(/Current Data Root: \/srv\/original/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Folder on the server'));
    await user.type(screen.getByLabelText('Folder on the server'), '/srv/updated');
    await user.click(screen.getByRole('button', { name: 'Switch Data Root' }));

    await waitFor(() => {
      expect(configureDataRoot).toHaveBeenCalledWith('/srv/updated');
    });
  });

  it('shows operator guidance for an environment-managed root', () => {
    render(
      <DataRootContext.Provider
        value={{
          resource: {
            ...mutableResource,
            source: 'environment',
            mutable: false,
            change_token: null,
          },
          configureDataRoot: vi.fn(),
        }}
      >
        <DataFolderSettingsPanel />
      </DataRootContext.Provider>,
    );

    expect(screen.getByText('Managed by operator')).toBeInTheDocument();
    expect(screen.getByText(/DATA_ROOT controls this deployment/)).toBeInTheDocument();
  });
});
