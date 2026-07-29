import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import type { AnnotationDifferenceFilter } from '@/features/views/annotation/annotationDifferenceQuery';
import { RunAllReviewTable } from '../RunAllReviewTable';

const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());
const setCell = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
}));
vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({ setCell }),
}));

function ReviewTable({
  correctionColumn,
  ...props
}: Omit<
  ComponentProps<typeof RunAllReviewTable>,
  | 'comparisonColumns'
  | 'onComparisonColumnsChange'
  | 'metadataColumns'
  | 'onMetadataColumnsChange'
  | 'reliabilityMetric'
  | 'onReliabilityMetricChange'
  | 'correction'
  | 'differenceFilter'
  | 'onDifferenceFilterChange'
> & { correctionColumn?: string }) {
  const [comparisonColumns, setComparisonColumns] = useState<string[]>([]);
  const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
  const [selectedCorrectionColumn, setSelectedCorrectionColumn] = useState(
    correctionColumn ?? null,
  );
  const [reliabilityMetric, setReliabilityMetric] =
    useState<IntercoderReliabilityMetric>('cohens_kappa');
  const [differenceFilter, setDifferenceFilter] = useState<AnnotationDifferenceFilter | null>(null);
  return (
    <RunAllReviewTable
      {...props}
      comparisonColumns={comparisonColumns}
      onComparisonColumnsChange={setComparisonColumns}
      metadataColumns={metadataColumns}
      onMetadataColumnsChange={setMetadataColumns}
      reliabilityMetric={reliabilityMetric}
      onReliabilityMetricChange={setReliabilityMetric}
      differenceFilter={differenceFilter}
      onDifferenceFilterChange={setDifferenceFilter}
      correction={{
        column: selectedCorrectionColumn,
        classOptions: ['label', 'corrected'],
        onColumnChange: setSelectedCorrectionColumn,
        onCreate: vi.fn(),
        onUseAsExample: vi.fn(),
      }}
    />
  );
}

