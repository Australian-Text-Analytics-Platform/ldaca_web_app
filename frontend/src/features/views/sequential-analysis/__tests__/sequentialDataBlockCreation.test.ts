import { describe, expect, it } from 'vitest';

import { buildSequentialDataBlockCreationRequest } from '../sequentialDataBlockCreation';

const selection = {
  sourceId: '00000000-0000-0000-0000-000000000001',
  selectedColumns: ['when', 'text', 'group'],
  newName: 'Events_trends',
};

describe('buildSequentialDataBlockCreationRequest', () => {
  it('preserves the selected periods, hidden groups, columns, and name', () => {
    expect(buildSequentialDataBlockCreationRequest(selection, [4, 7], [2])).toEqual({
      kind: 'sequential_data_block_creation',
      source: {
        source_node_id: selection.sourceId,
        selected_columns: ['when', 'text', 'group'],
        new_node_name: 'Events_trends',
        selected_period_indices: [4, 7],
        excluded_group_indices: [2],
      },
    });
  });

  it('uses null to mean every period', () => {
    expect(buildSequentialDataBlockCreationRequest(selection, [], []).source).toEqual(
      expect.objectContaining({
        selected_period_indices: null,
        excluded_group_indices: [],
      }),
    );
  });
});
