/**
 * Compute the tokens-models the picker can offer for a tokens-mode search
 * across the current concordance node selection.
 *
 * Strategy is **intersection** of each selected node's tokens-models for its
 * own selected source column. Because the API call sends a single `model`
 * for every node in one concordance request, we can only safely route to
 * models that every selected node has tokenised against.
 *
 * When the intersection is empty — e.g. ZH (jieba) + JA (lindera-ja-ipadic)
 * — the picker is suppressed (caller checks `length > 1`) and `tokensModel`
 * becomes `null`, which omits the `model` field from the request. Backend's
 * `find_derived_column(..., model=None)` then first-matches per node so each
 * language uses its own tokens column. Live + materialize stay consistent.
 *
 * Pre-bug-1-fix the picker was computed off the first selected node only,
 * which silently mis-routed the JA node to jieba and made materialize 400.
 */

export interface NodeColumnSelectionLike {
  nodeId?: string | null;
  column?: string | null;
}

export interface NodeLikeForIntersection {
  id?: unknown;
  node_id?: unknown;
  derived?: Record<string, unknown> | unknown;
  [key: string]: unknown;
}

function readModelsForColumn(
  derived: unknown,
  sourceColumn: string,
): Set<string> {
  const out = new Set<string>();
  if (!derived || typeof derived !== 'object') return out;
  for (const meta of Object.values(derived as Record<string, unknown>)) {
    if (!meta || typeof meta !== 'object') continue;
    const m = meta as { source_column?: unknown; form?: unknown; model?: unknown };
    if (m.form !== 'tokens') continue;
    if (m.source_column !== sourceColumn) continue;
    if (typeof m.model === 'string') out.add(m.model);
  }
  return out;
}

export function computeTokensModelIntersection<
  Selection extends NodeColumnSelectionLike,
  N extends NodeLikeForIntersection,
>(
  selections: ReadonlyArray<Selection>,
  nodes: ReadonlyArray<N>,
): string[] {
  if (selections.length === 0) return [];

  const perNodeModelSets: Array<Set<string>> = [];
  for (const selection of selections) {
    if (!selection.column) return [];
    const node = nodes.find((candidate) => {
      const ids = [candidate.id, candidate.node_id];
      return ids.some(
        (id) => typeof id === 'string' && id === selection.nodeId,
      );
    });
    perNodeModelSets.push(readModelsForColumn(node?.derived, selection.column));
  }

  const [first, ...rest] = perNodeModelSets;
  if (!first || first.size === 0) return [];

  // Preserve the first node's insertion order so the picker is stable
  // when the user hasn't manually chosen a model.
  return Array.from(first).filter((model) =>
    rest.every((set) => set.has(model)),
  );
}
