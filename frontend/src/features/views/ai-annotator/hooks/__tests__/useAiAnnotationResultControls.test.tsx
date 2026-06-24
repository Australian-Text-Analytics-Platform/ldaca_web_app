import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AiAnnotationResponse } from '@/api';
import { useAiAnnotationResultControls } from '../useAiAnnotationResultControls';

const buildResponse = (): AiAnnotationResponse => ({
  state: 'successful',
  message: 'ok',
  metadata: { task_id: 'task-1' },
  data: {
    'node-1': {
      columns: ['text', 'annotation', 'source'],
      data: [{ text: 'first row', annotation: 'support', source: 'doc-1' }],
      metadata: { annotation_columns: ['annotation'] },
      pagination: {
        page: 2,
        page_size: 10,
        total_source_rows: 21,
        total_source_pages: 3,
        result_count: 10,
        has_next: true,
        has_prev: true,
      },
      sorting: { sort_by: null, descending: true },
    },
  },
});

describe('useAiAnnotationResultControls', () => {
  it('normalizes the first response node and merges response metadata without mutating it', () => {
    const response = buildResponse();
    const originalNodeMetadata = response.data?.['node-1']?.metadata;
    const { result } = renderHook(() =>
      useAiAnnotationResultControls({ selectedColumn: 'text', defaultPageSize: 5 }),
    );

    act(() => {
      result.current.applyResponseResult(response);
    });

    expect(result.current.resultNodeId).toBe('node-1');
    expect(result.current.resultNode?.metadata).toEqual({
      annotation_columns: ['annotation'],
      task_id: 'task-1',
    });
    expect(response.data?.['node-1']?.metadata).toBe(originalNodeMetadata);
    expect(response.data?.['node-1']?.metadata).toEqual({ annotation_columns: ['annotation'] });
  });

  it('derives annotation, text, metadata, and pagination display state', () => {
    const { result } = renderHook(() =>
      useAiAnnotationResultControls({ selectedColumn: 'text', defaultPageSize: 5 }),
    );

    act(() => {
      result.current.applyResponseResult(buildResponse());
      result.current.setSelectedMetadataColumns(['source', 'missing']);
    });

    expect(result.current.resultRows).toEqual([
      { text: 'first row', annotation: 'support', source: 'doc-1' },
    ]);
    expect(result.current.annotationColumns).toEqual(['annotation']);
    expect(result.current.inferredTextColumn).toBe('text');
    expect(result.current.availableMetadataColumns).toEqual(['source']);
    expect(result.current.selectedMetadataColumns).toEqual(['source']);
    expect(result.current.visibleColumns).toEqual(['annotation', 'text', 'source']);
    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(10);
  });

  it('clears result and metadata selection state after clear', () => {
    const { result } = renderHook(() =>
      useAiAnnotationResultControls({ selectedColumn: 'text', defaultPageSize: 5 }),
    );

    act(() => {
      result.current.applyResponseResult(buildResponse());
      result.current.setSelectedMetadataColumns(['source']);
      result.current.resetAfterClear();
    });

    expect(result.current.resultNodeId).toBeNull();
    expect(result.current.resultNode).toBeNull();
    expect(result.current.resultRows).toEqual([]);
    expect(result.current.selectedMetadataColumns).toEqual([]);
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(5);
  });
});
