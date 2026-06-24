import { type Dispatch, type SetStateAction } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const quotationTaskRequestMock = vi.hoisted(() => vi.fn());
vi.mock('@/api', () => ({
  quotationTaskRequest: quotationTaskRequestMock,
}));

const useMaterializeLifecycleMock = vi.hoisted(() => vi.fn());
vi.mock('../../../common/hooks/useMaterializeLifecycle', () => ({
  useMaterializeLifecycle: useMaterializeLifecycleMock,
}));

import { useQuotationMaterializeLifecycle } from '../useQuotationMaterializeLifecycle';

type SetBoolMap = Dispatch<SetStateAction<Record<string, boolean>>>;
type SetTaskMap = Dispatch<SetStateAction<Record<string, string>>>;
interface CapturedLifecycleArgs {
  taskType: string;
  materializeTaskIds: Record<string, string>;
  setNodeMaterializing: SetBoolMap;
  setMaterializeTaskIds: SetTaskMap;
  onTerminalSuccess?: (nodeId: string, taskId: string) => void | Promise<void>;
}

const mkSetBoolMap = () => vi.fn() as unknown as SetBoolMap;
const mkSetTaskMap = () => vi.fn() as unknown as SetTaskMap;

const renderLifecycle = (
  overrides: Partial<Parameters<typeof useQuotationMaterializeLifecycle>[0]> = {},
) => {
  const props = {
    materializeTaskIds: { 'node-1': 'materialize-task-1' },
    setNodeMaterializing: mkSetBoolMap(),
    setMaterializeTaskIds: mkSetTaskMap(),
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
    resolveTaskId: vi.fn().mockResolvedValue('parent-task-1'),
    handlePageSizeChange: vi.fn().mockResolvedValue(undefined),
    applyMaterializedRequest: vi.fn(),
    ...overrides,
  };

  renderHook(() => {
    useQuotationMaterializeLifecycle(props);
  });

  return {
    props,
    lifecycleArgs: useMaterializeLifecycleMock.mock.calls[0]![0] as CapturedLifecycleArgs,
  };
};

describe('useQuotationMaterializeLifecycle', () => {
  beforeEach(() => {
    quotationTaskRequestMock.mockReset();
    useMaterializeLifecycleMock.mockReset();
  });

  it('registers quotation materialize tasks with the shared lifecycle watcher', () => {
    const setNodeMaterializing = mkSetBoolMap();
    const setMaterializeTaskIds = mkSetTaskMap();

    const { lifecycleArgs } = renderLifecycle({
      materializeTaskIds: { 'node-2': 'task-2' },
      setNodeMaterializing,
      setMaterializeTaskIds,
    });

    expect(lifecycleArgs.taskType).toBe('quotation_materialize');
    expect(lifecycleArgs.materializeTaskIds).toEqual({ 'node-2': 'task-2' });
    expect(lifecycleArgs.setNodeMaterializing).toBe(setNodeMaterializing);
    expect(lifecycleArgs.setMaterializeTaskIds).toBe(setMaterializeTaskIds);
  });

  it('refreshes materialized request metadata and resets page size on success', async () => {
    quotationTaskRequestMock.mockResolvedValue({
      data: {
        materialized_path: '/tmp/quotations.parquet',
        materialize_summary: { recordCount: 3 },
      },
    });

    const applyMaterializedRequest = vi.fn();
    const handlePageSizeChange = vi.fn().mockResolvedValue(undefined);
    const { lifecycleArgs } = renderLifecycle({
      applyMaterializedRequest,
      handlePageSizeChange,
    });

    await act(async () => {
      await lifecycleArgs.onTerminalSuccess?.('node-1', 'materialize-task-1');
    });

    expect(quotationTaskRequestMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer token' },
      path: { task_id: 'parent-task-1' },
      throwOnError: true,
    });
    expect(applyMaterializedRequest).toHaveBeenCalledWith('node-1', '/tmp/quotations.parquet', {
      recordCount: 3,
    });
    expect(handlePageSizeChange).toHaveBeenCalledWith(20);
  });

  it('still resets page size when no parent task is available to refresh', async () => {
    const handlePageSizeChange = vi.fn().mockResolvedValue(undefined);
    const { lifecycleArgs } = renderLifecycle({
      resolveTaskId: vi.fn().mockResolvedValue(null),
      handlePageSizeChange,
    });

    await act(async () => {
      await lifecycleArgs.onTerminalSuccess?.('node-1', 'materialize-task-1');
    });

    expect(quotationTaskRequestMock).not.toHaveBeenCalled();
    expect(handlePageSizeChange).toHaveBeenCalledWith(20);
  });
});
