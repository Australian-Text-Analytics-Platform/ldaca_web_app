import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

import { WorkspaceControls } from '../WorkspaceControls';

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Main Workspace' },
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    saveWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    setCurrentWorkspace: vi.fn(),
  }),
}));

describe('WorkspaceControls', () => {
  it('renders save without rendering unload or a Save As action', () => {
    render(<TooltipProvider><WorkspaceControls /></TooltipProvider>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save as/i })).not.toBeInTheDocument();
  });
});