import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/**
 * Models a transport that can cheaply report only whether another page exists.
 * Used by: the unknown-total regression to ensure the footer does not expose an
 * exact-page action without a trustworthy upper bound.
 */
function LookaheadHarness() {
  const table = useServerTable<Row>({
    data: [{ id: 1 }],
    columns: [{ id: 'id', accessorKey: 'id', header: 'ID' }],
    rowCount: 40,
    pageIndex: 0,
    pageSize: 20,
  });

  return <ServerPaginationFooter table={table} pageIndex={0} pageSize={20} hasNext />;
}

describe('ServerPaginationFooter controlled pagination', () => {
  it('shows a non-clickable ellipsis when only page lookahead is known', () => {
    render(<LookaheadHarness />);

    expect(screen.queryByRole('button', { name: 'Jump to page' })).not.toBeInTheDocument();
    expect(screen.getByText('More pages')).toBeInTheDocument();
  });

  it('validates and jumps to an exact page when the total is known', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);

    await user.click(screen.getByRole('button', { name: 'Jump to page' }));
    const pageInput = screen.getByRole('textbox');
    await user.type(pageInput, '51');
    await user.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.getByText('Enter a value between 1 and 50')).toBeInTheDocument();

    await user.clear(pageInput);
    await user.type(pageInput, '0');
    await user.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.getByText('Enter a value between 1 and 50')).toBeInTheDocument();

    await user.clear(pageInput);
    await user.type(pageInput, '50');
    await user.click(screen.getByRole('button', { name: 'Go' }));

    expect(screen.getByTestId('page-source')).toHaveTextContent('50');
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('50');
  });

  // The footer is controlled by the backend-facing pagination props; the
  // narrowed table value only dispatches page actions.
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
