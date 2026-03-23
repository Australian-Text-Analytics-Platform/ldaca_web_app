import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WorkspaceControls } from '../WorkspaceControls';

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Main Workspace' },
  }),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    saveWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    setCurrentWorkspace: vi.fn(),
  }),
}));

describe('WorkspaceControls', () => {
  it('does not render a workspace Save As action', () => {
    render(<WorkspaceControls />);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save as/i })).not.toBeInTheDocument();
  });
});