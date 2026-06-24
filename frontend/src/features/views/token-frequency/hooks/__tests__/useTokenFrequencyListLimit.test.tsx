import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import type { NodeResultView } from '../../tokenFrequencyAdapters';
import {
  deriveTokenFrequencyMaxVocabulary,
  useTokenFrequencyListLimit,
} from '../useTokenFrequencyListLimit';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    token: `token-${String(index + 1)}`,
    frequency: count - index,
  }));

const nodeResult = (rowCount: number, filteredCount = rowCount): NodeResultView => ({
  nodeId: 'node-1',
  displayName: 'Node 1',
  rows: rows(rowCount),
  metadata: {},
  filteredRows: rows(filteredCount),
  displayRows: rows(filteredCount),
  filteredOutCount: 0,
  appliedDisplayLimit: 30,
  maxFrequency: rowCount,
});

const changeEvent = (value: string): ChangeEvent<HTMLInputElement> =>
  ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

describe('deriveTokenFrequencyMaxVocabulary', () => {
  it('uses the largest raw or filtered row count and falls back to ten', () => {
    expect(deriveTokenFrequencyMaxVocabulary([])).toBe(10);
    expect(deriveTokenFrequencyMaxVocabulary([nodeResult(20, 35), nodeResult(80, 30)])).toBe(80);
  });
});

describe('useTokenFrequencyListLimit', () => {
  it('syncs the list limit from the effective cloud limit', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyListLimit({
        nodeDisplayResults: [nodeResult(150)],
        effectiveTokenLimit: 25,
        tokenLimitInput: '25',
        onTokenLimitBlur: vi.fn(),
        applyCloudTokenLimit: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.listLimit).toBe(25);
    });
    expect(result.current.listLimitInput).toBe('25');
    expect(result.current.globalMaxVocab).toBe(150);
  });

  it('keeps list values above the cloud cap while mirroring a capped cloud target', async () => {
    const applyCloudTokenLimit = vi.fn();
    const { result, rerender } = renderHook(
      ({ effectiveTokenLimit }) =>
        useTokenFrequencyListLimit({
          nodeDisplayResults: [nodeResult(150)],
          effectiveTokenLimit,
          tokenLimitInput: String(effectiveTokenLimit),
          onTokenLimitBlur: vi.fn(),
          applyCloudTokenLimit,
        }),
      { initialProps: { effectiveTokenLimit: 25 } },
    );

    await waitFor(() => {
      expect(result.current.listLimit).toBe(25);
    });

    act(() => {
      result.current.handleListLimitInputChange(changeEvent('150'));
    });
    act(() => {
      result.current.handleApplyListLimit();
    });

    expect(result.current.listLimit).toBe(150);
    expect(result.current.listLimitInput).toBe('150');
    expect(applyCloudTokenLimit).toHaveBeenCalledWith(100);

    rerender({ effectiveTokenLimit: 80 });

    await waitFor(() => {
      expect(result.current.listLimit).toBe(150);
    });
    expect(result.current.listLimitInput).toBe('150');
  });

  it('shows a validation error for invalid list limits', async () => {
    const applyCloudTokenLimit = vi.fn();
    const { result } = renderHook(() =>
      useTokenFrequencyListLimit({
        nodeDisplayResults: [nodeResult(30)],
        effectiveTokenLimit: 25,
        tokenLimitInput: '25',
        onTokenLimitBlur: vi.fn(),
        applyCloudTokenLimit,
      }),
    );

    await waitFor(() => {
      expect(result.current.listLimit).toBe(25);
    });

    act(() => {
      result.current.handleListLimitInputChange(changeEvent('0'));
    });
    act(() => {
      result.current.handleApplyListLimit();
    });

    expect(result.current.listLimitError).toBe('Enter a whole number greater than zero.');
    expect(applyCloudTokenLimit).not.toHaveBeenCalled();
  });

  it('mirrors cloud applies back into list state and delegates persistence to blur', async () => {
    const onTokenLimitBlur = vi.fn();
    const { result, rerender } = renderHook(
      ({ tokenLimitInput }) =>
        useTokenFrequencyListLimit({
          nodeDisplayResults: [nodeResult(120)],
          effectiveTokenLimit: 25,
          tokenLimitInput,
          onTokenLimitBlur,
          applyCloudTokenLimit: vi.fn(),
        }),
      { initialProps: { tokenLimitInput: '25' } },
    );

    await waitFor(() => {
      expect(result.current.listLimit).toBe(25);
    });

    rerender({ tokenLimitInput: '75' });

    act(() => {
      result.current.handleApplyCloudLimit();
    });

    expect(result.current.listLimit).toBe(75);
    expect(result.current.listLimitInput).toBe('75');
    expect(onTokenLimitBlur).toHaveBeenCalledTimes(1);
  });
});
