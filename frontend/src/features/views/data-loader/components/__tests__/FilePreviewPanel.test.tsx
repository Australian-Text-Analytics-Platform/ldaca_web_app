import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewPanel } from '../FilePreviewPanel';

const mocks = vi.hoisted(() => ({
  listFileWorksheets: vi.fn(),
  previewFileTable: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  listFileWorksheets: mocks.listFileWorksheets,
  previewFileTable: mocks.previewFileTable,
}));

function renderPreviewPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<FilePreviewPanel filename="records.csv" open onClose={vi.fn()} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe('FilePreviewPanel pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.previewFileTable.mockImplementation(
      ({ query }: { query: { page: number; page_size: number } }) =>
        Promise.resolve({
          columns: ['document'],
          rows: Array.from({ length: query.page_size }, (_, index) => ({
            document: `page-${query.page}-row-${index + 1}`,
          })),
          hasNext: true,
        }),
    );
  });

  it('defaults to 10 rows and displays the complete returned page', async () => {
    renderPreviewPanel();

    await waitFor(() => {
      expect(mocks.previewFileTable).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ page: 1, page_size: 10 }),
        }),
      );
    });

    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveTextContent('10');
    expect(await screen.findByText('page-1-row-10')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(11);
  });

  it('returns to page 1 when the page size changes', async () => {
    const user = userEvent.setup();
    renderPreviewPanel();

    await screen.findByText('page-1-row-10');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mocks.previewFileTable).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ page: 2, page_size: 10 }),
        }),
      );
    });

    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    await user.click(screen.getByRole('option', { name: '25' }));

    await waitFor(() => {
      expect(mocks.previewFileTable).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ page: 1, page_size: 25 }),
        }),
      );
    });
    expect(await screen.findByText('page-1-row-25')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(26);
  });
});
