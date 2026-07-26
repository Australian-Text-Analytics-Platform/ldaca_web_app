import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { NodeInputPointerCarrier } from '../NodeInputPointerCarrier';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useUIStore: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/stores', () => ({
  useUIStore: mocks.useUIStore,
}));

describe('NodeInputPointerCarrier', () => {
  beforeEach(() => {
    useNodeInputRequestsStore.setState({ nextId: 1, pendingRequests: [] });
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [
        { id: 'node-a', name: 'Corpus A' },
        { id: 'node-b', name: 'Corpus B' },
      ],
    });
    mocks.useUIStore.mockImplementation((selector: (state: { currentView: string }) => unknown) =>
      selector({ currentView: 'annotation' }),
    );
  });

  it('follows the pointer and displays the carried Data Blocks as a LIFO stack', () => {
    act(() => {
      useNodeInputRequestsStore
        .getState()
        .requestAdd('workspace-1', 'annotation', 'node-a', { x: 40, y: 60 });
    });
    render(<NodeInputPointerCarrier />);

    const firstCarrier = screen.getByRole('status', { name: 'Carrying 1 Data Block' });
    expect(firstCarrier).toHaveStyle({ left: '56px', top: '76px' });

    fireEvent.pointerMove(window, { clientX: 200, clientY: 240 });
    expect(firstCarrier).toHaveStyle({ left: '216px', top: '256px' });

    fireEvent.pointerMove(window, { clientX: 300, clientY: 320 });
    act(() => {
      useNodeInputRequestsStore
        .getState()
        .requestAdd('workspace-1', 'annotation', 'node-b', { x: 300, y: 320 });
    });

    const stack = screen.getByRole('status', { name: 'Carrying 2 Data Blocks' });
    expect(stack).toHaveTextContent('Corpus A');
    expect(stack).toHaveTextContent('Corpus B');
    expect(stack).toHaveTextContent('Next');
    expect(stack).toHaveStyle({
      left: '316px',
      top: '336px',
    });
  });

  it('clears the complete carried stack with Escape', () => {
    act(() => {
      useNodeInputRequestsStore
        .getState()
        .requestAdd('workspace-1', 'annotation', 'node-a', { x: 40, y: 60 });
      useNodeInputRequestsStore
        .getState()
        .requestAdd('workspace-1', 'annotation', 'node-b', { x: 80, y: 100 });
    });
    render(<NodeInputPointerCarrier />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(useNodeInputRequestsStore.getState().pendingRequests).toEqual([]);
  });

  it('discards only the latest Data Block and suppresses the context menu on right-click', () => {
    act(() => {
      useNodeInputRequestsStore
        .getState()
        .requestAdd('workspace-1', 'annotation', 'node-a', { x: 40, y: 60 });
      useNodeInputRequestsStore
        .getState()
        .requestAdd('workspace-1', 'annotation', 'node-b', { x: 80, y: 100 });
    });
    render(<NodeInputPointerCarrier />);

    expect(fireEvent.contextMenu(window)).toBe(false);

    const carrier = screen.getByRole('status', { name: 'Carrying 1 Data Block' });
    expect(carrier).toHaveTextContent('Corpus A');
    expect(carrier).not.toHaveTextContent('Corpus B');
    expect(useNodeInputRequestsStore.getState().pendingRequests).toHaveLength(1);
  });
});
