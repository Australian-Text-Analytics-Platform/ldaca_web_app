import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceGraphFeature } from '../WorkspaceGraphFeature';

/** Captures React Flow props so graph configuration can be asserted. */
const reactFlowMock = vi.fn();
const deleteNode = vi.fn().mockResolvedValue(undefined);
const clearSelection = vi.fn();
const zoomIn = vi.fn().mockResolvedValue(undefined);
const zoomOut = vi.fn().mockResolvedValue(undefined);
const fitView = vi.fn().mockResolvedValue(undefined);
const flowStoreState = {
  transform: [0, 0, 1] as [number, number, number],
  minZoom: 0.05,
  maxZoom: 4,
};

const graphState = {
  nodes: [],
  edges: [],
  nodeTypes: {},
  isGraphLoading: false,
  showEmptyState: false,
  selectedCount: 0,
  totalNodes: 2,
  canClearSelection: false,
  handleNodeClick: vi.fn(),
  handleNodeDoubleClick: vi.fn(),
  handleNodesChange: vi.fn(),
  handleEdgesChange: vi.fn(),
  handlePaneClick: vi.fn(),
  handleConnect: vi.fn(),
  handleConnectStart: vi.fn(),
  handleConnectEnd: vi.fn(),
  handleInit: vi.fn(),
  clearSelection,
  connectionLineType: 'bezier',
  defaultEdgeOptions: {
    type: 'default',
    animated: true,
    style: {
      strokeDasharray: '6 4',
      strokeWidth: 2.5,
      stroke: '#0f172a',
    },
  },
};

const selectionState = { selectedNodeIds: [] as string[] };

vi.mock('@xyflow/react', () => ({
  /**
   * Stubs the graph background while preserving the expected test id.
   */
  Background: () => <div data-testid="graph-background" />,
  BackgroundVariant: { Dots: 'dots' },
  /**
   * Stubs controls so children still render for graph feature assertions.
   */
  Controls: ({
    children,
    orientation,
    position,
    showZoom,
    showFitView,
    showInteractive,
    ...props
  }: {
    children?: ReactNode;
    orientation?: string;
    position?: string;
    showZoom?: boolean;
    showFitView?: boolean;
    showInteractive?: boolean;
  }) => (
    <div
      data-testid="graph-controls"
      data-orientation={orientation}
      data-position={position}
      data-show-zoom={showZoom}
      data-show-fit-view={showFitView}
      data-show-interactive={showInteractive}
      {...props}
    >
      {children}
    </div>
  ),
  ControlButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  /**
   * Stubs the minimap without loading React Flow internals.
   */
  MiniMap: () => <div data-testid="graph-minimap" />,
  /**
   * Captures graph props while rendering children for component tests.
   */
  ReactFlow: ({ children, ...props }: { children?: ReactNode }) => {
    reactFlowMock(props);
    return <div data-testid="react-flow">{children}</div>;
  },
  useReactFlow: () => ({ zoomIn, zoomOut, fitView }),
  useStore: (selector: (state: typeof flowStoreState) => unknown) => selector(flowStoreState),
}));

vi.mock('../../hooks/useWorkspaceGraph', () => ({
  /**
   * Supplies deterministic graph state for WorkspaceGraphFeature rendering.
   * Flow: return the full graph view-model shape with empty nodes, disabled controls, and spy handlers.
   */
  useWorkspaceGraph: () => graphState,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspace: { id: 'ws-1', name: 'Main Workspace' },
    workspaceGraph: {
      nodes: [
        { id: 'a', name: 'Alpha', operation: 'import' },
        { id: 'b', name: 'Beta', operation: 'filter' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    },
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({ deleteNode, clearSelection }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => ({ selectedNodeIds: selectionState.selectedNodeIds }),
}));

describe('WorkspaceGraphFeature', () => {
  beforeEach(() => {
    reactFlowMock.mockClear();
    deleteNode.mockClear();
    clearSelection.mockClear();
    zoomIn.mockClear();
    zoomOut.mockClear();
    fitView.mockClear();
    selectionState.selectedNodeIds = [];
    graphState.selectedCount = 0;
    graphState.totalNodes = 2;
    graphState.canClearSelection = false;
  });

  it('relaxes the graph zoom bounds so the full workspace can fit on screen', () => {
    render(<WorkspaceGraphFeature />);

    expect(reactFlowMock).toHaveBeenCalled();
    const props = reactFlowMock.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(props.minZoom).toBe(0.05);
    expect(props.maxZoom).toBe(4);
  });

  it('puts selection, graph actions, and delete in an expandable upper-left control rail', () => {
    render(<WorkspaceGraphFeature />);

    const controls = screen.getByLabelText('Workspace graph controls');
    expect(controls).toHaveAttribute('data-orientation', 'vertical');
    expect(controls).toHaveAttribute('data-position', 'top-left');
    expect(controls).toHaveAttribute('data-show-zoom', 'false');
    expect(controls).toHaveAttribute('data-show-fit-view', 'false');
    expect(controls).toHaveAttribute('data-show-interactive', 'false');
    expect(controls).toHaveClass('group/workspace-controls');
    expect(within(controls).getByText('0/2')).toBeVisible();
    expect(within(controls).getByText('selected')).toHaveClass(
      'group-hover/workspace-controls:opacity-100',
    );

    const clearButton = within(controls).getByRole('button', { name: 'Clear selection' });
    expect(clearButton).toBeDisabled();
    expect(clearButton).toHaveClass(
      'disabled:!bg-editor',
      'disabled:!text-[var(--vscode-icon-foreground)]',
      'disabled:!opacity-40',
    );

    const deleteButton = within(controls).getByRole('button', { name: 'Delete (0)' });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveClass(
      'disabled:!bg-editor',
      'disabled:!text-[var(--vscode-icon-foreground)]',
      'disabled:!opacity-40',
    );

    const buttons = within(controls).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Zoom in',
      'Zoom out',
      'Fit view',
      'Show overview',
      'Clear selection',
      'Delete (0)',
    ]);
    for (const button of buttons) {
      expect(button).not.toHaveAttribute('title');
    }
  });

  it('uses explicit graph buttons for viewport actions', () => {
    render(<WorkspaceGraphFeature />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));

    expect(zoomIn).toHaveBeenCalledOnce();
    expect(zoomOut).toHaveBeenCalledOnce();
    expect(fitView).toHaveBeenCalledWith({ padding: 0.2, includeHiddenNodes: false });
  });

  it('keeps the overview and clear-selection actions wired from the relocated rail', () => {
    graphState.selectedCount = 1;
    graphState.canClearSelection = true;
    render(<WorkspaceGraphFeature />);

    fireEvent.click(screen.getByRole('button', { name: 'Show overview' }));
    expect(screen.getByTestId('graph-minimap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide overview' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it('deletes the selected data blocks from the graph toolbar after confirmation', async () => {
    selectionState.selectedNodeIds = ['b', 'a'];
    graphState.selectedCount = 2;
    graphState.canClearSelection = true;
    render(<WorkspaceGraphFeature />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete (2)' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
    expect(within(dialog).getByText('Beta')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2' }));

    await waitFor(() => {
      expect(deleteNode).toHaveBeenCalledTimes(2);
      expect(clearSelection).toHaveBeenCalledOnce();
    });
    expect(deleteNode).toHaveBeenNthCalledWith(1, 'a');
    expect(deleteNode).toHaveBeenNthCalledWith(2, 'b');
  });
});
