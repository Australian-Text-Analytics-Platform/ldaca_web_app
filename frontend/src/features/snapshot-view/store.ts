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

  /**
   * Lets tool panels read their current live/demo/share mode.
   * Called by: store object consumers because tool panels need mode lookup without duplicating live-mode defaults.
   * Flow: look up the sparse per-tool mode map, fall back to live mode, and return a concrete mode for render branching.
   */
  getMode: (tool) => get().mode[tool] ?? LIVE_MODE,

  /**
   * Updates only mode so callers can switch without touching loaded payloads.
   * Consumed by: store return object for feature components.
   * Why: because feature components need the selected tool mode to choose between live backend state and snapshot payloads.
   */
  setMode: (tool, mode) => {
    set((state) => ({ mode: { ...state.mode, [tool]: mode } }));
  },

  /**
   * Hydrates a tool snapshot and enters its read-only snapshot mode together.
   * Called by: store object consumers because loaders need one atomic transition into snapshot-backed state.
   * Flow: copy existing mode and snapshot maps, store the loaded payload for one tool, then set its demo/share mode in the same Zustand update.
   */
  loadSnapshot: (tool, snapshot, mode) => {
    set((state) => ({
      mode: { ...state.mode, [tool]: mode },
      snapshots: { ...state.snapshots, [tool]: snapshot },
    }));
  },

  /**
   * Returns one tool to live mode and clears its frozen snapshot payload.
   * Called by: store object consumers because exit controls need to clear mode and payload together.
   * Flow: keep other tools untouched, replace the selected tool mode with live, and null out its snapshot slice.
   */
  exitSnapshot: (tool) => {
    set((state) => ({
      mode: { ...state.mode, [tool]: LIVE_MODE },
      snapshots: { ...state.snapshots, [tool]: null },
    }));
  },

  /**
   * Lets loaders and analysis hooks read the frozen payload for a tool.
   * Called by: store object consumers because snapshot-backed analysis hooks need the payload paired with the active tool.
   * Flow: read the sparse snapshot map, normalize an absent entry to null, and give callers a concrete loaded-or-empty value.
   */
  getSnapshot: (tool) => get().snapshots[tool] ?? null,

  /**
   * Clears all tool slices for tests and global cleanup flows.
   * Called by: store object consumers because tests and cleanup paths need a single reset boundary.
   * Flow: replace both sparse maps with empty objects so every tool returns to live defaults on the next selector read.
   */
  reset: () => set({ mode: {}, snapshots: {} }),
}));

/**
 * Selector hook — read a tool's current view mode. Defaults to live
 * when the store has no entry for the tool. Recommended over inline
 * ``useSnapshotViewStore(s => s.mode[tool])`` so call sites don't
 * have to import ``LIVE_MODE`` separately.
 * Used by: useSnapshotBackedAnalysisState module, index module, useToolSnapshotMode tests (rg call sites/imports) because consumers need a stable live-mode default.
 * Flow: subscribe to only the requested tool's mode entry, coerce missing state to live, and avoid exposing the sparse map to feature code.
 */
export function useToolSnapshotMode(tool: SnapshotToolKey) {
  return useSnapshotViewStore((s) => s.mode[tool] ?? LIVE_MODE);
}
