import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceOperationLifecycle } from '../workspaceMutationLifecycle';

const createLifecycle = () => {
  const calls: string[] = [];
  return {
    calls,
    lifecycle: createWorkspaceOperationLifecycle({
      startOperation: (operationId) => {
        calls.push(`start:${operationId}`);
      },
      endOperation: (operationId) => {
        calls.push(`end:${operationId}`);
      },
      setOperationError: (operationId, error) => {
        calls.push(`error:${operationId}:${error}`);
      },
    }),
  };
};

describe('createWorkspaceOperationLifecycle', () => {
  it('starts an operation before running mutation setup', () => {
    const { calls, lifecycle } = createLifecycle();
    const prepare = vi.fn((value: string) => ({ previous: value }));

    const result = lifecycle.onMutate('renameNode', prepare)('node-1');

    expect(result).toEqual({ previous: 'node-1' });
    expect(prepare).toHaveBeenCalledWith('node-1');
    expect(calls).toEqual(['start:renameNode']);
  });

  it('runs success work before ending the operation', async () => {
    const { calls, lifecycle } = createLifecycle();

    await lifecycle.onSuccess('copyNode', () => {
      calls.push('invalidate');
    })({}, {}, undefined);

    expect(calls).toEqual(['invalidate', 'end:copyNode']);
  });

  it('runs error rollback before recording the operation error', async () => {
    const { calls, lifecycle } = createLifecycle();

    await lifecycle.onError('reorderNodes', () => {
      calls.push('rollback');
    })(new Error('failed'), {}, undefined, {});

    expect(calls).toEqual(['rollback', 'error:reorderNodes:failed', 'end:reorderNodes']);
  });
});
