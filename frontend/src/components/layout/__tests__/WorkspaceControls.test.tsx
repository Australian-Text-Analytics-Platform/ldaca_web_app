import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceControls } from '../WorkspaceControls';

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /**
   * Supplies workspace identity and graph roots consumed by `WorkspaceControls`.
   */
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Main Workspace' },
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Used by: WorkspaceControls tests to provide action spies. */
  useWorkspaceActions: () => ({
    renameWorkspace: vi.fn(),
  }),
}));

describe('WorkspaceControls', () => {
  it('keeps workspace identity actions in the header and leaves deletion to the graph toolbar', () => {
    render(
      <TooltipProvider>
        <WorkspaceControls />
      </TooltipProvider>,
    );

    expect(screen.getByRole('button', { name: 'Rename workspace' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
