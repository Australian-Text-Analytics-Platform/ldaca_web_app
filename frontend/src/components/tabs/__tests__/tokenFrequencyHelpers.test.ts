import { describe, expect, it } from 'vitest';
import { createConcordanceSeedRequest, resolveTokenFrequencyNodeContext } from '../tokenFrequencyHelpers';
import type { ConcordanceSeedParams, TokenFrequencyAnalysisParams } from '../tokenFrequencyHelpers';
import type { NodeColumnSelection } from '../../../hooks/useAutoNodeColumns';

const buildParams = (overrides: Partial<ConcordanceSeedParams> = {}): ConcordanceSeedParams => {
  const baseSelections: NodeColumnSelection[] = [{ nodeId: 'node-1', column: 'text' }];
  const baseNodes = [{ id: 'node-1' }];
  return {
    selectedNodes: baseNodes,
    nodeColumnSelections: baseSelections,
    ...overrides,
  };
};

describe('createConcordanceSeedRequest', () => {
  it('returns null when token is empty or whitespace', () => {
    const params = buildParams();
    expect(createConcordanceSeedRequest('', params)).toBeNull();
    expect(createConcordanceSeedRequest('   ', params)).toBeNull();
  });

  it('returns null when no node column selections are available', () => {
    const params = buildParams({
      selectedNodes: [{ id: 'node-1' }],
      nodeColumnSelections: [{ nodeId: 'node-1', column: '' }],
    });
    expect(createConcordanceSeedRequest('token', params)).toBeNull();
  });

  it('builds a concordance request without pagination fields', () => {
    const params = buildParams();
    const request = createConcordanceSeedRequest('alpha', params);
    expect(request).not.toBeNull();
    if (!request) throw new Error('Expected concordance request to be created');
    expect(request.search_word).toBe('alpha');
    expect(request.node_ids).toEqual(['node-1']);
    expect(request.node_columns).toEqual({ 'node-1': 'text' });
    const requestRecord = request as unknown as Record<string, unknown>;
    expect('page' in requestRecord).toBe(false);
    expect('page_size' in requestRecord).toBe(false);
  });
});

describe('resolveTokenFrequencyNodeContext', () => {
  const baseSelections: NodeColumnSelection[] = [
    { nodeId: 'locked', column: 'locked_col' },
    { nodeId: 'selected', column: 'selected_col' },
  ];

  it('prioritises last compare node ids when available', () => {
    const context = resolveTokenFrequencyNodeContext({
      lastCompareNodeIds: ['locked'],
      analysisParams: {
        node_ids: ['analysis'],
        node_columns: { analysis: 'analysis_col' },
      } satisfies TokenFrequencyAnalysisParams,
      selectedNodes: [{ id: 'selected' }],
      nodeColumnSelections: baseSelections,
    });

  expect(context.nodeIds).toHaveLength(2);
  expect(context.nodeIds[0]).toBe('locked');
  expect(context.selections[0]).toEqual({ nodeId: 'locked', column: 'locked_col' });
  expect(context.selections[1]).toEqual({ nodeId: 'analysis', column: 'analysis_col' });
  });

  it('falls back to analysis params when last compare ids are missing', () => {
    const context = resolveTokenFrequencyNodeContext({
      lastCompareNodeIds: [],
      analysisParams: {
        node_ids: ['analysis'],
        node_columns: { analysis: 'analysis_col' },
      } satisfies TokenFrequencyAnalysisParams,
      selectedNodes: [{ id: 'selected' }],
      nodeColumnSelections: [],
    });

    expect(context.nodeIds).toEqual(['analysis']);
    expect(context.selections).toEqual([{ nodeId: 'analysis', column: 'analysis_col' }]);
  });

  it('returns empty context when no columns can be resolved', () => {
    const context = resolveTokenFrequencyNodeContext({
      lastCompareNodeIds: ['missing'],
      analysisParams: { node_ids: ['missing'], node_columns: { missing: '' } },
      selectedNodes: [{ id: 'missing' }],
      nodeColumnSelections: [{ nodeId: 'missing', column: '' }],
    });

    expect(context).toEqual({ nodeIds: [], selections: [] });
  });
});
