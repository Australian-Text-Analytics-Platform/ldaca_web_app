import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NodeLike } from '../useNodeColumnInfos';
import { useAutoNodeColumns } from '../useAutoNodeColumns';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Builds node-like fixtures while preserving each test's explicit metadata shape. */
/** Used by: tests in this file. */
const buildNode = (overrides: Partial<NodeLike> & { id: string }): NodeLike => ({
  ...overrides,
});

/** Mirrors the production column-persistence key for direct sessionStorage assertions. */
/** Used by: tests in this file. */
const STORAGE_KEY = (workspaceId: string, scope = 'analysis') =>
  `ldaca:column-pref:v1:${workspaceId}:${scope}`;

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('useAutoNodeColumns', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe('initial state', () => {
    it('starts empty when no workspaceId is provided and persistence is disabled', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [],
          persist: false,
        }),
      );
      expect(result.current.selections).toEqual([]);
    });

    it('hydrates from sessionStorage when persist + workspaceId are provided', () => {
      window.sessionStorage.setItem(
        STORAGE_KEY('ws-A'),
        JSON.stringify({ 'node-1': 'col_a', 'node-2': 'col_b' }),
      );

      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [
            buildNode({ id: 'node-1', columns: ['col_a'] }),
            buildNode({ id: 'node-2', columns: ['col_b'] }),
          ],
          workspaceId: 'ws-A',
        }),
      );

      // Hydration runs on mount; selections should reflect persisted entries.
      expect(result.current.selections).toEqual(
        expect.arrayContaining([
          { nodeId: 'node-1', column: 'col_a' },
          { nodeId: 'node-2', column: 'col_b' },
        ]),
      );
    });
  });

  describe('setSelection / setSelections', () => {
    it('setSelection adds a new entry without disturbing existing ones', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [
            buildNode({ id: 'n1', columns: ['c1'] }),
            buildNode({ id: 'n2', columns: ['c2'] }),
          ],
          workspaceId: 'ws-merge',
        }),
      );

      act(() => {
        result.current.setSelection('n1', 'c1');
      });
      act(() => {
        result.current.setSelection('n2', 'c2');
      });

      expect(result.current.selections).toEqual(
        expect.arrayContaining([
          { nodeId: 'n1', column: 'c1' },
          { nodeId: 'n2', column: 'c2' },
        ]),
      );
    });

    it('setSelections with replace:true wipes prior entries', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [
            buildNode({ id: 'n1', columns: ['c1'] }),
            buildNode({ id: 'n2', columns: ['c2'] }),
          ],
          workspaceId: 'ws-replace',
        }),
      );

      act(() => {
        result.current.setSelections(
          [
            { nodeId: 'n1', column: 'c1' },
            { nodeId: 'n2', column: 'c2' },
          ],
          { replace: true },
        );
      });
      expect(result.current.selections).toHaveLength(2);

      act(() => {
        result.current.setSelections([{ nodeId: 'n3', column: 'c3' }], { replace: true });
      });
      expect(result.current.selections).toEqual([{ nodeId: 'n3', column: 'c3' }]);
    });

    it('returns a stable reference when the next state is structurally equal', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1', columns: ['c1'] })],
          workspaceId: 'ws-stable',
        }),
      );

      act(() => {
        result.current.setSelection('n1', 'c1');
      });
      const first = result.current.selections;

      act(() => {
        result.current.setSelection('n1', 'c1');
      });
      expect(result.current.selections).toBe(first);
    });

    it('persists non-empty selections to sessionStorage and removes the key when emptied', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1', columns: ['c1'] })],
          workspaceId: 'ws-persist',
        }),
      );

      act(() => {
        result.current.setSelection('n1', 'c1');
      });

      const stored = window.sessionStorage.getItem(STORAGE_KEY('ws-persist'));
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual({ n1: 'c1' });

      act(() => {
        result.current.setSelections([], { replace: true });
      });
      expect(window.sessionStorage.getItem(STORAGE_KEY('ws-persist'))).toBeNull();
    });

    it('skips persistence when persist:false is passed', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1', columns: ['c1'] })],
          workspaceId: 'ws-skip',
        }),
      );

      act(() => {
        result.current.setSelection('n1', 'c1');
      });
      window.sessionStorage.clear();

      act(() => {
        result.current.setSelections([{ nodeId: 'n1', column: 'changed' }], {
          replace: true,
          persist: false,
        });
      });

      expect(window.sessionStorage.getItem(STORAGE_KEY('ws-skip'))).toBeNull();
    });
  });

  describe('recomputeAutoColumns', () => {
    it('auto-picks the document column when one is exposed on the node', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [
            buildNode({
              id: 'n1',
              columns: ['col_a', 'col_b', 'doc_col'],
              data: { documentColumn: 'doc_col' },
            }),
          ],
          workspaceId: 'ws-doc',
          /** Returns exposed columns so auto-selection can prefer the document column. */
          /** Used by: tests in this file. */
          getNodeColumns: () => ['col_a', 'col_b', 'doc_col'],
        }),
      );

      // The auto-recompute fires on mount via the selectedNodeIdsKey effect.
      expect(result.current.selections).toEqual([{ nodeId: 'n1', column: 'doc_col' }]);
    });

    it('falls back to the first column when no document column is exposed and docTypeOnly is false', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1', columns: ['first', 'second'] })],
          workspaceId: 'ws-first',
          /** Returns columns for the first-column fallback path. */
          /** Used by: tests in this file. */
          getNodeColumns: () => ['first', 'second'],
        }),
      );

      expect(result.current.selections).toEqual([{ nodeId: 'n1', column: 'first' }]);
    });

    it('leaves column blank when docTypeOnly is true and no document column is present', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1', columns: ['first', 'second'] })],
          workspaceId: 'ws-doctype',
          docTypeOnly: true,
          /** Returns non-document columns so docTypeOnly leaves selection blank. */
          /** Used by: tests in this file. */
          getNodeColumns: () => ['first', 'second'],
        }),
      );

      expect(result.current.selections).toEqual([{ nodeId: 'n1', column: '' }]);
    });

    it('does not run when isLocked is true', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [
            buildNode({
              id: 'n1',
              columns: ['col_a'],
              data: { documentColumn: 'col_a' },
            }),
          ],
          workspaceId: 'ws-locked',
          isLocked: true,
          /** Supplies a selectable column that should be ignored while locked. */
          /** Used by: tests in this file. */
          getNodeColumns: () => ['col_a'],
        }),
      );

      // recompute is gated on !isLocked, so selections stay empty.
      expect(result.current.selections).toEqual([]);
    });
  });

  describe('allowedDataTypes filter (columnOptions)', () => {
    it('drops non-matching types from columnOptions', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1' })],
          workspaceId: 'ws-types',
          allowedDataTypes: ['datetime'],
          /** Returns typed columns so the hook can filter options by allowed data type. */
          /** Used by: tests in this file. */
          getNodeColumns: () => [
            { name: 'created_at', dataType: 'datetime' },
            { name: 'category', dataType: 'string' },
          ],
        }),
      );

      expect(result.current.columnOptions.n1?.columns).toEqual([
        { name: 'created_at', dataType: 'datetime' },
      ]);
      expect(result.current.columnOptions.n1?.filteredOutByType).toBe(false);
    });

    it('marks filteredOutByType=true when none of the columns match the allowed types', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [buildNode({ id: 'n1' })],
          workspaceId: 'ws-no-match',
          allowedDataTypes: ['datetime'],
          /** Returns only mismatched types to exercise the filtered-out flag. */
          /** Used by: tests in this file. */
          getNodeColumns: () => [
            { name: 'category', dataType: 'string' },
            { name: 'priority', dataType: 'integer' },
          ],
        }),
      );

      expect(result.current.columnOptions.n1?.filteredOutByType).toBe(true);
      expect(result.current.columnOptions.n1?.columns).toEqual(
        expect.arrayContaining([
          { name: 'category', dataType: 'string' },
          { name: 'priority', dataType: 'integer' },
        ]),
      );
    });
  });

  describe('maxNodes window', () => {
    it('only considers the first N nodes in selections + columnOptions', () => {
      const { result } = renderHook(() =>
        useAutoNodeColumns({
          selectedNodes: [
            buildNode({ id: 'n1', columns: ['c1'] }),
            buildNode({ id: 'n2', columns: ['c2'] }),
            buildNode({ id: 'n3', columns: ['c3'] }),
          ],
          maxNodes: 2,
          workspaceId: 'ws-max',
          /** Reads each node's own columns so max-node trimming is the only variable. */
          /** Used by: tests in this file. */
          getNodeColumns: (n) => (n.columns as string[] | undefined) ?? [],
        }),
      );

      const ids = result.current.selections.map((sel) => sel.nodeId);
      expect(ids).toEqual(['n1', 'n2']);
      expect(Object.keys(result.current.columnOptions)).toEqual(
        expect.arrayContaining(['n1', 'n2']),
      );
      expect(result.current.columnOptions.n3).toBeUndefined();
    });
  });
});
