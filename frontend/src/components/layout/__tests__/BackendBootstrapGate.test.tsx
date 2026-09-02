import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const errorResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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
    const reloadApplication = vi.fn();
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
      <BackendBootstrapGate reloadApplication={reloadApplication}>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );

    expect(await screen.findByText('Application ready')).toBeInTheDocument();
    expect(reloadApplication).not.toHaveBeenCalled();
  });

  it('submits the recommended root with the change token', async () => {
    const user = userEvent.setup();
    const reloadApplication = vi.fn();
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
      <BackendBootstrapGate reloadApplication={reloadApplication}>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Use recommended location' }));

    await waitFor(() => {
      expect(reloadApplication).toHaveBeenCalledOnce();
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

  it('shows backend validation detail messages when a Data Root is rejected', async () => {
    const user = userEvent.setup();
    const reloadApplication = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(rootResponse())
      .mockResolvedValueOnce(
        errorResponse(422, {
          code: 'request_validation_failed',
          message: 'Request validation failed',
          details: [
            { location: ['body', 'data_root'], message: 'Data Root must be an absolute path' },
            { location: ['body', 'data_root'], message: 'Choose a server directory' },
          ],
          request_id: 'validation-request',
        }),
      )
      .mockResolvedValueOnce(rootResponse());

    render(
      <BackendBootstrapGate reloadApplication={reloadApplication}>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );
    const input = await screen.findByRole('textbox', { name: 'Folder on the server' });
    await user.type(input, 'relative/path');
    await user.click(screen.getByRole('button', { name: 'Use this folder' }));

    expect(
      await screen.findByText('Data Root must be an absolute path; Choose a server directory', {
        selector: 'p.text-error',
      }),
    ).toBeInTheDocument();
    expect(reloadApplication).not.toHaveBeenCalled();
  });

  it('prefers the refreshed Data Root error after initialization fails', async () => {
    const user = userEvent.setup();
    const reloadApplication = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(rootResponse())
      .mockResolvedValueOnce(
        errorResponse(500, {
          code: 'internal_server_error',
          message: 'Internal server error',
          request_id: 'initialization-request',
        }),
      )
      .mockResolvedValueOnce(
        rootResponse({
          state: 'configuration_error',
          error: {
            code: 'data_root_initialization_failed',
            message: 'The selected Data Root could not be initialized',
          },
        }),
      );

    render(
      <BackendBootstrapGate reloadApplication={reloadApplication}>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Use recommended location' }));

    expect(
      await screen.findByText('The selected Data Root could not be initialized', {
        selector: 'p.text-error',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Backend request failed (HTTP 500)')).not.toBeInTheDocument();
    expect(reloadApplication).not.toHaveBeenCalled();
  });

  it('keeps a Python initialization error instead of replacing it with refreshed status', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(rootResponse())
      .mockResolvedValueOnce(
        errorResponse(500, {
          code: 'data_root_initialization_failed',
          message: 'PermissionError: [Errno 13] Permission denied while opening SQLite',
          request_id: 'initialization-request',
        }),
      )
      .mockResolvedValueOnce(
        rootResponse({
          state: 'configuration_error',
          error: {
            code: 'data_root_initialization_failed',
            message: 'The selected Data Root could not be initialized',
          },
        }),
      );

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Use recommended location' }));

    expect(
      await screen.findByText(
        'PermissionError: [Errno 13] Permission denied while opening SQLite (Request ID: initialization-request)',
        { selector: 'p.text-error' },
      ),
    ).toBeInTheDocument();
  });

  it('falls back to the HTTP status when the backend error is unreadable', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(rootResponse())
      .mockResolvedValueOnce(
        new Response('not-json', { status: 500, headers: { 'Content-Type': 'text/plain' } }),
      )
      .mockResolvedValueOnce(rootResponse());

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Use recommended location' }));

    expect(
      await screen.findByText('Backend request failed (HTTP 500)', { selector: 'p.text-error' }),
    ).toBeInTheDocument();
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

  it('shows shutdown progress without offering Data Root setup while stopping', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(liveResponse())
      .mockResolvedValueOnce(
        rootResponse({
          state: 'stopping',
          source: 'config',
          data_root: '/srv/data',
          runtime_generation: 3,
        }),
      );

    render(
      <BackendBootstrapGate>
        <p>Application ready</p>
      </BackendBootstrapGate>,
    );

    expect(await screen.findByText('Backend shutting down')).toBeInTheDocument();
    expect(screen.getByText('Stopping…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose folder' })).not.toBeInTheDocument();
    expect(screen.queryByText('Set up Wordflow')).not.toBeInTheDocument();
  });

  it('does not reload for repeated observations of the same Runtime generation', async () => {
    const user = userEvent.setup();
    const reloadApplication = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
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
          data_root: '/srv/current',
          runtime_generation: 1,
        }),
      );

    render(
      <BackendBootstrapGate reloadApplication={reloadApplication}>
        <GenerationProbe onMount={vi.fn()} />
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Switch root' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    expect(screen.getByRole('button', { name: 'Switch root' })).toBeInTheDocument();
    expect(reloadApplication).not.toHaveBeenCalled();
  });

  it('blocks the old application and reloads once when the Runtime generation changes', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    const reloadApplication = vi.fn();
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
      <BackendBootstrapGate reloadApplication={reloadApplication}>
        <GenerationProbe onMount={onMount} />
      </BackendBootstrapGate>,
    );
    await user.click(await screen.findByRole('button', { name: 'Switch root' }));

    await waitFor(() => {
      expect(reloadApplication).toHaveBeenCalledOnce();
    });
    expect(screen.getByText('Reloading Wordflow')).toBeInTheDocument();
    expect(
      screen.getByText('The Data Root changed. Wordflow is reconnecting to the new Runtime.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch root' })).not.toBeInTheDocument();
    expect(onMount).toHaveBeenCalledOnce();
  });
});
