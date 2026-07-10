import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleDataPanel } from '../SampleDataPanel';

const mocks = vi.hoisted(() => ({
  getSampleDataCatalogue: vi.fn(),
  importSampleData: vi.fn(),
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'loading-toast'),
    success: vi.fn(),
  },
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  getSampleDataCatalogue: mocks.getSampleDataCatalogue,
  getSampleDataReadme: vi.fn(),
  importSampleData: mocks.importSampleData,
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));

describe('SampleDataPanel cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSampleDataCatalogue.mockResolvedValue({
      data: {
        schema_version: 1,
        collections: [
          {
            id: 'bundled-sample',
            name: 'Bundled sample',
            description: 'A bundled corpus',
            language: 'en',
            bundled: true,
            files: [],
            recommended_for: ['data-loader'],
            status: 'bundled',
            total_size_bytes: 100,
          },
        ],
      },
    });
    mocks.importSampleData.mockResolvedValue({
      data: {
        bytes_copied: 100,
        file_count: 1,
        message: 'imported',
        remote_download_started: false,
        removed_existing: false,
        status: 'successful',
      },
    });
  });

  it('invalidates the file tree once after a sample import', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <SampleDataPanel authHeaders={{}} />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Import sample data' }));
    expect(await screen.findByText('Bundled sample')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import selected' }));

    await waitFor(() => {
      expect(mocks.importSampleData).toHaveBeenCalledTimes(1);
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
