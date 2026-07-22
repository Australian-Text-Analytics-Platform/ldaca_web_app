import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useConcordanceTokenizerMode } from '../useConcordanceTokenizerMode';

const flushDeferredState = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useConcordanceTokenizerMode', () => {
  it('starts in regex mode until every selected column has a tokenizer model', async () => {
    const { result, rerender } = renderHook(
      ({ liveModel }: { liveModel?: string }) =>
        useConcordanceTokenizerMode({
          effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
          nodeInfoCache: {
            'node-a': {
              id: 'node-a',
              name: 'Node A',
              tokenizer_model: liveModel ?? null,
            },
          },
        }),
      { initialProps: {} },
    );

    expect(result.current.searchMode).toBe('regex');
    expect(result.current.tokensModeAvailable).toBe(false);

    rerender({ liveModel: 'native:plain_words_en' });
    await flushDeferredState();

    expect(result.current.tokensModeAvailable).toBe(true);
    expect(result.current.searchMode).toBe('tokens');
  });

  it('preserves a user-selected regex mode while token mode remains available', async () => {
    const { result } = renderHook(() =>
      useConcordanceTokenizerMode({
        effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
        nodeInfoCache: {
          'node-a': {
            id: 'node-a',
            name: 'Node A',
            tokenizer_model: 'native:plain_words_en',
          },
        },
      }),
    );
    await flushDeferredState();

    act(() => {
      result.current.setSearchModeFromUser('regex');
    });
    await flushDeferredState();

    expect(result.current.tokensModeAvailable).toBe(true);
    expect(result.current.searchMode).toBe('regex');
  });

  it('forces regex mode again when token models stop covering the selected columns', async () => {
    const { result, rerender } = renderHook(
      ({ hasModel }: { hasModel: boolean }) =>
        useConcordanceTokenizerMode({
          effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
          nodeInfoCache: {
            'node-a': {
              id: 'node-a',
              name: 'Node A',
              tokenizer_model: hasModel ? 'native:plain_words_en' : null,
            },
          },
        }),
      { initialProps: { hasModel: true } },
    );
    await flushDeferredState();
    expect(result.current.searchMode).toBe('tokens');

    rerender({ hasModel: false });
    await flushDeferredState();

    expect(result.current.tokensModeAvailable).toBe(false);
    expect(result.current.searchMode).toBe('regex');
  });

  it('records and clears live tokenizer model overrides by node id', async () => {
    const { result } = renderHook(() =>
      useConcordanceTokenizerMode({
        effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
        nodeInfoCache: { 'node-a': { id: 'node-a', name: 'Node A' } },
      }),
    );

    act(() => {
      result.current.recordTokenizerModel('node-a', 'native:plain_words_en');
    });
    await flushDeferredState();

    expect(result.current.effectiveTokenizerModelsByNode).toEqual({
      'node-a': 'native:plain_words_en',
    });
    expect(result.current.searchMode).toBe('tokens');

    act(() => {
      result.current.recordTokenizerModel('node-a', '');
    });
    await flushDeferredState();

    expect(result.current.effectiveTokenizerModelsByNode).toEqual({ 'node-a': '' });
    expect(result.current.searchMode).toBe('regex');
  });

  it('hydrates historical request models and explicit absences ahead of current metadata', async () => {
    const { result } = renderHook(() =>
      useConcordanceTokenizerMode({
        effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
        nodeInfoCache: {
          'node-a': { id: 'node-a', name: 'Node A', tokenizer_model: 'current-model' },
        },
      }),
    );
    await flushDeferredState();

    act(() => {
      result.current.hydrateTokenizerState(['node-a'], { 'node-a': 'historical-model' }, 'regex');
    });
    await flushDeferredState();

    expect(result.current.effectiveTokenizerModelsByNode).toEqual({
      'node-a': 'historical-model',
    });
    expect(result.current.searchMode).toBe('regex');

    act(() => {
      result.current.hydrateTokenizerState(['node-a'], {}, 'regex');
    });
    await flushDeferredState();

    expect(result.current.effectiveTokenizerModelsByNode).toEqual({ 'node-a': '' });
    expect(result.current.tokensModeAvailable).toBe(false);
  });

  it('keeps hydrated tokens mode when hydration precedes the initial deferred auto-mode update', async () => {
    const { result } = renderHook(() =>
      useConcordanceTokenizerMode({
        effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
        nodeInfoCache: {
          'node-a': { id: 'node-a', name: 'Node A', tokenizer_model: null },
        },
      }),
    );

    act(() => {
      result.current.hydrateTokenizerState(['node-a'], { 'node-a': 'historical-model' }, 'tokens');
    });
    await flushDeferredState();

    expect(result.current.tokensModeAvailable).toBe(true);
    expect(result.current.searchMode).toBe('tokens');
  });
});
