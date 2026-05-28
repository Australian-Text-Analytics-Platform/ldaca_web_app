/**
 * ``useSnapshotViewStore`` — per-tool view-mode + loaded-snapshot
 * registry. Each analysis tool reads its own slice; tools are
 * independent so a snapshot view in concordance can coexist with a
 * live view in quotation.
 *
 * The store is named ``useSnapshotViewStore`` (not ``DemoSnapshot``)
 * because demo and share snapshot modes use the same per-tool slices.
 */
import { create } from 'zustand';
import type { LoadedSnapshot, SnapshotToolKey, ViewMode } from './types';
import { LIVE_MODE } from './mode';

/** Per-tool mode map. Defaults every tool to live; the store keeps a
 * sparse record and treats ``undefined`` as live. */
type ModeMap = Partial<Record<SnapshotToolKey, ViewMode>>;

/** Per-tool slice: the snapshot currently loaded for that tool, or
 * ``null`` when in live mode. Typed as ``LoadedSnapshot`` with the
 * default ``unknown`` payload; per-tool capture/load code narrows the
 * generic at the call site. */
type SlicesMap = Partial<Record<SnapshotToolKey, LoadedSnapshot | null>>;

interface SnapshotViewState {
  mode: ModeMap;
  /** Loaded snapshots keyed by tool. Distinct from ``mode`` so a
   * loader can hydrate the slice *then* flip the mode atomically. */
  snapshots: SlicesMap;

  /** Read the active mode for a tool. Returns the live default if
   * the tool has never been set. */
  getMode(tool: SnapshotToolKey): ViewMode;
  /** Set the active mode for a tool. Does not touch the snapshot
   * slice; callers either populate the slice first (load flow) or
   * clear it after (exit flow). */
  setMode(tool: SnapshotToolKey, mode: ViewMode): void;

  /** Load a snapshot into a tool's slice and flip the mode in one
   * atomic update. ``mode`` controls whether to enter demo or share
   * view — must match the snapshot's manifest mode (callers verify;
   * the store does not police). */
  loadSnapshot(
    tool: SnapshotToolKey,
    snapshot: LoadedSnapshot,
    mode: Extract<ViewMode, { kind: 'demoSnapshot' | 'shareSnapshot' }>,
  ): void;

  /** Clear a tool's snapshot and return it to live mode. Idempotent. */
  exitSnapshot(tool: SnapshotToolKey): void;

  /** Read the loaded snapshot for a tool, if any. */
  getSnapshot(tool: SnapshotToolKey): LoadedSnapshot | null;

  /** Test utility: clear all tools. Production code should call
   * ``exitSnapshot`` per tool, not this. */
  reset(): void;
}

export const useSnapshotViewStore = create<SnapshotViewState>((set, get) => ({
  mode: {},
  snapshots: {},

  getMode: (tool) => get().mode[tool] ?? LIVE_MODE,

  setMode: (tool, mode) => {
    set((state) => ({ mode: { ...state.mode, [tool]: mode } }));
  },

  loadSnapshot: (tool, snapshot, mode) => {
    set((state) => ({
      mode: { ...state.mode, [tool]: mode },
      snapshots: { ...state.snapshots, [tool]: snapshot },
    }));
  },

  exitSnapshot: (tool) => {
    set((state) => ({
      mode: { ...state.mode, [tool]: LIVE_MODE },
      snapshots: { ...state.snapshots, [tool]: null },
    }));
  },

  getSnapshot: (tool) => get().snapshots[tool] ?? null,

  reset: () => set({ mode: {}, snapshots: {} }),
}));

/** Selector hook — read a tool's current view mode. Defaults to live
 * when the store has no entry for the tool. Recommended over inline
 * ``useSnapshotViewStore(s => s.mode[tool])`` so call sites don't
 * have to import ``LIVE_MODE`` separately. */
export function useToolSnapshotMode(tool: SnapshotToolKey) {
  return useSnapshotViewStore((s) => s.mode[tool] ?? LIVE_MODE);
}
