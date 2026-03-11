import React from 'react';
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
        pageSizeLabel="Documents searched per page"
      />,
    );

    expect(screen.getByText('Documents searched per page')).toBeInTheDocument();
  });
});
