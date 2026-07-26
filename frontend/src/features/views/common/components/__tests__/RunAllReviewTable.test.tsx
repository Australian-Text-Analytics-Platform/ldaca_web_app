import { useState, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RunAllReviewTable } from '../RunAllReviewTable';

const queryWorkspaceSqlTable = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable,
}));

function ReviewTable(
  props: Omit<
    ComponentProps<typeof RunAllReviewTable>,
    'comparisonColumns' | 'onComparisonColumnsChange'
  >,
) {
  const [comparisonColumns, setComparisonColumns] = useState<string[]>([]);
  return (
    <RunAllReviewTable
      {...props}
      comparisonColumns={comparisonColumns}
      onComparisonColumnsChange={setComparisonColumns}
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
        columns: ['text', 'annotation', 'reviewer_one', 'reviewer_two', 'record_id'],
        schema: [
          { name: 'text', kind: 'string' },
          { name: 'annotation', kind: 'string' },
          { name: 'reviewer_one', kind: 'string' },
          { name: 'reviewer_two', kind: 'categorical' },
          { name: 'record_id', kind: 'integer' },
        ],
        rows: [
          {
            text: 'Example',
            annotation: 'covid',
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
          requiredColumns={['text', 'annotation']}
          comparisonColumn="annotation"
          rowCount={32}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Compare To' }));
    expect(screen.queryByRole('checkbox', { name: 'record_id' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'reviewer_one' }));
    await user.click(screen.getByRole('checkbox', { name: 'reviewer_two' }));
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    expect(
      await screen.findByRole('heading', { name: 'annotation vs reviewer_one' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'annotation vs reviewer_two' })).toBeVisible();
    expect(screen.getByLabelText('annotation covid, reviewer_one job: 2 rows')).toBeInTheDocument();
    expect(screen.getByLabelText('annotation job, reviewer_one covid: 0 rows')).toBeInTheDocument();
    expect(queryWorkspaceSqlTable).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ page: 1, page_size: 500 }),
      }),
    );
  });
});
