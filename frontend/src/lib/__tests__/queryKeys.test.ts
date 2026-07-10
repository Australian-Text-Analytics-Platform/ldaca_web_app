import { describe, expect, it } from 'vitest';
import { queryKeys } from '../queryKeys';

describe('queryKeys.nodeData', () => {
  it('changes when only the filter operator changes', () => {
    const containsRequest = {
      page: 2,
      page_size: 40,
      sort_by: 'document',
      descending: true,
      filter_column: 'speaker',
      filter_value: 'Ada',
      filter_op: 'contains',
    };
    const equalsRequest = {
      ...containsRequest,
      filter_op: 'equals',
    };

    expect(queryKeys.nodeData('workspace-1', 'node-1', containsRequest)).not.toEqual(
      queryKeys.nodeData('workspace-1', 'node-1', equalsRequest),
    );
    expect(queryKeys.nodeData('workspace-1', 'node-1', equalsRequest)).toEqual([
      'workspaces',
      'workspace-1',
      'nodes',
      'node-1',
      'data',
      equalsRequest,
    ]);
  });
});
