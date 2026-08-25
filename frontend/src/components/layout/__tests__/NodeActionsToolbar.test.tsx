import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NodeActionsToolbar } from '../NodeActionsToolbar';

const longName = 'qldelection2020_candidate_tweets_filtered_by_username_in_MarkBaileyMP';

describe('NodeActionsToolbar', () => {
  it('keeps the long-name rename dialog within the viewport and commits the rename', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();

    render(
      <NodeActionsToolbar
        node={{ id: 'node-1', name: longName }}
        isPinned={false}
        onTogglePin={vi.fn()}
        onAddToSelection={vi.fn()}
        onRename={onRename}
        onClone={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: `Actions for ${longName}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('w-[calc(100vw-2rem)]', 'min-w-0', 'max-w-lg');
    expect(screen.getByText('Enter a new name for this Data Block.')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(longName))).not.toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: 'New Data Block name' });
    expect(input).toHaveValue(longName);
    await user.clear(input);
    await user.type(input, 'Renamed Data Block');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onRename).toHaveBeenCalledWith('node-1', 'Renamed Data Block');
  });
});
