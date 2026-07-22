import { describe, expect, it, vi } from 'vitest';

import { runAnalysisTaskEnvelope } from '../runAnalysisTaskEnvelope';

const baseOptions = () => ({
  lastFetchedRef: { current: { taskId: 'old-task', state: 'successful' } },
  runningRef: { current: false },
  setIsRunning: vi.fn(),
  setLocalTaskId: vi.fn(),
  onTaskIdAssigned: vi.fn(),
  resetBeforeRun: vi.fn(),
  submit: vi.fn(),
  onSuccess: vi.fn(),
  onError: vi.fn(),
});

describe('runAnalysisTaskEnvelope', () => {
  it('stores the task id and leaves running tasks active for stream hydration', async () => {
    const options = baseOptions();
    options.submit.mockResolvedValue({
      id: 'task-1',
      state: 'running',
    });

    const result = await runAnalysisTaskEnvelope(options);

    expect(result).toEqual({ id: 'task-1', state: 'running' });
    expect(options.lastFetchedRef.current).toEqual({ taskId: null, state: null });
    expect(options.setIsRunning).toHaveBeenCalledWith(true);
    expect(options.runningRef.current).toBe(true);
    expect(options.resetBeforeRun).toHaveBeenCalledOnce();
    expect(options.setLocalTaskId).toHaveBeenCalledWith('task-1');
    expect(options.onTaskIdAssigned).toHaveBeenCalledWith('task-1');
    expect(options.onSuccess).toHaveBeenCalledWith({ id: 'task-1', state: 'running' }, 'task-1');
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('releases the local running flag when the response has already failed', async () => {
    const options = baseOptions();
    options.submit.mockResolvedValue({
      id: 'task-2',
      state: 'failed',
    });

    await runAnalysisTaskEnvelope(options);

    expect(options.setIsRunning).toHaveBeenNthCalledWith(1, true);
    expect(options.setIsRunning).toHaveBeenNthCalledWith(2, false);
    expect(options.runningRef.current).toBe(false);
  });

  it('reports submit errors and releases the local running flag', async () => {
    const options = baseOptions();
    const error = new Error('submit failed');
    options.submit.mockRejectedValue(error);

    const result = await runAnalysisTaskEnvelope(options);

    expect(result).toBeNull();
    expect(options.onError).toHaveBeenCalledWith(error);
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.setIsRunning).toHaveBeenNthCalledWith(1, true);
    expect(options.setIsRunning).toHaveBeenNthCalledWith(2, false);
    expect(options.runningRef.current).toBe(false);
  });
});
