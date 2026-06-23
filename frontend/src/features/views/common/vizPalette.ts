/**
 * Static colour palette for in-result data visualisations (e.g. the
 * concordance dispersion plot's matched-term colours and the combined
 * results table's per-source colours).
 *
 * This is intentionally NOT the old per-node "node colour" system — there
 * is no store, no persistence, and no user picker. Callers index into this
 * array by position (term index / source index) to get a stable, repeatable
 * colour for a chart or table without any cross-tab state.
 *
 * Used by: concordance/ConcordanceFeature.tsx for matched-term and
 * per-source colour maps.
 */
export const VIZ_PALETTE: string[] = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#d97706',
  '#0d9488',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#0891b2',
  '#92400e',
  '#6b7280',
];

/**
 * Build a stable ``nodeId → colour`` map by assigning each id a palette
 * colour by its position. Replaces the old per-node colour store for chart
 * legends/series in the functional analysis tabs (token frequency, topic
 * modeling, trends): colours are deterministic and repeatable per selection
 * order, with no persistence or user picker.
 *
 * Used by: analysis feature tabs that colour chart series by source node.
 */
export function vizColorMapForNodes(nodeIds: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  nodeIds.forEach((id, idx) => {
    if (id) map[id] = VIZ_PALETTE[idx % VIZ_PALETTE.length] ?? '';
  });
  return map;
}
