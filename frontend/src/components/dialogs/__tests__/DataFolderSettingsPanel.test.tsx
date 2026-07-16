import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataFolderSettingsPanel } from '../DataFolderSettingsPanel';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setRuntimeBackendUrl: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@/lib/backend/runtimeBackend', () => ({
  setRuntimeBackendUrl: mocks.setRuntimeBackendUrl,
}));

describe('DataFolderSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'get_data_root') return Promise.resolve('/tmp/original');
      if (command === 'set_data_root') return Promise.resolve('http://127.0.0.1:48123');
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  it('loads the Tauri-owned path and rebinds all server state after a successful switch', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const cancelQueriesSpy = vi.spyOn(queryClient, 'cancelQueries');
    const resetQueriesSpy = vi.spyOn(queryClient, 'resetQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <DataFolderSettingsPanel />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Path')).toHaveValue('/tmp/original');
    });

    await user.clear(screen.getByLabelText('Path'));
    await user.type(screen.getByLabelText('Path'), '/tmp/updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.setRuntimeBackendUrl).toHaveBeenCalledWith('http://127.0.0.1:48123');
    });

    expect(cancelQueriesSpy).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('set_data_root', {
      dataRoot: '/tmp/updated',
    });
    expect(resetQueriesSpy).toHaveBeenCalledOnce();
    expect(screen.getByText('Current: /tmp/updated')).toBeInTheDocument();
  });

  it('rebinds to the rollback backend when switching fails', async () => {
    const user = userEvent.setup();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'get_data_root') return Promise.resolve('/tmp/original');
      if (command === 'set_data_root') return Promise.reject(new Error('restart failed'));
      if (command === 'get_backend_url') return Promise.resolve('http://127.0.0.1:49123');
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DataFolderSettingsPanel />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Path')).toHaveValue('/tmp/original');
    });
    await user.clear(screen.getByLabelText('Path'));
    await user.type(screen.getByLabelText('Path'), '/tmp/broken');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.setRuntimeBackendUrl).toHaveBeenCalledWith('http://127.0.0.1:49123');
    });
    expect(mocks.invoke).toHaveBeenCalledWith('get_backend_url');
    expect(screen.getByText('Current: /tmp/original')).toBeInTheDocument();
  });
});
