import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

import { useDataRoot } from '@/features/bootstrap/DataRootContext';
import { BackendBootstrapGate } from '../BackendBootstrapGate';

const { connection } = vi.hoisted(() => ({
  connection: {
    apiBaseUrl: 'http://localhost/api',
    clientBaseUrl: 'http://localhost',
    liveUrl: 'http://localhost/health/live',
    readyUrl: 'http://localhost/health/ready',
    dataRootUrl: 'http://localhost/api/data-root',
  },
}));

vi.mock('@/lib/backend/backendConnection', () => ({
  resolveBackendConnection: vi.fn().mockResolvedValue(connection),
}));

const liveResponse = () =>
  new Response(JSON.stringify({ status: 'live', version: 'test' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const readyResponse = () =>
  new Response(JSON.stringify({ status: 'ready', version: 'test' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const rootResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      state: 'unconfigured',
      source: 'none',
      data_root: null,
      suggested_data_root: '/srv/recommended',
      mutable: true,
      runtime_generation: 0,
      error: null,
      change_token: 'change-token',
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

function GenerationProbe({ onMount }: { onMount: () => void }) {
  const { configureDataRoot } = useDataRoot();
  useEffect(onMount, [onMount]);
  return (
    <button
      type="button"
      onClick={() => {
        void configureDataRoot('/srv/next');
      }}
    >
      Switch root
    </button>
  );
}

describe('BackendBootstrapGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows browser server-path setup while the live backend is unconfigured', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(rootResponse());

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );

    expect(await screen.findByText('Set up Wordflow')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder on the server')).toBeInTheDocument();
    expect(screen.queryByText('Application ready')).not.toBeInTheDocument();
  });

  it('enters the application only for a ready Runtime', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(
        rootResponse({
          state: 'ready',
          source: 'config',
          data_root: '/srv/data',
          runtime_generation: 3,
        }),
      )
      .mockResolvedValueOnce(readyResponse());

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );

    expect(await screen.findByText('Application ready')).toBeInTheDocument();
  });

  it('submits the recommended root with the change token', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(rootResponse())
      .mockResolvedValueOnce(
        rootResponse({
          state: 'ready',
          source: 'config',
          data_root: '/srv/recommended',
          runtime_generation: 1,
          change_token: 'rotated-token',
        }),
      );

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Use recommended location' }));

    await waitFor(() => {
      expect(screen.getByText('Application ready')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      connection.dataRootUrl,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'X-Data-Root-Token': 'change-token' }),
        body: JSON.stringify({ data_root: '/srv/recommended' }),
      }),
    );
  });

  it('shows operator guidance for an immutable configuration error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(
        rootResponse({
          state: 'configuration_error',
          source: 'environment',
          mutable: false,
          suggested_data_root: null,
          change_token: null,
          error: { code: 'data_root_unavailable', message: 'Configured root is unavailable' },
        }),
      );

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );

    expect(await screen.findByText('Data Root requires operator attention')).toBeInTheDocument();
    expect(screen.getByText('Configured root is unavailable')).toBeInTheDocument();
  });

  it('remounts application providers when the Runtime generation changes', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(
        rootResponse({
          state: 'ready',
          source: 'config',
          data_root: '/srv/current',
          runtime_generation: 1,
        }),
      )
      .mockResolvedValueOnce(readyResponse())
      .mockResolvedValueOnce(
        rootResponse({
          state: 'ready',
          source: 'config',
          data_root: '/srv/next',
          runtime_generation: 2,
          change_token: 'next-token',
        }),
      );

    render(
      <BackendBootstrapGate>
        <GenerationProbe onMount={onMount} />
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Switch root' }));

    await waitFor(() => {
      expect(onMount).toHaveBeenCalledTimes(2);
    });
  });
});
