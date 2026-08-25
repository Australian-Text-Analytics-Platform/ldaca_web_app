import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Int64, Utf8 } from 'apache-arrow';
import { type ComponentProps, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import { toBgColor } from '@/features/views/common/vizPalette';
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
        columns: [
          '__wordflow_annotation_source_row_index',
          'text',
          'annotation',
          'correction',
          'reviewer',
          'username',
          'record_id',
        ],
        schema: [
          {
            name: '__wordflow_annotation_source_row_index',
            field: new Field('__wordflow_annotation_source_row_index', new Int64()),
          },
          { name: 'text', field: new Field('text', new Utf8()) },
          { name: 'annotation', field: new Field('annotation', new Utf8()) },
          { name: 'correction', field: new Field('correction', new Utf8()) },
          { name: 'reviewer', field: new Field('reviewer', new Utf8()) },
          { name: 'username', field: new Field('username', new Utf8()) },
          { name: 'record_id', field: new Field('record_id', new Int64()) },
        ],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    },
    rows: [
      {
        __wordflow_annotation_source_row_index: 0,
        text: 'Example',
        annotation: 'covid',
        correction: null,
        reviewer: 'covid',
        username: 'alice',
        record_id: 1,
      },
    ],
    rowCount: 2380,
    countQuery: { isLoading: false, isError: false, isFetching: false },
    sourceRowIndexColumn: '__wordflow_annotation_source_row_index',
    refreshFilteredRows: vi.fn(),
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

const renderPanel = (correctionColumn: string | null = null) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ManualResults
        workspaceId="workspace-1"
        nodeId="node-1"
        sourceColumns={['text', 'annotation', 'correction', 'reviewer', 'username', 'record_id']}
        sourceColor="#2563eb"
        rowCount={2380}
        textColumn="text"
        annotationColumn="annotation"
        classNodeId="classes"
        classColumn="class"
        descriptionColumn="description"
        correction={{
          column: correctionColumn,
          onColumnChange: vi.fn(),
          onCreate: vi.fn(),
        }}
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
    setCell.mockResolvedValue(undefined);
    setPagination.mockReset();
  });

  it('edits the selected correction column without exposing an example shortcut', async () => {
    const user = userEvent.setup();
    renderPanel('correction');

    expect(screen.getByRole('combobox', { name: 'Correction column' })).toHaveTextContent(
      'correction',
    );
    expect(screen.queryByRole('button', { name: 'Use as example' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'correction' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'correction' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('combobox', { name: 'Correction for row 1' }));
    await user.click(screen.getByRole('option', { name: 'job' }));

    await waitFor(() => {
      expect(setCell).toHaveBeenCalledWith('node-1', 'correction', 0, 'job');
    });
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

    expect(within(screen.getByRole('table')).getAllByRole('rowgroup')[0]).toHaveClass(
      'sticky',
      'top-0',
      'z-10',
      'bg-surface',
    );
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('text');
    expect(headers[1]).toHaveTextContent('annotation');
    expect(within(headers[2]).getByText('reviewer')).toBeInTheDocument();
    expect(within(headers[2]).queryByRole('button', { name: /Cohen’s Kappa/ })).toBeNull();
    expect(
      within(headers[2]).getByRole('button', { name: 'Show comparison values for reviewer' }),
    ).toBeInTheDocument();
    const filterToggle = within(headers[2]).getByRole('button', {
      name: 'Filter difference for reviewer',
    });
    expect(filterToggle).toBeDisabled();
    expect(filterToggle).toHaveAttribute('aria-pressed', 'false');
    const resultRow = screen.getByRole('row', { name: 'Example Comparison value hidden' });
    expect(within(resultRow).getAllByRole('cell').at(-1)).toHaveTextContent('•••');
    expect(within(resultRow).getByLabelText('Comparison value hidden')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'reviewer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
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

  it('enables the per-column filter only while its comparison is revealed', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['__reference', '__comparison', '__count'],
      rows: [],
      hasNext: false,
      etag: 'revision-1',
    });

    renderPanel();

    const reviewerFilter = screen.getByRole('button', {
      name: 'Filter difference for reviewer',
    });
    expect(reviewerFilter).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Show comparison values for reviewer' }));
    expect(reviewerFilter).toBeEnabled();

    await user.click(reviewerFilter);
    expect(reviewerFilter).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide comparison values for reviewer' }));
    expect(reviewerFilter).toBeDisabled();
    expect(reviewerFilter).toHaveAttribute('aria-pressed', 'false');
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
    await user.click(screen.getByRole('button', { name: 'Compare To' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'username' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
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
    await user.click(screen.getByRole('button', { name: 'Show comparison values for reviewer' }));

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

    await user.click(screen.getByRole('button', { name: 'Show comparison values for reviewer' }));
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
    const resultRow = screen.getByRole('row', { name: 'Example covid' });
    const cells = within(resultRow).getAllByRole('cell');
    expect(cells[1]).toHaveStyle({ backgroundColor: toBgColor('#2563eb') });
    expect(cells[2]).toHaveStyle({ backgroundColor: toBgColor('#2563eb') });
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

    await user.click(screen.getByRole('button', { name: 'Show comparison values for reviewer' }));
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
