import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceDataHeader } from '../WorkspaceDataHeader';

describe('WorkspaceDataHeader', () => {
  it('shows undo redo delete controls and omits extra metadata labels', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onDelete = vi.fn();

    render(
      <WorkspaceDataHeader
        info={{
          nodeLabel: 'sample_data/ADO/qldelection2020_candidate_tweets_conc',
          tabPosition: 1,
          totalTabs: 1,
          isEmptyTable: false,
        }}
        showTabMeta={false}
        onUndo={onUndo}
        onRedo={onRedo}
        onDelete={onDelete}
        canUndo
        canRedo={false}
      />
    );

    expect(screen.queryByText(/rows loaded/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/shape:/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});