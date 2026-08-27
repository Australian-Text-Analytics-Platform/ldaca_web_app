import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAnnotationRowFilter } from '../useAnnotationRowFilter';

describe('useAnnotationRowFilter', () => {
  it('allows exactly one column to own the filter', () => {
    const { result } = renderHook(() =>
      useAnnotationRowFilter('annotation', ['reviewer_one', 'reviewer_two']),
    );

    act(() => {
      result.current.setFor('reviewer_one', { differs: true, existence: 'off' });
    });
    expect(result.current.filter).toEqual({
      column: 'reviewer_one',
      differs: true,
      existence: 'off',
    });

    act(() => {
      result.current.setFor('annotation', { differs: false, existence: 'empty' });
    });
    expect(result.current.filter).toEqual({
      column: 'annotation',
      differs: false,
      existence: 'empty',
    });
    expect(result.current.valueFor('reviewer_one')).toEqual({
      differs: false,
      existence: 'off',
    });
  });

  it('clears a comparison-owned filter when that comparator is removed', () => {
    const { result, rerender } = renderHook(
      ({ columns }: { columns: string[] }) => useAnnotationRowFilter('annotation', columns),
      { initialProps: { columns: ['reviewer_one'] } },
    );
    act(() => {
      result.current.setFor('reviewer_one', { differs: true, existence: 'present' });
    });

    rerender({ columns: [] });
    expect(result.current.filter).toBeNull();
    rerender({ columns: ['reviewer_one'] });
    expect(result.current.filter).toBeNull();
  });

  it('removes only an impossible annotation difference condition', () => {
    const { result, rerender } = renderHook(
      ({ columns }: { columns: string[] }) => useAnnotationRowFilter('annotation', columns),
      { initialProps: { columns: ['reviewer_one'] } },
    );
    act(() => {
      result.current.setFor('annotation', { differs: true, existence: 'empty' });
    });

    rerender({ columns: [] });
    expect(result.current.filter).toEqual({
      column: 'annotation',
      differs: false,
      existence: 'empty',
    });
    rerender({ columns: ['reviewer_one'] });
    expect(result.current.filter).toEqual({
      column: 'annotation',
      differs: false,
      existence: 'empty',
    });
  });

  it('clears an annotation difference-only filter with no remaining comparator', () => {
    const { result, rerender } = renderHook(
      ({ columns }: { columns: string[] }) => useAnnotationRowFilter('annotation', columns),
      { initialProps: { columns: ['reviewer_one'] } },
    );
    act(() => {
      result.current.setFor('annotation', { differs: true, existence: 'off' });
    });

    rerender({ columns: [] });
    expect(result.current.filter).toBeNull();
  });
});
