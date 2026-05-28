import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceControls } from '../WorkspaceControls';

/** Workspace graph fixture used to verify batch-delete selection counts and root sorting behavior. */
const mockGraph = {
  nodes: [
    { id: 'a', name: 'Alpha', operation: 'import' },
    { id: 'b', name: 'Beta', operation: 'filter' },
    { id: 'c', name: 'Gamma', operation: 'filter' },
  ],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ],
};

/** Mutable selection fixture consumed by the mocked selection hook in each test. */
const selectionState = { selectedNodeIds: [] as string[] };

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /**
   * Supplies workspace identity and graph roots consumed by `WorkspaceControls`.
   * Why: tests need stable fixtures and mocks before exercising the behavior under assertion.
   */
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Main Workspace' },
    workspaceGraph: mockGraph,
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Used by: WorkspaceControls tests to provide action spies because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useWorkspaceActions: () => ({
    renameWorkspace: vi.fn(),
    deleteNode: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  /** Used by: WorkspaceControls tests to expose the mutable selected-node fixture because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useWorkspaceSelection: () => ({
    selectedNodeIds: selectionState.selectedNodeIds,
  }),
}));

describe('WorkspaceControls', () => {
  it('replaces Save with a Delete (n) batch button and disables it below the threshold', () => {
    selectionState.selectedNodeIds = ['a', 'b'];
    render(
      <TooltipProvider>
        <WorkspaceControls />
      </TooltipProvider>,
    );

    // Save is gone — the batch slot is repurposed for delete.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    const deleteButton = screen.getByRole('button', { name: /delete \(2\)/i });
    // Below the 3-node minimum: disabled to keep batch deletion deliberate.
    expect(deleteButton).toBeDisabled();
  });

  it('enables the Delete button once 3+ nodes are selected', () => {
    selectionState.selectedNodeIds = ['a', 'b', 'c'];
    render(
      <TooltipProvider>
        <WorkspaceControls />
      </TooltipProvider>,
    );

    const deleteButton = screen.getByRole('button', { name: /delete \(3\)/i });
    expect(deleteButton).toBeEnabled();
  });
});
