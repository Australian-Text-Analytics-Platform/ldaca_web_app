import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeLike } from './nodeSelectionTypes';
import { buildNodeColumnOptionsMap } from './useNodeColumnOptions';

const makeNode = (overrides: Partial<WorkspaceNodeLike> = {}): WorkspaceNodeLike => ({
  id: 'node-1',
  data: {
    columns: ['text', 'score'],
    schema: [
      { name: 'text', js_type: 'Utf8' },
      { name: 'score', js_type: 'Int64' },
    ],
    dtypes: {
      text: 'Utf8',
      score: 'Int64',
    },
  },
  ...overrides,
});

describe('buildNodeColumnOptionsMap', () => {
  it('returns all columns when no filters are provided', () => {
    const node = makeNode();
    const result = buildNodeColumnOptionsMap({ nodes: [node] });
    expect(result[node.id!]).toMatchObject({
      columns: ['text', 'score'],
      filteredOutByType: false,
      fallbackApplied: false,
    });
  });

  it('filters columns by allowed data types', () => {
    const node = makeNode();
    const result = buildNodeColumnOptionsMap({ nodes: [node], allowedDataTypes: ['string'] });
    expect(result[node.id!]).toMatchObject({
      columns: ['text'],
      filteredOutByType: false,
      fallbackApplied: false,
    });
  });

  it('marks entries as filtered out when no columns remain after filtering', () => {
    const node = makeNode();
    const result = buildNodeColumnOptionsMap({ nodes: [node], allowedDataTypes: ['datetime'] });
    expect(result[node.id!]).toMatchObject({
      columns: [],
      filteredOutByType: true,
      fallbackApplied: false,
    });
  });

  it('falls back to all columns when configured', () => {
    const node = makeNode();
    const result = buildNodeColumnOptionsMap({
      nodes: [node],
      allowedDataTypes: ['datetime'],
      fallbackToAllColumns: true,
    });
    expect(result[node.id!]).toMatchObject({
      columns: ['text', 'score'],
      filteredOutByType: true,
      fallbackApplied: true,
    });
  });

  it('uses custom getNodeColumns implementation when provided', () => {
    const node: WorkspaceNodeLike = { id: 'node-custom', data: {} };
    const result = buildNodeColumnOptionsMap({
      nodes: [node],
      getNodeColumns: () => ['customA', 'customB'],
    });
    expect(result['node-custom']).toMatchObject({
      columns: ['customA', 'customB'],
      filteredOutByType: false,
    });
  });
});
