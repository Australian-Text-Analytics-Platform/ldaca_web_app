import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GroupedResultsPageSizeSummary } from '../GroupedResultsPageSizeSummary';

describe('GroupedResultsPageSizeSummary', () => {
  it('formats grouped result counts for multiple documents', () => {
    render(
      <GroupedResultsPageSizeSummary
        groups={[
          [{ id: 'a1' }, { id: 'a2' }],
          [{ id: 'b1' }],
        ]}
      />,
    );

    expect(screen.getByText('(Found 3 instances in 2 documents).')).toBeInTheDocument();
  });

  it('formats grouped result counts for a single document', () => {
    render(
      <GroupedResultsPageSizeSummary
        groups={[
          [{ id: 'a1' }],
        ]}
      />,
    );

    expect(screen.getByText('(Found 1 instance in 1 document).')).toBeInTheDocument();
  });

  it('includes total processed count when provided', () => {
    render(
      <GroupedResultsPageSizeSummary
        groups={[
          [{ id: 'a1' }, { id: 'a2' }],
          [{ id: 'b1' }],
        ]}
        totalProcessed={100}
      />,
    );

    expect(screen.getByText('(Found 3 instances in 2 documents after processing 100 documents).')).toBeInTheDocument();
  });

  it('uses totalInstances and totalDocuments overrides when provided', () => {
    render(
      <GroupedResultsPageSizeSummary
        groups={[]}
        totalInstances={500}
        totalDocuments={120}
        totalProcessed={2380}
      />,
    );

    expect(screen.getByText('(Found 500 instances in 120 documents after processing 2380 documents).')).toBeInTheDocument();
  });
});