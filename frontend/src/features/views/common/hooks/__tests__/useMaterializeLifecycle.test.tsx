import { type Dispatch, type SetStateAction } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drive useAnalysisTaskStatus directly so we don't have to set up the
// analysis store + SSE plumbing for the smoke tests.
interface TaskStatusReturn {
  tasks: { task_id: string; state: string }[];
}

const useAnalysisTaskStatusMock = vi.hoisted(() => vi.fn<() => TaskStatusReturn>());
vi.mock('@/features/views/common/useAnalysisTaskStatus', () => ({
  useAnalysisTaskStatus: useAnalysisTaskStatusMock,
}));

import { useMaterializeLifecycle } from '../useMaterializeLifecycle';

// Narrowed Dispatch types so the mock factories satisfy the hook's
// parameter shape without `as any` casts.
type MatBoolSpy = ReturnType<typeof vi.fn> & Dispatch<SetStateAction<Record<string, boolean>>>;
type MatTaskIdsSpy = ReturnType<typeof vi.fn> & Dispatch<SetStateAction<Record<string, string>>>;
type SuccessSpy = ReturnType<typeof vi.fn> &
  ((nodeId: string, taskId: string) => void | Promise<void>);
type FailureSpy = ReturnType<typeof vi.fn> &
  ((nodeId: string, state: 'failed' | 'cancelled') => void);
/** Called by: materialize lifecycle tests when asserting node loading cleanup because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
const mkMatBool = () => vi.fn() as unknown as MatBoolSpy;
/** Called by: materialize lifecycle tests when asserting task-id cleanup because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
const mkMatTaskIds = () => vi.fn() as unknown as MatTaskIdsSpy;
/** Called by: materialize lifecycle tests for successful terminal tasks because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
const mkSuccess = () => vi.fn() as unknown as SuccessSpy;
/** Called by: materialize lifecycle tests for failed or cancelled terminal tasks because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion. */
const mkFailure = () => vi.fn() as unknown as FailureSpy;

interface Args {
  materializeTaskIds?: Record<string, string>;
  setNodeMaterializing?: MatBoolSpy;
  setMaterializeTaskIds?: MatTaskIdsSpy;
  onTerminalSuccess?: SuccessSpy;
  onTerminalFailure?: FailureSpy;
}

