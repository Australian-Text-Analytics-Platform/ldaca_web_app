import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRowDetailDialog, type UseRowDetailDialogOptions } from '../useRowDetailDialog';

interface Item {
  label: string;
}

const options = (
  overrides: Partial<UseRowDetailDialogOptions<Item>> = {},
): UseRowDetailDialogOptions<Item> => ({
  sequenceKey: 'sequence-1',
  items: [{ label: 'one' }, { label: 'two' }],
  page: 1,
  hasPreviousPage: false,
  hasNextPage: false,
  loading: false,
  onPageChange: vi.fn(),
  toPayload: (item) => ({ record: { label: item.label } }),
  ...overrides,
});

describe('useRowDetailDialog', () => {
  it('moves between displayed rows without changing pages', () => {
    const { result } = renderHook(() => useRowDetailDialog(options()));

    act(() => {
      result.current.openDetailAt(0);
    });
    expect(result.current.detailPayload?.record.label).toBe('one');
    expect(result.current.navigation.canPrevious).toBe(false);
    expect(result.current.navigation.canNext).toBe(true);

    act(() => {
      result.current.navigation.onNext();
    });
    expect(result.current.detailPayload?.record.label).toBe('two');
    expect(result.current.navigation.canPrevious).toBe(true);
    expect(result.current.navigation.canNext).toBe(false);
  });

  it('changes pages, skips empty pages in both directions, and selects adjacent rows', async () => {
    const onPageChange = vi.fn();
    let props = options({
      items: [{ label: 'one' }],
      hasNextPage: true,
      onPageChange,
    });
    const { result, rerender } = renderHook(() => useRowDetailDialog(props));

    act(() => {
      result.current.openDetailAt(0);
    });
    act(() => {
      result.current.navigation.onNext();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });
    expect(result.current.detailOpen).toBe(true);
    expect(result.current.detailPayload?.record.label).toBe('one');

    props = options({
      items: [],
      page: 2,
      hasPreviousPage: true,
      hasNextPage: true,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    props = options({
      items: [],
      page: 3,
      hasPreviousPage: true,
      hasNextPage: true,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    props = options({
      items: [{ label: 'four-a' }, { label: 'four-b' }],
      page: 4,
      hasPreviousPage: true,
      hasNextPage: false,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(result.current.detailPayload?.record.label).toBe('four-a');
    });

    act(() => {
      result.current.navigation.onPrevious();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(3);
    });

    props = options({
      items: [],
      page: 3,
      hasPreviousPage: true,
      hasNextPage: true,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    props = options({
      items: [],
      page: 2,
      hasPreviousPage: true,
      hasNextPage: true,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(1);
    });

    props = options({ items: [{ label: 'one-a' }, { label: 'one-b' }], onPageChange });
    rerender();
    await waitFor(() => {
      expect(result.current.detailPayload?.record.label).toBe('one-b');
    });
  });

  it('keeps the current detail while an adjacent page is loading', async () => {
    const onPageChange = vi.fn();
    let props = options({
      items: [{ label: 'one' }],
      hasNextPage: true,
      onPageChange,
    });
    const { result, rerender } = renderHook(() => useRowDetailDialog(props));

    act(() => {
      result.current.openDetailAt(0);
    });
    act(() => {
      result.current.navigation.onNext();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    props = options({
      items: [],
      page: 2,
      hasPreviousPage: true,
      loading: true,
      onPageChange,
    });
    rerender();
    expect(result.current.detailPayload?.record.label).toBe('one');
    expect(result.current.navigation.pendingDirection).toBe('next');
    expect(result.current.navigation.canPrevious).toBe(false);
    expect(result.current.navigation.canNext).toBe(false);

    props = options({
      items: [{ label: 'two' }],
      page: 2,
      hasPreviousPage: true,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(result.current.detailPayload?.record.label).toBe('two');
    });
  });

  it('restores the origin page when the dialog closes during navigation', async () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() =>
      useRowDetailDialog(options({ items: [{ label: 'one' }], hasNextPage: true, onPageChange })),
    );

    act(() => {
      result.current.openDetailAt(0);
    });
    act(() => {
      result.current.navigation.onNext();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    act(() => {
      result.current.setDetailOpen(false);
    });
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    expect(result.current.detailOpen).toBe(false);
    expect(result.current.navigation.pendingDirection).toBeNull();
  });

  it('restores the origin and disables an exhausted direction', async () => {
    const onPageChange = vi.fn();
    let props = options({
      items: [{ label: 'one' }],
      hasNextPage: true,
      onPageChange,
    });
    const { result, rerender } = renderHook(() => useRowDetailDialog(props));

    act(() => {
      result.current.openDetailAt(0);
    });
    act(() => {
      result.current.navigation.onNext();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    props = options({
      items: [],
      page: 2,
      hasPreviousPage: true,
      hasNextPage: false,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(1);
    });

    props = options({ items: [{ label: 'one' }], onPageChange });
    rerender();
    await waitFor(() => {
      expect(result.current.navigation.pendingDirection).toBeNull();
      expect(result.current.navigation.canNext).toBe(false);
    });
    expect(result.current.detailPayload?.record.label).toBe('one');
  });

  it('restores the origin after a page failure and allows retry', async () => {
    const onPageChange = vi.fn();
    let props = options({
      items: [{ label: 'one' }],
      hasNextPage: true,
      onPageChange,
    });
    const { result, rerender } = renderHook(() => useRowDetailDialog(props));
    act(() => {
      result.current.openDetailAt(0);
    });
    act(() => {
      result.current.navigation.onNext();
    });
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });

    props = options({
      items: [],
      page: 2,
      hasPreviousPage: true,
      error: new Error('page failed'),
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(onPageChange).toHaveBeenLastCalledWith(1);
    });

    props = options({
      items: [{ label: 'one' }],
      hasNextPage: true,
      onPageChange,
    });
    rerender();
    await waitFor(() => {
      expect(result.current.navigation.error).toBe('Could not load the next row.');
      expect(result.current.navigation.canNext).toBe(true);
    });
    expect(result.current.detailOpen).toBe(true);
  });

  it('closes and clears selection when the result sequence changes', async () => {
    let props = options();
    const { result, rerender } = renderHook(() => useRowDetailDialog(props));
    act(() => {
      result.current.openDetailAt(0);
    });

    props = options({ sequenceKey: 'sequence-2' });
    rerender();
    await waitFor(() => {
      expect(result.current.detailOpen).toBe(false);
      expect(result.current.detailPayload).toBeNull();
    });
  });
});
