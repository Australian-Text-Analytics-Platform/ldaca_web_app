import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useQuotationEngineSettings } from '../useQuotationEngineSettings';

describe('useQuotationEngineSettings', () => {
  it('defaults to the built-in engine and resolves a local request payload', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    expect(result.current.engineConfig).toEqual({ type: 'local' });
    expect(result.current.engineReady).toBe(true);
    expect(result.current.buildEngineRequest()).toEqual({ type: 'local' });
    expect(result.current.engineError).toBeNull();
  });

  it('remembers the previous remote engine id when switching engines', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', engine_id: 'remote-quotation-engine' });
    });
    act(() => {
      result.current.setTaskEngineConfig({ type: 'local' });
    });
    act(() => {
      result.current.setTaskEngineConfig({
        type: 'remote',
        engine_id: result.current.lastRemoteEngineId,
      });
    });

    expect(result.current.engineConfig).toEqual({
      type: 'remote',
      engine_id: 'remote-quotation-engine',
    });
    expect(result.current.lastRemoteEngineId).toBe('remote-quotation-engine');
  });

  it('requires a remote engine id before building request payloads', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', engine_id: 'remote-quotation-engine' });
    });

    let payload: ReturnType<typeof result.current.buildEngineRequest> = null;
    act(() => {
      payload = result.current.buildEngineRequest();
    });

    expect(payload).toEqual({ type: 'remote', engine_id: 'remote-quotation-engine' });
    expect(result.current.engineConfig).toEqual({
      type: 'remote',
      engine_id: 'remote-quotation-engine',
    });
    expect(result.current.engineError).toBeNull();
  });

  it('rejects an empty remote engine id with a stable error', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', engine_id: '' });
    });

    let payload: ReturnType<typeof result.current.buildEngineRequest> = { type: 'local' };
    act(() => {
      payload = result.current.buildEngineRequest();
    });

    expect(payload).toBeNull();
    expect(result.current.engineError).toBe('Provide a remote quotation engine id.');
  });
});
