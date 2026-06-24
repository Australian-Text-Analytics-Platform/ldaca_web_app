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
          panelSelectedNodes: [
            {
              id: 'node-a',
              tokenizer_models: liveModel ? { text: liveModel } : {},
            },
          ],
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
        panelSelectedNodes: [
          {
            id: 'node-a',
            tokenizer_models: { text: 'native:plain_words_en' },
          },
        ],
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
          panelSelectedNodes: [
            {
              id: 'node-a',
              tokenizer_models: hasModel ? { text: 'native:plain_words_en' } : {},
            },
          ],
        }),
      { initialProps: { hasModel: true } },
    );
    await flushDeferredState();
    expect(result.current.searchMode).toBe('tokens');

    act(() => {
      result.current.setSearchModeFromUser('tokens');
    });
    rerender({ hasModel: false });
    await flushDeferredState();

    expect(result.current.tokensModeAvailable).toBe(false);
    expect(result.current.searchMode).toBe('regex');
  });

  it('records and clears live tokenizer model overrides by node id', async () => {
    const { result } = renderHook(() =>
      useConcordanceTokenizerMode({
        effectiveNodeColumnSelections: [{ nodeId: 'node-a', column: 'text' }],
        panelSelectedNodes: [{ id: 'node-a' }],
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
      result.current.clearTokenizerModel('node-a');
    });
    await flushDeferredState();

    expect(result.current.effectiveTokenizerModelsByNode).toEqual({});
    expect(result.current.searchMode).toBe('regex');
  });
});
