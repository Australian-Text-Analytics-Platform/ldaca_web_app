import { act, renderHook, waitFor } from '@testing-library/react';
import { Field, TimestampMillisecond } from 'apache-arrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('sonner', () => ({ toast: toastMock }));

import { useColumnMutations } from '../useColumnMutations';

describe('useColumnMutations', () => {
  beforeEach(() => {
    toastMock.error.mockReset();
  });

  it('loads canonical dtypes and runs string-to-datetime casts through the format modal', async () => {
    const onCast = vi.fn().mockResolvedValue(undefined);
    const onRefreshSchema = vi.fn().mockResolvedValueOnce([
      {
        name: 'published_at',
        kind: 'datetime',
        field: new Field('published_at', new TimestampMillisecond()),
      },
    ]);

    const { result } = renderHook(() =>
      useColumnMutations({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        columns: ['published_at'],
        columnKinds: { published_at: 'string' },
        onCast,
        onRefreshSchema,
      }),
    );

    await waitFor(() => {
      expect(result.current.columnTypes.published_at).toBe('string');
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

  it('reports cast failures without leaving a column marked busy', async () => {
    const onCast = vi.fn().mockRejectedValue(new Error('invalid date'));
    const { result } = renderHook(() =>
      useColumnMutations({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        columns: ['published_at'],
        columnKinds: { published_at: 'string' },
        onCast,
      }),
    );

    act(() => {
      result.current.handleTypeChange('published_at', 'integer');
    });

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        'Failed to convert column "published_at" to integer: invalid date',
      );
      expect(result.current.loadingCast).toEqual({});
    });
  });

  it('renames and deletes columns through the edit callbacks', async () => {
    const onRenameColumn = vi.fn().mockResolvedValue(undefined);
    const onDeleteColumn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useColumnMutations({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        columns: ['title', 'count'],
        columnKinds: { title: 'string', count: 'integer' },
        onRenameColumn,
        onDeleteColumn,
      }),
    );

    act(() => {
      result.current.startRename('title');
    });
    await act(async () => {
      await result.current.submitRename('title', 'heading');
    });
    expect(onRenameColumn).toHaveBeenCalledWith('title', 'heading');
    expect(result.current.renamingColumn).toBeNull();

    act(() => {
      result.current.requestDeleteColumn('count');
    });
    expect(result.current.deleteColumnDialogOpen).toBe(true);
    await act(async () => {
      await result.current.confirmDeleteColumn();
    });
    expect(onDeleteColumn).toHaveBeenCalledWith('count');
    expect(result.current.deleteColumnDialogOpen).toBe(false);
    expect(result.current.columnTypes).not.toHaveProperty('count');
  });
});
