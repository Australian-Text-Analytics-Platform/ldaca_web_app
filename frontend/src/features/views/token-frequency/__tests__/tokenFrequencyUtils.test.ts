import { describe, it, expect } from 'vitest';
import type { TokenFrequencyResponse } from '@/api';
import {
  buildSelectionNameKey,
  buildSelectionNameById,
  buildNodeIdDisplayNameMap,
  derivePanelNodeIds,
  deriveBackendTokenLimit,
  deriveBackendStopWords,
  deriveBackendStopWordsKey,
  deriveStudyNodeOrder,
  resolveTokenFrequencyDisplayName,
} from '../tokenFrequencyUtils';

describe('tokenFrequencyUtils', () => {
  it('deriveBackendTokenLimit prefers explicit token_limit over metadata/limit', () => {
    const result: TokenFrequencyResponse = {
      state: 'successful',
      data: null,
      token_limit: 42,
      analysis_params: { token_limit: 11 },
      metadata: { token_limit: 7, limit: 99 },
    };

    expect(deriveBackendTokenLimit(result)).toBe(42);
  });

  it('deriveBackendStopWords prefers analysis params over metadata when top-level is absent', () => {
    const result: TokenFrequencyResponse = {
      state: 'successful',
      data: null,
      metadata: { stop_words: ['the', 'and'] },
      analysis_params: { stop_words: ['ignored'] },
    };

    expect(deriveBackendStopWords(result)).toEqual(['ignored']);
  });

  it('deriveBackendStopWordsKey normalizes and joins stop words deterministically', () => {
    const result: TokenFrequencyResponse = {
      state: 'successful',
      data: null,
      metadata: { stop_words: [' The ', 'AND', '', '  '] },
    };

    expect(deriveBackendStopWordsKey(result)).toBe('the|and');
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

  it('derivePanelNodeIds keeps the first two stable ids with active-id fallback', () => {
    const panelNodes = [{ id: 'node-a' }, {}, { node_id: 'ignored' }];

    expect(derivePanelNodeIds(panelNodes, ['fallback-a', 'fallback-b', 'fallback-c'])).toEqual([
      'node-a',
      'fallback-b',
    ]);
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

  it('buildNodeIdDisplayNameMap falls back from empty names to labels and ids', () => {
    expect(
      buildNodeIdDisplayNameMap([
        { id: 'node-a', name: 'Alpha', label: 'Ignored' },
        { id: 'node-b', name: '', label: 'Beta' },
        { id: 'node-c', name: '', label: '' },
      ]),
    ).toEqual({
      'node-a': 'Alpha',
      'node-b': 'Beta',
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
