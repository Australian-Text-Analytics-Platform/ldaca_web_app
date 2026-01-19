import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/api/http';
import { WorkspaceControls } from '../WorkspaceControls';

const mockUseWorkspaceData = vi.fn();
const mockUseWorkspaceActions = vi.fn();

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => mockUseWorkspaceData(),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => mockUseWorkspaceActions(),
}));

describe('WorkspaceControls', () => {
  it('shows an alert dialog when rename fails validation', async () => {
    const renameWorkspace = vi.fn().mockRejectedValue(
      new ApiError('Invalid workspace name: "/" is not allowed'),
    );

    mockUseWorkspaceData.mockReturnValue({
      currentWorkspace: { name: 'My Workspace' },
    });
    mockUseWorkspaceActions.mockReturnValue({
      renameWorkspace,
      saveWorkspace: vi.fn(),
      saveWorkspaceAs: vi.fn(),
      setCurrentWorkspace: vi.fn(),
    });

    render(<WorkspaceControls />);

    await userEvent.click(screen.getByRole('button', { name: /rename workspace/i }));

    const input = screen.getByLabelText(/workspace name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Bad/Name{enter}');

    expect(
      await screen.findByText(/invalid workspace name: "\/" is not allowed/i)
    ).toBeInTheDocument();
    expect(renameWorkspace).toHaveBeenCalledWith('Bad/Name');
  });
});
