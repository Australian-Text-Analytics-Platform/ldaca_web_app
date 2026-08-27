import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SequentialAddToWorkspaceDialog } from '../SequentialAddToWorkspaceDialog';

const source = {
  node_id: '00000000-0000-0000-0000-000000000001',
  node_name: 'Events',
  document_column: 'text',
  columns: ['author', 'when', 'text', 'group', 'value'],
  period_count: 3,
  group_count: 2,
};

describe('SequentialAddToWorkspaceDialog', () => {
  it('locks the axis and defaults document and group columns in source order', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SequentialAddToWorkspaceDialog
        open
        onOpenChange={vi.fn()}
        source={source}
        axisColumn="when"
        groupByColumns={['group', 'text']}
        filterSummary="2 source rows in 1 selected period and the visible groups"
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/2 source rows in 1 selected period/)).toBeInTheDocument();
    expect(screen.getByLabelText('New Data Block name')).toHaveValue('Events_trends');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);
    expect(checkboxes.map((checkbox) => checkbox.getAttribute('data-state'))).toEqual([
      'unchecked',
      'checked',
      'checked',
      'checked',
      'unchecked',
    ]);
    expect(checkboxes[1]).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add to Workspace' }));
    expect(onSubmit).toHaveBeenCalledWith({
      sourceId: source.node_id,
      selectedColumns: ['when', 'text', 'group'],
      newName: 'Events_trends',
    });
  });
});
