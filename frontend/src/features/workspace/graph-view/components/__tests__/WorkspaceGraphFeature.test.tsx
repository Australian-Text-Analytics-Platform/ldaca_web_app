import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { WorkspaceGraphFeature } from '../WorkspaceGraphFeature';

const reactFlowMock = vi.fn();

vi.mock('@xyflow/react', () => ({
  Background: () => <div data-testid="graph-background" />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: ({ children }: { children?: ReactNode }) => <div data-testid="graph-controls">{children}</div>,
  MiniMap: () => <div data-testid="graph-minimap" />,
  ReactFlow: ({ children, ...props }: { children?: ReactNode }) => {
    reactFlowMock(props);
    return <div data-testid="react-flow">{children}</div>;
  },
}));

// The TokensCacheRepairBanner mounted above the graph reads workspace data
// from a React context the test harness doesn't provide. Stub the hook so
// the banner can render (it'll early-return because the stub graph has no
// tokens_cache_repair payload) without crashing the test.
vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    workspaceGraph: { nodes: [], edges: [] },
    currentWorkspaceId: 'ws-1',
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}), isAuthenticated: true }),
}));

vi.mock('../../hooks/useWorkspaceGraph', () => ({
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WorkspaceGraphFeature />
      </QueryClientProvider>,
    );

    expect(reactFlowMock).toHaveBeenCalled();
    const props = reactFlowMock.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(props.minZoom).toBe(0.05);
    expect(props.maxZoom).toBe(4);
  });
});