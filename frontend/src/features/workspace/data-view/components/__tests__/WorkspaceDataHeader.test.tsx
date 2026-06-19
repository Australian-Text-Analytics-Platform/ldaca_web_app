import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceDataHeader } from '../WorkspaceDataHeader';

describe('WorkspaceDataHeader', () => {
  it('shows compact icon-only info undo redo controls', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    render(
      <TooltipProvider>
        <WorkspaceDataHeader
          info={{
            nodeLabel: 'sample_data/ADO/qldelection2020_candidate_tweets_conc',
            tabPosition: 1,
            totalTabs: 1,
            isEmptyTable: false,
          }}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo
          canRedo={false}
        />
      </TooltipProvider>,
    );

    const infoButton = screen.getByRole('button', { name: 'Info' });
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    const redoButton = screen.getByRole('button', { name: 'Redo' });

    expect(infoButton.textContent).toBe('');
    expect(undoButton.textContent).toBe('');
    expect(redoButton.textContent).toBe('');

    await user.click(undoButton);
    expect(onUndo).toHaveBeenCalledTimes(1);

    expect(redoButton).toBeDisabled();
  });

  it('keeps the selected node name in a leading-fade single-line wrapper', () => {
    const longName = 'reddit/reddit_comments_topic_sampled_fr_0_1_rs_42_topic_meanings';

    render(
      <TooltipProvider>
        <WorkspaceDataHeader
          info={{
            nodeLabel: longName,
            tabPosition: 1,
            totalTabs: 1,
            isEmptyTable: false,
          }}
          onRename={vi.fn()}
        />
      </TooltipProvider>,
    );

    const nodeName = screen.getByText(longName);
    expect(nodeName).toBeInTheDocument();
    expect(screen.getByTestId('workspace-data-node-label')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('workspace-data-node-label-fade')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename node' })).toBeInTheDocument();
  });
});
