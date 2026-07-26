import { useState, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        columns: ['text', 'annotation', 'reviewer'],
        schema: [
          { name: 'text', kind: 'string' },
          { name: 'annotation', kind: 'string' },
          { name: 'reviewer', kind: 'string' },
        ],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    },
    rows: [{ text: 'Example', annotation: 'covid', reviewer: 'covid' }],
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
    'comparisonColumns' | 'onComparisonColumnsChange'
  >,
) {
  const [comparisonColumns, setComparisonColumns] = useState(['reviewer']);
  return (
    <AnnotationResultsPanel
      {...props}
      comparisonColumns={comparisonColumns}
      onComparisonColumnsChange={setComparisonColumns}
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

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'text',
      'annotation',
      'reviewer',
    ]);
    const resultRow = screen.getByRole('row', { name: 'Example covid' });
    expect(within(resultRow).getAllByRole('cell').at(-1)).toHaveTextContent('covid');
    expect(screen.getAllByRole('combobox', { name: /Class for row/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '238' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jump to page' }));
    await user.type(screen.getByRole('textbox'), '100');
    await user.click(screen.getByRole('button', { name: 'Go' }));

    expect(setPagination).toHaveBeenCalledWith({ pageIndex: 99, pageSize: 10 });
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
      await screen.findByLabelText('annotation covid, reviewer covid: 2 rows'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Class for row 1' }));
    await user.click(screen.getByRole('option', { name: 'job' }));

    await waitFor(() => {
      expect(setCell).toHaveBeenCalledWith('node-1', 'annotation', 0, 'job');
      expect(screen.getByLabelText('annotation covid, reviewer covid: 1 rows')).toBeInTheDocument();
      expect(screen.getByLabelText('annotation job, reviewer covid: 1 rows')).toBeInTheDocument();
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

    await screen.findByLabelText('annotation covid, reviewer covid: 2 rows');
    await user.click(screen.getByRole('combobox', { name: 'Class for row 1' }));
    await user.click(screen.getByRole('option', { name: 'job' }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Class for row 1' })).toHaveTextContent('covid');
    });
    expect(screen.getByLabelText('annotation covid, reviewer covid: 2 rows')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('annotation job, reviewer covid: 1 rows'),
    ).not.toBeInTheDocument();
    expect(queryWorkspaceSqlTable).toHaveBeenCalledTimes(1);
  });
});