/**
 * Builds a complete hook argument object while letting each lifecycle test swap
 * only the tracked tasks or callback spies under scrutiny.
 * Used by: useMaterializeLifecycle tests because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
const buildArgs = (overrides: Args = {}) => ({
  workspaceId: 'workspace-1',
  taskType: 'concordance_materialize',
  materializeTaskIds: overrides.materializeTaskIds ?? {},
  setNodeMaterializing: overrides.setNodeMaterializing ?? mkMatBool(),
  setMaterializeTaskIds: overrides.setMaterializeTaskIds ?? mkMatTaskIds(),
  onTerminalSuccess: overrides.onTerminalSuccess,
  onTerminalFailure: overrides.onTerminalFailure,
});

describe('useMaterializeLifecycle', () => {
  beforeEach(() => {
    useAnalysisTaskStatusMock.mockReset();
  });

  it('does nothing when there are no tracked task ids', () => {
    useAnalysisTaskStatusMock.mockReturnValue({
      tasks: [{ task_id: 't-1', state: 'successful' }],
    });
    const setNodeMaterializing = mkMatBool();
    const setMaterializeTaskIds = mkMatTaskIds();
    const onTerminalSuccess = mkSuccess();

    renderHook(() => {
      useMaterializeLifecycle(
        buildArgs({
          materializeTaskIds: {},
          setNodeMaterializing,
          setMaterializeTaskIds,
          onTerminalSuccess,
        }),
      );
    });

    expect(setNodeMaterializing).not.toHaveBeenCalled();
    expect(setMaterializeTaskIds).not.toHaveBeenCalled();
    expect(onTerminalSuccess).not.toHaveBeenCalled();
  });

  it('does nothing when no tracked task is in a terminal state yet', () => {
    useAnalysisTaskStatusMock.mockReturnValue({
      tasks: [{ task_id: 't-1', state: 'running' }],
    });
    const setNodeMaterializing = mkMatBool();
    const onTerminalSuccess = mkSuccess();

    renderHook(() => {
      useMaterializeLifecycle(
        buildArgs({
          materializeTaskIds: { 'node-1': 't-1' },
          setNodeMaterializing,
          onTerminalSuccess,
        }),
      );
    });

    expect(setNodeMaterializing).not.toHaveBeenCalled();
    expect(onTerminalSuccess).not.toHaveBeenCalled();
  });

  it('calls onTerminalSuccess and clears per-node state when a tracked task settles successfully', () => {
    useAnalysisTaskStatusMock.mockReturnValue({
      tasks: [{ task_id: 't-1', state: 'successful' }],
    });
    const setNodeMaterializing = mkMatBool();
    const setMaterializeTaskIds = mkMatTaskIds();
    const onTerminalSuccess = mkSuccess();

    renderHook(() => {
      useMaterializeLifecycle(
        buildArgs({
          materializeTaskIds: { 'node-1': 't-1' },
          setNodeMaterializing,
          setMaterializeTaskIds,
          onTerminalSuccess,
        }),
      );
    });

    expect(onTerminalSuccess).toHaveBeenCalledWith('node-1', 't-1');

    // Both setters get an updater that drops the node entry.
    const matUpdater = setNodeMaterializing.mock.calls[0]![0] as (
      prev: Record<string, boolean>,
    ) => Record<string, boolean>;
    expect(matUpdater({ 'node-1': true, 'node-2': true })).toEqual({ 'node-2': true });

    const tasksUpdater = setMaterializeTaskIds.mock.calls[0]![0] as (
      prev: Record<string, string>,
    ) => Record<string, string>;
    expect(tasksUpdater({ 'node-1': 't-1', 'node-2': 't-2' })).toEqual({ 'node-2': 't-2' });
  });

  it('routes failed/cancelled terminal states to onTerminalFailure', () => {
    useAnalysisTaskStatusMock.mockReturnValue({
      tasks: [{ task_id: 't-1', state: 'failed' }],
    });
    const onTerminalSuccess = mkSuccess();
    const onTerminalFailure = mkFailure();

    renderHook(() => {
      useMaterializeLifecycle(
        buildArgs({
          materializeTaskIds: { 'node-1': 't-1' },
          onTerminalSuccess,
          onTerminalFailure,
        }),
      );
    });

    expect(onTerminalSuccess).not.toHaveBeenCalled();
    expect(onTerminalFailure).toHaveBeenCalledWith('node-1', 'failed');
  });

  it('processes each terminal task at most once even if subsequent renders see it again', () => {
    useAnalysisTaskStatusMock.mockReturnValue({
      tasks: [{ task_id: 't-1', state: 'successful' }],
    });
    const onTerminalSuccess = mkSuccess();
    const setNodeMaterializing = mkMatBool();

    const { rerender } = renderHook(() => {
      useMaterializeLifecycle(
        buildArgs({
          materializeTaskIds: { 'node-1': 't-1' },
          onTerminalSuccess,
          setNodeMaterializing,
        }),
      );
    });

    expect(onTerminalSuccess).toHaveBeenCalledTimes(1);

    // The same terminal task surfaces again on the next render — should be
    // ignored thanks to the processed-id ref.
    rerender();
    expect(onTerminalSuccess).toHaveBeenCalledTimes(1);
  });

  it('only acts on tasks whose ids match a tracked entry', () => {
    useAnalysisTaskStatusMock.mockReturnValue({
      tasks: [
        { task_id: 't-other', state: 'successful' },
        { task_id: 't-1', state: 'successful' },
      ],
    });
    const onTerminalSuccess = mkSuccess();

    renderHook(() => {
      useMaterializeLifecycle(
        buildArgs({
          materializeTaskIds: { 'node-1': 't-1' },
          onTerminalSuccess,
        }),
      );
    });

    expect(onTerminalSuccess).toHaveBeenCalledTimes(1);
    expect(onTerminalSuccess).toHaveBeenCalledWith('node-1', 't-1');
  });
});
