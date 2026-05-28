import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DetachDialogNodeOption } from '../../../components/DetachColumnsDialog';
import { useDetachColumnsState } from '../useDetachColumnsState';

/** Used by: useDetachColumnsState tests that need detach-node fixtures because the hook expects full node option records while each case varies only selected columns. Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload. */
const buildNodeOptions = (
  overrides: Partial<DetachDialogNodeOption>[] = [],
): DetachDialogNodeOption[] =>
  overrides.map((override, idx) => ({
    node_id: override.node_id ?? `node-${idx + 1}`,
    node_name: override.node_name ?? `Node ${idx + 1}`,
    available_columns: override.available_columns ?? [],
    disabled_columns: override.disabled_columns ?? [],
  }));

describe('useDetachColumnsState', () => {
  it('starts with an empty selection map', () => {
    const { result } = renderHook(() => useDetachColumnsState([]));
    expect(result.current.selectedDetachColumns).toEqual({});
  });

  describe('toggleDetachColumn', () => {
    it('adds a column when checked is true', () => {
      const { result } = renderHook(() => useDetachColumnsState([]));

      act(() => {
        result.current.toggleDetachColumn('node-1', 'col_a', true);
      });
      expect(result.current.selectedDetachColumns['node-1']).toEqual(['col_a']);
    });

    it('removes a column when checked is false', () => {
      const { result } = renderHook(() => useDetachColumnsState([]));

      act(() => {
        result.current.toggleDetachColumn('node-1', 'col_a', true);
        result.current.toggleDetachColumn('node-1', 'col_b', true);
      });
      expect(result.current.selectedDetachColumns['node-1']).toEqual(['col_a', 'col_b']);

      act(() => {
        result.current.toggleDetachColumn('node-1', 'col_a', false);
      });
      expect(result.current.selectedDetachColumns['node-1']).toEqual(['col_b']);
    });

    it('uses set semantics: toggling-on the same column twice does not duplicate', () => {
      const { result } = renderHook(() => useDetachColumnsState([]));

      act(() => {
        result.current.toggleDetachColumn('node-1', 'col_a', true);
        result.current.toggleDetachColumn('node-1', 'col_a', true);
      });
      expect(result.current.selectedDetachColumns['node-1']).toEqual(['col_a']);
    });

    it('keeps per-node state isolated', () => {
      const { result } = renderHook(() => useDetachColumnsState([]));

      act(() => {
        result.current.toggleDetachColumn('node-1', 'col_a', true);
        result.current.toggleDetachColumn('node-2', 'col_z', true);
      });
      expect(result.current.selectedDetachColumns).toEqual({
        'node-1': ['col_a'],
        'node-2': ['col_z'],
      });
    });
  });

  describe('selectAllDetachColumns', () => {
    it('selects every available, non-disabled column for each node', () => {
      const options = buildNodeOptions([
        {
          node_id: 'n1',
          available_columns: ['col_a', 'col_b', 'col_c'],
          disabled_columns: ['col_b'],
        },
        { node_id: 'n2', available_columns: ['col_x', 'col_y'], disabled_columns: [] },
      ]);
      const { result } = renderHook(() => useDetachColumnsState(options));

      act(() => {
        result.current.selectAllDetachColumns();
      });

      expect(result.current.selectedDetachColumns).toEqual({
        n1: ['col_a', 'col_c'],
        n2: ['col_x', 'col_y'],
      });
    });

    it('overwrites prior selections (does not merge)', () => {
      const options = buildNodeOptions([
        { node_id: 'n1', available_columns: ['col_a'], disabled_columns: [] },
      ]);
      const { result } = renderHook(() => useDetachColumnsState(options));

      act(() => {
        result.current.toggleDetachColumn('n1', 'col_b', true); // not in available_columns
      });
      expect(result.current.selectedDetachColumns['n1']).toEqual(['col_b']);

      act(() => {
        result.current.selectAllDetachColumns();
      });
      expect(result.current.selectedDetachColumns['n1']).toEqual(['col_a']);
    });
  });

  describe('deselectAllDetachColumns', () => {
    it('empties the selection for every option node, leaving untracked nodes alone', () => {
      const options = buildNodeOptions([
        { node_id: 'n1', available_columns: ['col_a'], disabled_columns: [] },
        { node_id: 'n2', available_columns: ['col_x'], disabled_columns: [] },
      ]);
      const { result } = renderHook(() => useDetachColumnsState(options));

      act(() => {
        result.current.selectAllDetachColumns();
        result.current.toggleDetachColumn('untracked', 'foo', true);
      });
      expect(result.current.selectedDetachColumns).toEqual({
        n1: ['col_a'],
        n2: ['col_x'],
        untracked: ['foo'],
      });

      act(() => {
        result.current.deselectAllDetachColumns();
      });
      expect(result.current.selectedDetachColumns).toEqual({
        n1: [],
        n2: [],
        untracked: ['foo'], // not in detachNodeOptions, so untouched
      });
    });
  });

  describe('resetDetachColumns', () => {
    it('clears the entire selection map', () => {
      const { result } = renderHook(() => useDetachColumnsState([]));

      act(() => {
        result.current.toggleDetachColumn('n1', 'a', true);
        result.current.toggleDetachColumn('n2', 'b', true);
      });
      expect(Object.keys(result.current.selectedDetachColumns)).toHaveLength(2);

      act(() => {
        result.current.resetDetachColumns();
      });
      expect(result.current.selectedDetachColumns).toEqual({});
    });
  });
});
