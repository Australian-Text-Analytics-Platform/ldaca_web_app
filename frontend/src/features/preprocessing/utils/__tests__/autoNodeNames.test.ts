import { describe, expect, it } from 'vitest';

import { buildExpressionAutoNodeName } from '../autoNodeNames';

describe('buildExpressionAutoNodeName', () => {
  it('builds a stable expression placeholder for each context', () => {
    expect(buildExpressionAutoNodeName({ baseName: 'Corpus', context: 'filter' })).toBe('Corpus_filtered_expr');
    expect(buildExpressionAutoNodeName({ baseName: 'Corpus', context: 'with_columns' })).toBe('Corpus_with_columns');
    expect(buildExpressionAutoNodeName({ baseName: 'Corpus', context: 'select' })).toBe('Corpus_selected_expr');
    expect(buildExpressionAutoNodeName({ baseName: 'Corpus', context: 'sort' })).toBe('Corpus_sorted_expr');
    expect(buildExpressionAutoNodeName({ baseName: 'Corpus', context: 'group_by_agg' })).toBe('Corpus_grouped_expr');
  });

  it('falls back to dataset when no base name is available', () => {
    expect(buildExpressionAutoNodeName({ baseName: '', context: 'filter' })).toBe('dataset_filtered_expr');
  });
});