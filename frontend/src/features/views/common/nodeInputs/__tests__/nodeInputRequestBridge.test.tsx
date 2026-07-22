import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisTabInput } from '../../tabs/tabStateOps';
import { NodeInputsPanel } from '@/features/views/common/components/NodeInputsPanel';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useRecentSelectionsStore } from '@/stores/recentSelectionsStore';
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
}: {
  onInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
}) {
  const nodeInputs = useTabNodeInputs({
    tabInputSets: { source: [] },
    onTabInputSetChange: onInputSetChange,
    constraints: { maxNodes: 1 },
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
      requests: [],
    });
    useRecentSelectionsStore.setState({ byWorkspace: {} });
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodes: [{ id: 'node-a', name: 'Node A' }],
    });
    mocks.useWorkspaceSelection.mockReturnValue({ selectedNodeIds: [] });
    mocks.useNodeColumnInfos.mockReturnValue({
      getColumnInfos: () => [{ name: 'text', dataType: 'string' }],
      nodeInfoCache: {},
    });
    mocks.useUIStore.mockImplementation((selector: (state: { currentView: string }) => unknown) =>
      selector({ currentView: 'filter' }),
    );
  });

  it('consumes requests that were queued before the input panel target registered', async () => {
    const onInputSetChange = vi.fn();
    useNodeInputRequestsStore.setState({
      nextId: 2,
      requests: [{ id: 1, workspaceId: 'workspace-1', view: 'filter', nodeIds: ['node-a'] }],
    });

    render(<RequestBridgeHarness onInputSetChange={onInputSetChange} />);

    await waitFor(() => {
      expect(onInputSetChange).toHaveBeenCalledWith('source', [
        { node_id: 'node-a', column: 'text' },
      ]);
    });
  });
});
