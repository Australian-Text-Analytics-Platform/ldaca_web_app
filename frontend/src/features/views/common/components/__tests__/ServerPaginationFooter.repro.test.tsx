import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useServerTable } from '../../hooks/useServerTable';
import { ServerPaginationFooter } from '../ServerPaginationFooter';

interface Row {
  id: number;
}

function ControlledHarness() {
  const [page, setPage] = useState(1); // 1-based, like concordance currentPage
  const table = useServerTable<Row>({
    data: [{ id: page }],
    columns: [{ id: 'id', accessorKey: 'id', header: 'ID' }],
    rowCount: 1000,
    pageIndex: page - 1,
    pageSize: 20,
    onPaginationChange: (next) => {
      const newPage = next.pageIndex + 1;
      if (newPage !== page) setPage(newPage);
    },
  });
  return (
    <div>
      <span data-testid="page-source">{page}</span>
      <ServerPaginationFooter table={table} pageIndex={page - 1} pageSize={20} rowCount={1000} />
    </div>
  );
}

describe('ServerPaginationFooter controlled pagination', () => {
  // Regression guard for the React Compiler memoization bug: the footer receives
  // a referentially stable TanStack `table`, so its DISPLAY must be driven by the
  // real `pageIndex` prop. If the footer ever reads `table.getState()` again, the
  // highlighted page freezes on 1 and this test fails.
  it('advances the displayed active page when Next is clicked', () => {
    render(<ControlledHarness />);
    expect(screen.getByTestId('page-source')).toHaveTextContent('1');
    // The active page link is marked aria-current="page".
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('link', { name: /next/i }));

    expect(screen.getByTestId('page-source')).toHaveTextContent('2');
    // This is the real assertion: the FOOTER's highlighted page must advance.
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('2');
  });
});
