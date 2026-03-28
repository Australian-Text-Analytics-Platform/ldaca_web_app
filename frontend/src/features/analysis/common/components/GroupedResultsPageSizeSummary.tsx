import React from 'react';

interface GroupedResultsPageSizeSummaryProps<Row extends Record<string, unknown> = Record<string, unknown>> {
  groups: Row[][];
}

const countGroupedResultInstances = <Row extends Record<string, unknown>>(groups: Row[][]): number => {
  return groups.reduce((total, group) => total + group.length, 0);
};

const countGroupedResultDocuments = <Row extends Record<string, unknown>>(groups: Row[][]): number => {
  return groups.length;
};

export function GroupedResultsPageSizeSummary<Row extends Record<string, unknown>>({
  groups,
}: GroupedResultsPageSizeSummaryProps<Row>) {
  const instanceCount = countGroupedResultInstances(groups);
  const documentCount = countGroupedResultDocuments(groups);

  return (
    <>
      (Found {instanceCount} instance{instanceCount === 1 ? '' : 's'} in {documentCount} document{documentCount === 1 ? '' : 's'}).
    </>
  );
}