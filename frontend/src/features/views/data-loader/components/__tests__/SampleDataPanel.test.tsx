import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/msw/server';
import { SampleDataPanel } from '../SampleDataPanel';

const mocks = vi.hoisted(() => ({
  importRequest: vi.fn(),
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'loading-toast'),
    success: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));

describe('SampleDataPanel cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get('*/api/sample-collections', () =>
        HttpResponse.json({
          schema_version: 1,
          collections: [
            {
              id: 'ADO/twitter',
              name: 'ADO Twitter',
              description: 'A remote corpus',
              language: 'en',
              installed: false,
              files: [{ path: 'ADO/twitter/README.md', size: 10 }],
              recommended_for: ['data-loader'],
              total_size_bytes: 10,
            },
          ],
        }),
      ),
      http.post('*/api/sample-collections/:collection_id/imports', () => {
        mocks.importRequest();
        return HttpResponse.json({
          id: 'import-1',
          state: 'queued',
          request: { kind: 'sample', collection_id: 'ADO/twitter' },
          progress: { fraction: 0, message: 'Queued' },
          error: null,
          cancellation_requested_at: null,
          created_at: '2026-01-01T00:00:00Z',
          started_at: null,
          finished_at: null,
          revision: 1,
          result: null,
        });
      }),
    );
  });

  it('invalidates the file tree once after a sample import', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <SampleDataPanel />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Import sample data' }));
    expect(await screen.findByText('ADO Twitter')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'ADO Twitter' }));
    await user.click(screen.getByRole('button', { name: 'Import selected' }));

    await waitFor(() => {
      expect(mocks.importRequest).toHaveBeenCalledTimes(1);
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('does not submit when the remote catalogue fails', async () => {
    server.use(
      http.get('*/api/sample-collections', () =>
        HttpResponse.json(
          { code: 'bad_gateway', message: 'Sample catalogue is unavailable' },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SampleDataPanel />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Import sample data' }));
    expect(
      await screen.findByText('Could not load the sample catalogue.', {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled();
    expect(mocks.importRequest).not.toHaveBeenCalled();
  });
});
