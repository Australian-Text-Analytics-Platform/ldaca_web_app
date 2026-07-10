import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceGraphFeature } from '../WorkspaceGraphFeature';

/** Captures React Flow props so graph configuration can be asserted. */
const reactFlowMock = vi.fn();

vi.mock('@xyflow/react', () => ({
  /**
   * Stubs the graph background while preserving the expected test id.
   */
  Background: () => <div data-testid="graph-background" />,
  BackgroundVariant: { Dots: 'dots' },
  /**
   * Stubs controls so children still render for graph feature assertions.
   */
  Controls: ({ children }: { children?: ReactNode }) => (
    <div data-testid="graph-controls">{children}</div>
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
}));

vi.mock('../../hooks/useWorkspaceGraph', () => ({
  /**
   * Supplies deterministic graph state for WorkspaceGraphFeature rendering.
   * Flow: return the full graph view-model shape with empty nodes, disabled controls, and spy handlers.
   */
  useWorkspaceGraph: () => ({
    nodes: [],
    edges: [],
    nodeTypes: {},
    isGraphLoading: false,
    showEmptyState: false,
    selectedCount: 0,
    totalNodes: 0,
    canClearSelection: false,
    handleNodeClick: vi.fn(),
    handleNodesChange: vi.fn(),
    handleEdgesChange: vi.fn(),
    handlePaneClick: vi.fn(),
    handleConnect: vi.fn(),
    handleConnectStart: vi.fn(),
    handleConnectEnd: vi.fn(),
    handleInit: vi.fn(),
    clearSelection: vi.fn(),
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
  }),
}));

describe('WorkspaceGraphFeature', () => {
  it('relaxes the graph zoom bounds so the full workspace can fit on screen', () => {
    render(<WorkspaceGraphFeature />);

    expect(reactFlowMock).toHaveBeenCalled();
    const props = reactFlowMock.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(props.minZoom).toBe(0.05);
    expect(props.maxZoom).toBe(4);
  });
});
