import { describe, expect, it } from 'vitest';
import type { TokenFrequencyResponse } from '@/api';
import {
  buildNodeIdDisplayNameMap,
  buildSelectionNameById,
  buildSelectionNameKey,
  deriveBackendTokenLimit,
  derivePanelNodeIds,
  deriveStudyNodeOrder,
  reconcileHydratedTokenFrequencyInputs,
  resolveTokenFrequencyDisplayName,
} from '../tokenFrequencyUtils';

describe('tokenFrequencyUtils', () => {
  it('derives the canonical token limit from the result resource', () => {
    const result: TokenFrequencyResponse = {
      data: {},
      metadata: { effective_token_limit: 42 },
    };

    expect(deriveBackendTokenLimit(result)).toBe(42);
  });

  it('buildSelectionNameById merges selected + panel nodes with panel precedence', () => {
    const selected = [{ id: 'a', name: 'Alpha' }];
    const panel = [
      { id: 'a', name: 'Panel A' },
      { id: 'b', name: 'Beta' },
    ];

    expect(buildSelectionNameById(selected, panel)).toEqual({
      a: 'Panel A',
      b: 'Beta',
    });
  });

  it('buildSelectionNameKey produces a stable key from merged names', () => {
    const selected = [
      { id: 'b', name: 'Beta' },
      { id: 'a', name: 'Alpha' },
    ];
    const panel = [{ id: 'a', name: 'Panel A' }];

    expect(buildSelectionNameKey(selected, panel)).toBe('a:Panel A|b:Beta');
  });

  it('derivePanelNodeIds keeps the first two live workspace node ids', () => {
    const panelNodes = [
      { id: 'node-a', name: 'Node A' },
      { id: 'node-b', name: 'Node B' },
      { id: 'ignored', name: 'Ignored' },
    ];

    expect(derivePanelNodeIds(panelNodes)).toEqual(['node-a', 'node-b']);
  });

  it('deriveStudyNodeOrder defaults to the first node and moves the study node to the comparison end', () => {
    expect(deriveStudyNodeOrder(['reference', 'study'], null)).toEqual({
      effectiveStudyNodeId: 'reference',
      orderedPanelNodeIds: ['study', 'reference'],
    });

    expect(deriveStudyNodeOrder(['reference', 'study'], 'study')).toEqual({
      effectiveStudyNodeId: 'study',
      orderedPanelNodeIds: ['reference', 'study'],
    });
  });

  it('preserves parameter-card order while hydrating reference/study request columns', () => {
    expect(
      reconcileHydratedTokenFrequencyInputs(
        [
          { node_id: 'study', column: 'old-study-column' },
          { node_id: 'reference', column: 'old-reference-column' },
        ],
        [
          { node_id: 'reference', column: 'reference-column' },
          { node_id: 'study', column: 'study-column' },
        ],
      ),
    ).toEqual([
      { node_id: 'study', column: 'study-column' },
      { node_id: 'reference', column: 'reference-column' },
    ]);
  });

  it('adopts hydrated request order when restoring a different node selection', () => {
    const hydratedInputs = [
      { node_id: 'reference', column: 'reference-column' },
      { node_id: 'study', column: 'study-column' },
    ];

    expect(
      reconcileHydratedTokenFrequencyInputs(
        [{ node_id: 'different-node', column: 'text' }],
        hydratedInputs,
      ),
    ).toEqual(hydratedInputs);
  });

  it('buildNodeIdDisplayNameMap falls back from empty names to ids', () => {
    expect(
      buildNodeIdDisplayNameMap([
        {
          id: 'node-a',
          name: 'Alpha',
        },
        {
          id: 'node-b',
          name: '',
        },
        {
          id: 'node-c',
          name: '',
        },
      ]),
    ).toEqual({
      'node-a': 'Alpha',
      'node-b': 'node-b',
      'node-c': 'node-c',
    });
  });

  it('resolveTokenFrequencyDisplayName prefers response names before local fallbacks', () => {
    expect(
      resolveTokenFrequencyDisplayName({
        nodeId: 'node-a',
        fallbackKey: 'Backend Key',
        responseOrSelectionNames: { 'node-a': 'Response Name' },
        nodeIdToName: { 'node-a': 'Local Name' },
      }),
    ).toBe('Response Name');

    expect(
      resolveTokenFrequencyDisplayName({
        nodeId: 'node-b',
        fallbackKey: 'Backend Key',
        responseOrSelectionNames: {},
        nodeIdToName: { 'node-b': 'Local Name' },
      }),
    ).toBe('Local Name');

    expect(
      resolveTokenFrequencyDisplayName({
        nodeId: 'node-c',
        fallbackKey: 'Backend Key',
        responseOrSelectionNames: {},
        nodeIdToName: {},
      }),
    ).toBe('Backend Key');
  });
});
