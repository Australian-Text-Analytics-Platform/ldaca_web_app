import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceControls } from '../WorkspaceControls';

const renderWithProviders = (ui: React.ReactElement) => {
  // Re-tokenise + bulk-delete invalidate workspace-graph queries through
  // useQueryClient; tests need a provider even though they don't exercise
  // those paths.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
};

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

const selectionState = { selectedNodeIds: [] as string[] };

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Main Workspace' },
    currentWorkspaceId: 'ws-1',
    workspaceGraph: mockGraph,
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
    isAuthenticated: true,
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    renameWorkspace: vi.fn(),
    deleteNode: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => ({
    selectedNodeIds: selectionState.selectedNodeIds,
  }),
}));

describe('WorkspaceControls', () => {
  it('replaces Save with a Delete (n) batch button and disables it below the threshold', () => {
    selectionState.selectedNodeIds = ['a', 'b'];
    renderWithProviders(<WorkspaceControls />);

    // Save is gone — the batch slot is repurposed for delete.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    const deleteButton = screen.getByRole('button', { name: /delete \(2\)/i });
    // Below the 3-node minimum: disabled to keep batch deletion deliberate.
    expect(deleteButton).toBeDisabled();
  });

  it('enables the Delete button once 3+ nodes are selected', () => {
    selectionState.selectedNodeIds = ['a', 'b', 'c'];
    renderWithProviders(<WorkspaceControls />);

    const deleteButton = screen.getByRole('button', { name: /delete \(3\)/i });
    expect(deleteButton).toBeEnabled();
  });
});