describe('RunAllReviewTable', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    setCell.mockReset();
    setCell.mockResolvedValue(undefined);
  });
  it('renders Review rows in the shared analysis table frame', async () => {
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['text', 'annotation'],
      schema: [
        { name: 'text', kind: 'string' },
        { name: 'annotation', kind: 'string' },
      ],
      rows: [{ text: 'Example', annotation: 'label' }],
      hasNext: false,
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReviewTable
          workspaceId="workspace-1"
          nodeId="node-1"
          sourceColumns={['text', 'annotation']}
          sourceColor="#2563eb"
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation']}
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Example')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-table-scroll-area')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('rowgroup')[0]).toHaveClass(
      'sticky',
      'top-0',
      'z-10',
      'bg-card',
    );
    expect(screen.getByLabelText('Rows per page')).toHaveTextContent('10');
    expect(screen.getByRole('link', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '4' })).toBeInTheDocument();
  });

  it('loads the selected Review page through the shared numbered pagination', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockImplementation(({ body }) =>
      Promise.resolve({
        columns: ['text', 'annotation'],
        schema: [
          { name: 'text', kind: 'string' },
          { name: 'annotation', kind: 'string' },
        ],
        rows: [{ text: `Page ${String(body.page)}`, annotation: 'label' }],
        hasNext: body.page < 4,
      }),
    );

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReviewTable
          workspaceId="workspace-1"
          nodeId="node-1"
          sourceColumns={['text', 'annotation']}
          sourceColor="#2563eb"
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation']}
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Page 1')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '2' }));

    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ page: 2, page_size: 10 }),
      }),
    );
  });

  it('shows only required columns until metadata is selected', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['text', 'annotation', 'username'],
      schema: [
        { name: 'text', kind: 'string' },
        { name: 'annotation', kind: 'string' },
        { name: 'username', kind: 'string' },
      ],
      rows: [{ text: 'Example', annotation: 'label', username: 'alice' }],
      hasNext: false,
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReviewTable
          workspaceId="workspace-1"
          nodeId="node-1"
          sourceColumns={['text', 'annotation', 'username']}
          sourceColor="#2563eb"
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation']}
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('columnheader', { name: 'text' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /annotation/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'username' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'username' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('columnheader', { name: 'username' })).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('always shows the selected correction and removes it only by selecting None', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: [
        '__wordflow_annotation_source_row_index',
        'text',
        'annotation',
        'correction',
        'username',
      ],
      schema: [
        { name: '__wordflow_annotation_source_row_index', kind: 'integer' },
        { name: 'text', kind: 'string' },
        { name: 'annotation', kind: 'string' },
        { name: 'correction', kind: 'string' },
        { name: 'username', kind: 'string' },
      ],
      rows: [
        {
          __wordflow_annotation_source_row_index: 0,
          text: 'Example',
          annotation: 'label',
          correction: 'corrected',
          username: 'alice',
        },
      ],
      hasNext: false,
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReviewTable
          workspaceId="workspace-1"
          nodeId="node-1"
          sourceColumns={['text', 'annotation', 'correction', 'username']}
          sourceColor="#2563eb"
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation', 'correction']}
          correctionColumn="correction"
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('columnheader', { name: 'Correction: correction' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use as example' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Correction for row 1' }));
    await user.click(screen.getByRole('option', { name: 'label' }));
    await waitFor(() => {
      expect(setCell).toHaveBeenCalledWith('node-1', 'correction', 0, 'label');
    });
    await user.click(screen.getByRole('combobox', { name: 'Correction column' }));
    await user.click(screen.getByRole('option', { name: 'None' }));

    expect(
      screen.queryByRole('columnheader', { name: 'Correction: correction' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'correction' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  it('compares the full annotation column with multiple selected columns', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockImplementation(({ body }) => {
      if (body.sql.includes('COUNT(*)')) {
        const targetColumn = body.sql.includes('"reviewer_two"') ? 'reviewer_two' : 'reviewer_one';
        return Promise.resolve({
          columns: ['__reference', '__comparison', '__count'],
          rows:
            targetColumn === 'reviewer_one'
              ? body.page === 1
                ? [{ __reference: 'covid', __comparison: 'covid', __count: 8 }]
                : [
                    { __reference: 'covid', __comparison: 'job', __count: 2 },
                    { __reference: 'job', __comparison: 'job', __count: 5 },
                  ]
              : [{ __reference: 'job', __comparison: 'other', __count: 4 }],
          hasNext: targetColumn === 'reviewer_one' && body.page === 1,
          etag: 'revision-1',
        });
      }
      return Promise.resolve({
        columns: ['text', 'annotation', 'correction', 'reviewer_one', 'reviewer_two', 'record_id'],
        schema: [
          { name: 'text', kind: 'string' },
          { name: 'annotation', kind: 'string' },
          { name: 'correction', kind: 'string' },
          { name: 'reviewer_one', kind: 'string' },
          { name: 'reviewer_two', kind: 'categorical' },
          { name: 'record_id', kind: 'integer' },
        ],
        rows: [
          {
            text: 'Example',
            annotation: 'covid',
            correction: 'job',
            reviewer_one: 'job',
            reviewer_two: 'other',
            record_id: 10,
          },
        ],
        hasNext: false,
        etag: 'revision-1',
      });
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReviewTable
          workspaceId="workspace-1"
          nodeId="node-1"
          sourceColumns={[
            'text',
            'annotation',
            'correction',
            'reviewer_one',
            'reviewer_two',
            'record_id',
          ]}
          sourceColor="#2563eb"
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation', 'correction']}
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Compare To' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'record_id' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'reviewer_one' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'reviewer_two' }));
    await user.keyboard('{Escape}');

    expect(
      await screen.findByRole('button', {
        name: 'Cohen’s Kappa 0.727 for annotation versus reviewer_one',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Cohen’s Kappa 0.000 for annotation versus reviewer_two',
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: /annotation vs reviewer/ }),
    ).not.toBeInTheDocument();
    const reviewTable = screen.getAllByRole('table')[0];
    const headers = within(reviewTable).getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('text');
    expect(headers[1]).toHaveTextContent('annotation');
    expect(headers[2]).toHaveTextContent('correction');
    expect(within(headers[3]).getByText('reviewer_one')).toBeInTheDocument();
    expect(within(headers[4]).getByText('reviewer_two')).toBeInTheDocument();
    expect(
      within(headers[3]).getByRole('button', { name: 'Filter difference for reviewer_one' }),
    ).toHaveAttribute('aria-pressed', 'false');
    const anyFilter = within(headers[1]).getByRole('button', {
      name: 'Filter any difference for annotation',
    });
    await user.click(anyFilter);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Filter any difference for annotation' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
    await user.click(screen.getByRole('button', { name: 'Filter difference for reviewer_one' }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Filter any difference for annotation' }),
      ).toHaveAttribute('aria-pressed', 'false');
      expect(
        screen.getByRole('button', { name: 'Filter difference for reviewer_one' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });
    const filteredReviewTable = screen.getAllByRole('table')[0];
    expect(
      within(filteredReviewTable).getByRole('row', { name: 'Example covid job job other' }),
    ).toBeInTheDocument();
    const resultCells = within(
      within(filteredReviewTable).getByRole('row', { name: 'Example covid job job other' }),
    ).getAllByRole('cell');
    expect(resultCells[1]).toHaveAttribute('style', expect.stringContaining('background-color'));
    expect(resultCells[3]).toHaveAttribute('style', expect.stringContaining('background-color'));
    expect(resultCells[4]).toHaveAttribute('style', expect.stringContaining('background-color'));
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ page: 1, page_size: 500 }),
      }),
    );
  });
});
