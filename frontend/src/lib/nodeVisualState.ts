/**
 * Compute the visual state of a workspace node for the graph + sidebar.
 *
 * Implements the design captured in
 * ``frontend/docs/developer-guide/node-colour-strategy.md`` — every node is
 * in exactly one of three states relative to the currently-visible analytics
 * view:
 *
 *   - ``active``: in the current view's last-N selected window (the set
 *     that "Run" will actually run against). Strongest visual weight.
 *   - ``focus``: selected in the workspace but bumped out of the active
 *     window by a more recent selection (i.e. selected but not active).
 *   - ``unselected``: not in the workspace selection at all.
 *
 * The per-view N comes from the table in the strategy doc. ``'all'``
 * means there is no cap (e.g. Export, Stack) — every selected node is
 * active.
 *
 * For sub-tools that live inside one ``ViewType`` (the
 * ``DataPreprocessingFeature`` hosts filter / sample / find / create /
 * polars expression / join / stack as sub-tabs), this helper uses the
 * most-common N for the parent view and defers the per-sub-tab refinement
 * to a future store. See "Open questions" in the strategy doc.
 */
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import type { ViewType } from '@/stores/uiStore';
import { type ColorPair, colorPairFor } from './color';

export type NodeVisualState = 'active' | 'focus' | 'unselected';

/** Per-view max number of nodes that ``Run`` will process. ``'all'`` for
 * tools that accept the full selection set without a cap. */
export const PER_VIEW_ACTIVE_LIMIT: Record<ViewType, number | 'all'> = {
  'data-loader': 'all',
  // The DataPreprocessing host runs filter / sample / find / create /
  // polars expression at 1, and join / stack at 2..all. We use 1 as the
  // conservative default — the most common single-node sub-tools dominate.
  // Future work: thread sub-tab into a separate store so join/stack
  // override this without touching the parent view.
  filter: 1,
  'token-frequency': 2,
  concordance: 2,
  // 'analysis' is Trends in the UI.
  analysis: 1,
  'topic-modeling': 2,
  quotation: 1,
  'ai-annotator': 1,
  export: 'all',
};

export interface NodeVisualContext {
  /** Workspace selection order (latest selection at the end of the
   * array). Drives the "last-N" derivation. */
  selectedNodeIds: ReadonlyArray<string>;
  /** Currently-visible analytics view. Determines the active-limit. */
  currentView: ViewType;
  /** ``Record<nodeId, hexColor>`` from the global ``useNodeColorsStore``.
   * Passed in (rather than imported) so this module stays pure and easy
   * to unit-test. */
  assignedColors: Readonly<Record<string, string>>;
}

export interface NodeVisualInfo {
  state: NodeVisualState;
  /** ``{ X, Y }`` pair to render the node with. ``X`` is the assigned
   * colour (or the grey fallback when none assigned); ``Y`` is the
   * same-hue light variant. See ``colorPairFor``. */
  pair: ColorPair;
}

/** Compute the active-set (last-N selected) for a context. ``'all'``
 * returns the full selection. */
/** Used by: src/lib/__tests__/nodeVisualState.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function activeSetForContext(ctx: NodeVisualContext): string[] {
  const limit = PER_VIEW_ACTIVE_LIMIT[ctx.currentView];
  if (limit === 'all') return [...ctx.selectedNodeIds];
  return takeMostRecent([...ctx.selectedNodeIds], limit);
}

/** Decide how one node should be rendered. */
/** Used by: src/components/layout/sidebar/SidebarNodesSection.tsx, src/features/workspace/graph-view/hooks/useWorkspaceGraph.ts, src/lib/__tests__/nodeVisualState.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function nodeVisualInfo(nodeId: string, ctx: NodeVisualContext): NodeVisualInfo {
  const pair = colorPairFor(ctx.assignedColors[nodeId]);
  if (!ctx.selectedNodeIds.includes(nodeId)) {
    return { state: 'unselected', pair };
  }
  const activeIds = activeSetForContext(ctx);
  return {
    state: activeIds.includes(nodeId) ? 'active' : 'focus',
    pair,
  };
}
