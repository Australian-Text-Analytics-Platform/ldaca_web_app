import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useQuotationDetachDialog } from '../useQuotationDetachDialog';

describe('useQuotationDetachDialog', () => {
  it('uses locally loaded source columns and sends a canonical child selection', async () => {
    const handleDetach = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useQuotationDetachDialog({
        activeSelections: [{ nodeId: 'node-1', column: 'text' }],
        originalColumnsByNode: { 'node-1': ['text', 'speaker'] },
        handleDetach,
        nodeDetaching: {},
      }),
    );

    await act(async () => result.current.openDetachDialog('node-1'));
    expect(result.current.detachDialog.open).toBe(true);
    act(() => result.current.detachDialog.toggleDetachColumn('node-1', 'speaker', true));
    await act(async () => result.current.detachDialog.handleDetachConfirm());

    expect(handleDetach).toHaveBeenCalledWith('node-1', ['speaker']);
    expect(result.current.detachDialog.open).toBe(false);
  });

  it('ignores a request with no active source column', async () => {
    const handleDetach = vi.fn();
    const { result } = renderHook(() =>
      useQuotationDetachDialog({
        activeSelections: [{ nodeId: 'node-1', column: '' }],
        originalColumnsByNode: { 'node-1': ['text'] },
        handleDetach,
        nodeDetaching: {},
      }),
    );
    await act(async () => result.current.openDetachDialog('node-1'));
    expect(result.current.detachDialog.open).toBe(false);
    expect(handleDetach).not.toHaveBeenCalled();
  });
});
