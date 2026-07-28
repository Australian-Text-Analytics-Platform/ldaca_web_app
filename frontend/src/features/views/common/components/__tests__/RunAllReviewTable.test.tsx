import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import { RunAllReviewTable } from '../RunAllReviewTable';

const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
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
> & { correctionColumn?: string }) {
  const [comparisonColumns, setComparisonColumns] = useState<string[]>([]);
  const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
  const [correctionVisible, setCorrectionVisible] = useState(true);
  const [reliabilityMetric, setReliabilityMetric] =
    useState<IntercoderReliabilityMetric>('cohens_kappa');
  return (
    <RunAllReviewTable
      {...props}
      comparisonColumns={comparisonColumns}
      onComparisonColumnsChange={setComparisonColumns}
      metadataColumns={metadataColumns}
      onMetadataColumnsChange={setMetadataColumns}
      reliabilityMetric={reliabilityMetric}
      onReliabilityMetricChange={setReliabilityMetric}
      correction={
        correctionColumn
          ? {
              column: correctionColumn,
              visible: correctionVisible,
              onVisibleChange: setCorrectionVisible,
            }
          : undefined
      }
    />
  );
}

describe('RunAllReviewTable', () => {
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
          nodeIds={['node-1']}
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
          nodeIds={['node-1']}
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
          nodeIds={['node-1']}
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation']}
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('columnheader', { name: 'text' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'annotation' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'username' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'username' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('columnheader', { name: 'username' })).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('shows the correction column by default and hides it without exposing it as metadata', async () => {
    const user = userEvent.setup();
    queryWorkspaceSqlTable.mockResolvedValue({
      columns: ['text', 'annotation', 'correction', 'username'],
      schema: [
        { name: 'text', kind: 'string' },
        { name: 'annotation', kind: 'string' },
        { name: 'correction', kind: 'string' },
        { name: 'username', kind: 'string' },
      ],
      rows: [{ text: 'Example', annotation: 'label', correction: 'corrected', username: 'alice' }],
      hasNext: false,
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReviewTable
          workspaceId="workspace-1"
          nodeIds={['node-1']}
          sql={'SELECT * FROM "node-1"'}
          title="Annotation"
          requiredColumns={['text', 'annotation', 'correction']}
          correctionColumn="correction"
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('columnheader', { name: 'correction' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide correction' }));

    expect(screen.queryByRole('columnheader', { name: 'correction' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show metadata' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'correction' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Show correction' }));
    expect(screen.getByRole('columnheader', { name: 'correction' })).toBeInTheDocument();
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
          nodeIds={['node-1']}
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
    expect(headers.slice(0, 3).map((header) => header.textContent)).toEqual([
      'text',
      'annotation',
      'correction',
    ]);
    expect(within(headers[3]).getByText('reviewer_one')).toBeInTheDocument();
    expect(within(headers[4]).getByText('reviewer_two')).toBeInTheDocument();
    expect(
      within(reviewTable).getByRole('row', { name: 'Example covid job job other' }),
    ).toBeInTheDocument();
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ page: 1, page_size: 500 }),
      }),
    );
  });
});
