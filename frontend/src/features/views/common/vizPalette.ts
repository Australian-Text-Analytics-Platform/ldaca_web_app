/**
 * Static colour palette for in-result data visualisations (e.g. the
 * concordance dispersion plot's matched-term colours and the combined
 * results table's per-source colours).
 *
 * Callers index into this array by position (term index / source index) to get
 * a stable, repeatable fallback colour for a chart or table. Analysis tabs
 * that expose source-node colour controls write user choices to ``Node.color``
 * and use this palette only when a selected node does not yet have a colour.
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
 * Build default ``nodeId → colour`` assignments by selected-node position.
 * Used as the fallback map for chart legends/series in analysis tabs before
 * caller-owned ``Node.color`` values are layered over the defaults.
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
