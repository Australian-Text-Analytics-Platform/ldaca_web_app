import { describe, expect, it } from 'vitest';
import {
  buildSingleNodeSelectionPanelModel,
  buildWorkspaceNodeMap,
  deriveNodeLabel,
  getNodeKey,
  SINGLE_NODE_SELECTION_PALETTE,
} from '../nodeMetadata';

describe('nodeMetadata', () => {
  it('builds the shared single-node selection panel model', () => {
    const node = { id: 'node-1', name: 'Corpus' };

    expect(
      buildSingleNodeSelectionPanelModel({
        nodeId: 'node-1',
        selectedNode: node,
      }),
    ).toEqual({
      selectedNodes: [node],
      nodeColumnSelections: [{ nodeId: 'node-1', column: '' }],
      nodeColors: { 'node-1': SINGLE_NODE_SELECTION_PALETTE[0] },
      defaultPalette: SINGLE_NODE_SELECTION_PALETTE,
      disabled: false,
    });
  });

  it('keeps id-derived panel metadata when node details are missing', () => {
    expect(
      buildSingleNodeSelectionPanelModel({
        nodeId: 'missing-node',
      }),
    ).toMatchObject({
      selectedNodes: [],
      nodeColumnSelections: [{ nodeId: 'missing-node', column: '' }],
      nodeColors: { 'missing-node': SINGLE_NODE_SELECTION_PALETTE[0] },
      disabled: true,
    });
  });

  it('uses id and label metadata from live workspace nodes', () => {
    const node = { id: 'backend-node-1', label: 'Backend Corpus' };

    expect(getNodeKey(node)).toBe('backend-node-1');
    expect(deriveNodeLabel(node)).toBe('Backend Corpus');
    expect(buildWorkspaceNodeMap([node]).get('backend-node-1')).toBe(node);

    expect(
      buildSingleNodeSelectionPanelModel({
        nodeId: 'backend-node-1',
        selectedNode: node,
      }),
    ).toMatchObject({
      selectedNodes: [node],
      nodeColumnSelections: [{ nodeId: 'backend-node-1', column: '' }],
      disabled: false,
    });
  });
});
