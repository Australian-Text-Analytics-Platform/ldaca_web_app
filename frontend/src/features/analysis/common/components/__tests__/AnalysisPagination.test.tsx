import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalysisPagination } from '../AnalysisPagination';

describe('AnalysisPagination', () => {
  const baseProps = {
    page: 1,
    pageSize: 20,
    hasNext: true,
    hasPrev: false,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it('shows the default page-size label', () => {
    render(<AnalysisPagination {...baseProps} />);

    expect(screen.getByText('Rows per page')).toBeInTheDocument();
  });

  it('shows a custom page-size label when provided', () => {
    render(
      <AnalysisPagination
        {...baseProps}
        pageSizeLabel="Documents per page"
        pageSizeSummary="(Found 3 instances in 2 documents)."
      />,
    );

    expect(screen.getByText('Documents per page')).toBeInTheDocument();
    expect(screen.getByText('(Found 3 instances in 2 documents).')).toBeInTheDocument();
  });
});
