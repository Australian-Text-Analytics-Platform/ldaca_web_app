import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import { AnnotationResultsPanel } from '../AnnotationResultsPanel';

const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());
const setCell = vi.hoisted(() => vi.fn());
const setPagination = vi.hoisted(() => vi.fn());

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
}));
vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({ setCell }),
}));
vi.mock('../../hooks/useAnnotationNodePage', () => ({
  useAnnotationNodePage: () => ({
    pagination: { pageIndex: 0, pageSize: 10 },
    setPagination,
    query: {
      data: {
        columns: ['text', 'annotation', 'reviewer', 'username', 'record_id'],
        schema: [
          { name: 'text', kind: 'string' },
          { name: 'annotation', kind: 'string' },
          { name: 'reviewer', kind: 'string' },
          { name: 'username', kind: 'string' },
          { name: 'record_id', kind: 'integer' },
        ],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    },
    rows: [
      { text: 'Example', annotation: 'covid', reviewer: 'covid', username: 'alice', record_id: 1 },
    ],
    rowCount: 2380,
  }),
}));
vi.mock('../../hooks/useAnnotationClassDescriptions', () => ({
  useAnnotationClassDescriptions: () => ({
    rows: [{ class: 'covid' }, { class: 'job' }],
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function ManualResults(
  props: Omit<
    ComponentProps<typeof AnnotationResultsPanel>,
    | 'comparisonColumns'
    | 'onComparisonColumnsChange'
    | 'metadataColumns'
    | 'onMetadataColumnsChange'
    | 'reliabilityMetric'
    | 'onReliabilityMetricChange'
  >,
) {
  const [comparisonColumns, setComparisonColumns] = useState(['reviewer']);
  const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
  const [reliabilityMetric, setReliabilityMetric] =
    useState<IntercoderReliabilityMetric>('cohens_kappa');
  return (
    <AnnotationResultsPanel
      {...props}
      comparisonColumns={comparisonColumns}
      onComparisonColumnsChange={setComparisonColumns}
      metadataColumns={metadataColumns}
      onMetadataColumnsChange={setMetadataColumns}
      reliabilityMetric={reliabilityMetric}
      onReliabilityMetricChange={setReliabilityMetric}
    />
  );
}

const renderPanel = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ManualResults
        workspaceId="workspace-1"
        nodeId="node-1"
        rowCount={2380}
        textColumn="text"
        annotationColumn="annotation"
        classNodeId="classes"
        classColumn="class"
        descriptionColumn="description"
      />
    </QueryClientProvider>,
  );
};

describe('AnnotationResultsPanel', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    queryWorkspaceSqlTable.mockReset();
    setCell.mockReset();
    setPagination.mockReset();
  });

  it('renders the shared full pagination and jumps from its ellipsis popover', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [],
      hasNext: false,
      etag: 'revision-1',
    });

    renderPanel();

    const headers = screen.getAllByRole('columnheader');
    expect(headers.slice(0, 2).map((header) => header.textContent)).toEqual(['text', 'annotation']);
    expect(within(headers[2]).getByText('reviewer')).toBeInTheDocument();
    expect(within(headers[2]).getByRole('button', { name: /Cohen’s Kappa/ })).toBeInTheDocument();
    const resultRow = screen.getByRole('row', { name: 'Example covid' });
    expect(within(resultRow).getAllByRole('cell').at(-1)).toHaveTextContent('covid');
    expect(screen.getAllByRole('combobox', { name: /Class for row/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '238' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jump to page' }));
    const pageInput = screen.getByRole('textbox');
    await waitFor(() => {
      expect(pageInput).toHaveFocus();
    });
    await user.type(pageInput, '100');
    await user.click(screen.getByRole('button', { name: 'Go' }));

    expect(setPagination).toHaveBeenCalledWith({ pageIndex: 99, pageSize: 10 });
  });

  it('shows selected metadata alongside manual annotations', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [],
      hasNext: false,
      etag: 'revision-1',
    });

    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'username' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('columnheader', { name: 'username' })).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('excludes non-label columns and applies a different reliability metric', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [{ __reference: 'covid', __comparison: 'covid', __count: 2 }],
      hasNext: false,
      etag: 'revision-1',
    });

    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'record_id' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: 'Percent Agreement' }));
    await user.keyboard('{Escape}');

    expect(
      screen.getByRole('button', {
        name: 'Percent Agreement 100.0% for annotation versus reviewer',
      }),
    ).toHaveTextContent('100.0%');
  });

  it('updates full-table comparison counts after a successful edit without re-querying', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [{ __reference: 'covid', __comparison: 'covid', __count: 2 }],
      hasNext: false,
      etag: 'revision-1',
    });
    setCell.mockResolvedValue(undefined);

    renderPanel();

    expect(
      await screen.findByRole('button', {
        name: 'Cohen’s Kappa unavailable for annotation versus reviewer',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Class for row 1' }));
    await user.click(screen.getByRole('option', { name: 'job' }));

    await waitFor(() => {
      expect(setCell).toHaveBeenCalledWith('node-1', 'annotation', 0, 'job');
      expect(
        screen.getByRole('button', {
          name: 'Cohen’s Kappa 0.000 for annotation versus reviewer',
        }),
      ).toBeInTheDocument();
    });
    expect(queryWorkspaceSqlTable).toHaveBeenCalledTimes(1);
  });

  it('leaves comparison counts unchanged when the cell save fails', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [{ __reference: 'covid', __comparison: 'covid', __count: 2 }],
      hasNext: false,
      etag: 'revision-1',
    });
    setCell.mockRejectedValue(new Error('Save failed'));

    renderPanel();

    await screen.findByRole('button', {
      name: 'Cohen’s Kappa unavailable for annotation versus reviewer',
    });
    await user.click(screen.getByRole('combobox', { name: 'Class for row 1' }));
    await user.click(screen.getByRole('option', { name: 'job' }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Class for row 1' })).toHaveTextContent('covid');
    });
    expect(
      screen.getByRole('button', {
        name: 'Cohen’s Kappa unavailable for annotation versus reviewer',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Cohen’s Kappa 0.000 for annotation versus reviewer',
      }),
    ).not.toBeInTheDocument();
    expect(queryWorkspaceSqlTable).toHaveBeenCalledTimes(1);
  });
});
