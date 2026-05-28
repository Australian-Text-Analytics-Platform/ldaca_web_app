import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceDataHeader } from '../WorkspaceDataHeader';

describe('WorkspaceDataHeader', () => {
  it('shows undo redo controls', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
