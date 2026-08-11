import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Utf8 } from 'apache-arrow';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useRecentSelectionsStore } from '@/stores/recentSelectionsStore';
import type { AnalysisTabInput } from '../../tabs/tabStateOps';
import { useTabNodeInputs } from '../useTabNodeInputs';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useWorkspaceSelection: vi.fn(),
  useNodeColumnInfos: vi.fn(),
  useUIStore: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: mocks.useWorkspaceSelection,
}));

vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  useNodeColumnInfos: mocks.useNodeColumnInfos,
}));

vi.mock('@/stores', () => ({
  useUIStore: mocks.useUIStore,
}));

function RequestBridgeHarness({
  onInputSetChange,
  deferNodeInputPlacement = false,
}: {
  onInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
  deferNodeInputPlacement?: boolean;
}) {
  const nodeInputs = useTabNodeInputs({
    tabInputSets: { source: [] },
    onTabInputSetChange: onInputSetChange,
    constraints: { maxNodes: 1 },
    deferNodeInputPlacement,
  });

  return (
    <NodeInputsPanel
      title="Preprocessing Inputs"
      resolvedNodes={nodeInputs.resolvedNodes}
      availableNodes={nodeInputs.availableNodes}
      graphSelectedIds={nodeInputs.graphSelectedIds}
      recentPresets={nodeInputs.recentPresets}
      canAddMore={nodeInputs.canAddMore}
      maxNodes={1}
      onAddNodes={nodeInputs.addNodes}
      getAddRejection={nodeInputs.getAddRejection}
      onRemoveNode={nodeInputs.removeNode}
      onClear={nodeInputs.clear}
      onColumnChange={nodeInputs.setColumn}
    />
  );
}

describe('node input request bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeInputRequestsStore.setState({
      nextId: 1,
      pendingRequests: [],
    });
    useRecentSelectionsStore.setState({ byWorkspace: {} });
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [{ id: 'node-a', name: 'Node A' }],
    });
    mocks.useWorkspaceSelection.mockReturnValue({ selectedNodeIds: [] });
    mocks.useNodeColumnInfos.mockReturnValue({
      getColumnInfos: () => [
        { name: 'text', typeName: 'Utf8', field: new Field('text', new Utf8()) },
      ],
      nodeInfoById: {},
    });
    mocks.useUIStore.mockImplementation((selector: (state: { currentView: string }) => unknown) =>
      selector({ currentView: 'filter' }),
    );
  });

  it('adds a matching request directly when this is the only placement area', async () => {
    const onInputSetChange = vi.fn();
    useNodeInputRequestsStore.setState({
      nextId: 2,
      pendingRequests: [{ id: 1, workspaceId: 'workspace-1', view: 'filter', nodeId: 'node-a' }],
    });

    render(
      <StrictMode>
        <RequestBridgeHarness onInputSetChange={onInputSetChange} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(onInputSetChange).toHaveBeenCalledWith('source', [
        { node_id: 'node-a', column: 'text' },
      ]);
    });
    expect(useNodeInputRequestsStore.getState().pendingRequests).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Add to Preprocessing Inputs' })).toBeNull();
    expect(onInputSetChange).toHaveBeenCalledOnce();
  });

  it('keeps a request carried when a multi-area view defers placement', async () => {
    const user = userEvent.setup();
    const onInputSetChange = vi.fn();
    useNodeInputRequestsStore.setState({
      nextId: 2,
      pendingRequests: [{ id: 1, workspaceId: 'workspace-1', view: 'filter', nodeId: 'node-a' }],
    });

    render(<RequestBridgeHarness onInputSetChange={onInputSetChange} deferNodeInputPlacement />);

    expect(onInputSetChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add to Preprocessing Inputs' }));

    await waitFor(() => {
      expect(onInputSetChange).toHaveBeenCalledWith('source', [
        { node_id: 'node-a', column: 'text' },
      ]);
    });
    expect(useNodeInputRequestsStore.getState().pendingRequests).toEqual([]);
  });
});
