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

  it('remembers the previous remote endpoint when switching engines', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', url: 'https://quotation.test/api' });
    });
    act(() => {
      result.current.setTaskEngineConfig({ type: 'local' });
    });
    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', url: result.current.lastRemoteUrl });
    });

    expect(result.current.engineConfig).toEqual({
      type: 'remote',
      url: 'https://quotation.test/api',
    });
    expect(result.current.lastRemoteUrl).toBe('https://quotation.test/api');
  });

  it('normalizes schemeless remote endpoints before building request payloads', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', url: 'localhost:9000/quote' });
    });

    let payload: ReturnType<typeof result.current.buildEngineRequest> = null;
    act(() => {
      payload = result.current.buildEngineRequest();
    });

    expect(payload).toEqual({ type: 'remote', url: 'http://localhost:9000/quote' });
    expect(result.current.engineConfig).toEqual({
      type: 'remote',
      url: 'http://localhost:9000/quote',
    });
    expect(result.current.engineError).toBeNull();
  });

  it('rejects unsupported remote URL protocols with a specific error', () => {
    const { result } = renderHook(() => useQuotationEngineSettings());

    act(() => {
      result.current.setTaskEngineConfig({ type: 'remote', url: 'ftp://quotation.test/api' });
    });

    let payload: ReturnType<typeof result.current.buildEngineRequest> = { type: 'local' };
    act(() => {
      payload = result.current.buildEngineRequest();
    });

    expect(payload).toBeNull();
    expect(result.current.engineError).toBe('Remote engines must use http:// or https:// URLs.');
  });
});
