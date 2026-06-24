import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeSchemaResponse } from '@/features/workspace/data-view/types';

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

import { useColumnMutations } from '../useColumnMutations';

const schemaWithTypes = (columnTypes: Record<string, string>): NodeSchemaResponse => ({
  node_id: 'node-1',
  schema: {},
  columns: Object.keys(columnTypes),
  column_types: columnTypes,
  is_text_data: false,
});

describe('useColumnMutations', () => {
  beforeEach(() => {
    toastMock.error.mockReset();
  });

  it('loads schema and runs string-to-datetime casts through the format modal', async () => {
    const onCast = vi.fn().mockResolvedValue(undefined);
    const onRefreshSchema = vi
      .fn()
      .mockResolvedValueOnce(schemaWithTypes({ published_at: 'Utf8' }))
      .mockResolvedValueOnce(schemaWithTypes({ published_at: 'datetime' }));

    const { result } = renderHook(() =>
      useColumnMutations({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        columns: ['published_at'],
        onCast,
        onRefreshSchema,
      }),
    );

    await waitFor(() => {
      expect(result.current.columnTypes.published_at).toBe('Utf8');
    });

    act(() => {
      result.current.handleTypeChange('published_at', 'datetime');
    });

    expect(result.current.datetimeModal).toMatchObject({
      isOpen: true,
      column: 'published_at',
      targetType: 'datetime',
    });

    act(() => {
      result.current.handleDatetimeFormatConfirm('%Y-%m-%d');
    });

    await waitFor(() => {
      expect(onCast).toHaveBeenCalledWith('published_at', 'datetime', '%Y-%m-%d');
      expect(result.current.columnTypes.published_at).toBe('datetime');
    });
    expect(result.current.datetimeModal.isOpen).toBe(false);
  });

  it('deletes the selected column and clears matching rename state', async () => {
    const onDeleteColumn = vi.fn().mockResolvedValue(undefined);
    const onRefreshSchema = vi
      .fn()
      .mockResolvedValueOnce(schemaWithTypes({ title: 'string', count: 'integer' }))
      .mockResolvedValueOnce(schemaWithTypes({ count: 'integer' }));

    const { result } = renderHook(() =>
      useColumnMutations({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        columns: ['title', 'count'],
        onDeleteColumn,
        onRefreshSchema,
      }),
    );

    await waitFor(() => {
      expect(result.current.columnTypes.title).toBe('string');
    });

    act(() => {
      result.current.startRename('title');
      result.current.requestDeleteColumn('title');
    });

    expect(result.current.renamingColumn).toBe('title');
    expect(result.current.deleteColumnDialogOpen).toBe(true);
    expect(result.current.columnToDelete).toBe('title');

    await act(async () => {
      await result.current.confirmDeleteColumn();
    });

    expect(onDeleteColumn).toHaveBeenCalledWith('title');
    expect(result.current.deleteColumnDialogOpen).toBe(false);
    expect(result.current.columnToDelete).toBeNull();
    expect(result.current.renamingColumn).toBeNull();
    expect(result.current.columnTypes).toEqual({ count: 'integer' });
  });

  it('keeps duplicate rename attempts local and reports validation feedback', async () => {
    const onRenameColumn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useColumnMutations({
        workspaceId: undefined,
        nodeId: undefined,
        columns: ['title', 'speaker'],
        onRenameColumn,
      }),
    );

    act(() => {
      result.current.startRename('title');
    });

    await act(async () => {
      await result.current.submitRename('title', 'speaker');
    });

    expect(onRenameColumn).not.toHaveBeenCalled();
    expect(result.current.renamingColumn).toBe('title');
    expect(toastMock.error).toHaveBeenCalledWith('A column named "speaker" already exists.');
  });
});
