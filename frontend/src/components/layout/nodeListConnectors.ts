/**
 * Pure geometry helpers for the workspace list view's relationship gutter.
 *
 * The collapsed list view renders nodes as a flat vertical list (in workspace
 * order). To surface the graph relationships without a full canvas, we draw
 * parent -> child connectors in a left gutter. These helpers turn the flat node
 * order plus the edge list into lane assignments so the SVG renderer in
 * WorkspaceNodeList can route lines without overlaps.
 *
 * Lanes are assigned per target node: every edge that converges on the same
 * child shares one vertical lane, so their vertical segments overlap into a
 * single line ending in one merged arrow. Distinct targets only share a lane
 * when their vertical spans don't conflict (interval-graph colouring).
 *
 * Used by: WorkspaceNodeList (the list-view gutter) because the connector
 * routing needs deterministic, testable lane math separate from rendering.
 */

/** Directed parent -> child relationship between two list nodes. */
export interface NodeListEdge {
  source: string;
  target: string;
}

/**
 * A single resolved connector: the source/target row indices (in display order)
 * and the lane it routes through. Edges sharing a target share a lane.
 */
export interface ConnectorSegment {
  source: string;
  target: string;
  /** Row index of the source node in display order. */
  fromRow: number;
  /** Row index of the target node in display order. */
  toRow: number;
  /** Horizontal lane (0 = nearest the node column; higher = further left). */
  lane: number;
}

export interface ConnectorLayout {
  segments: ConnectorSegment[];
  /** Number of lanes used (0 when there are no drawable edges). */
  laneCount: number;
}

/**
 * Two vertical intervals conflict only when they overlap by more than a shared
 * endpoint. Spans that merely touch at a node (e.g. a -> b and b -> c) may share
 * a lane because they form a continuous vertical path; spans that truly cross
 * are pushed to separate lanes.
 * Called by: computeConnectorLayout's greedy lane assignment.
 */
const intervalsConflict = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

/**
 * Resolves edges into lane assignments for the list gutter.
 *
 * Flow:
 * 1. Map node ids to row indices and drop edges with an endpoint outside the
 *    list (e.g. filtered-out nodes) or self-loops.
 * 2. Group edges by target and compute each target group's vertical span (the
 *    range of rows its lines cover).
 * 3. Greedily colour the target spans into lanes (interval-graph colouring) so
 *    crossing groups never share a lane, while every edge in a group routes
 *    through that group's single lane.
 *
 * Called by: WorkspaceNodeList to build the SVG connector overlay.
 */
export function computeConnectorLayout(
  orderedIds: string[],
  edges: NodeListEdge[],
): ConnectorLayout {
  const rowByID = new Map<string, number>();
  orderedIds.forEach((id, index) => rowByID.set(id, index));

  // Keep only edges whose both endpoints are visible and that span two rows.
  const resolved = edges
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      fromRow: rowByID.get(edge.source),
      toRow: rowByID.get(edge.target),
    }))
    .filter(
      (edge): edge is { source: string; target: string; fromRow: number; toRow: number } =>
        edge.fromRow !== undefined && edge.toRow !== undefined && edge.fromRow !== edge.toRow,
    );

  // Group edges by target so converging lines share a lane. Each group's span
  // covers every row its lines touch, from the earliest source/target row to
  // the latest.
  interface TargetGroup {
    target: string;
    spanStart: number;
    spanEnd: number;
  }
  const groupByTarget = new Map<string, TargetGroup>();
  for (const edge of resolved) {
    const existing = groupByTarget.get(edge.target);
    if (existing) {
      existing.spanStart = Math.min(existing.spanStart, edge.fromRow, edge.toRow);
      existing.spanEnd = Math.max(existing.spanEnd, edge.fromRow, edge.toRow);
    } else {
      groupByTarget.set(edge.target, {
        target: edge.target,
        spanStart: Math.min(edge.fromRow, edge.toRow),
        spanEnd: Math.max(edge.fromRow, edge.toRow),
      });
    }
  }

  // Greedy interval colouring on target spans. Sort by span start (then end) and
  // place each group in the lowest lane whose last occupant doesn't conflict.
  const groups = [...groupByTarget.values()].sort(
    (a, b) => a.spanStart - b.spanStart || a.spanEnd - b.spanEnd,
  );
  const laneSpans: { start: number; end: number }[] = [];
  const laneByTarget = new Map<string, number>();
  for (const group of groups) {
    let lane = laneSpans.findIndex(
      (span) => !intervalsConflict(span.start, span.end, group.spanStart, group.spanEnd),
    );
    if (lane === -1) {
      lane = laneSpans.length;
      laneSpans.push({ start: group.spanStart, end: group.spanEnd });
    } else {
      laneSpans[lane] = { start: group.spanStart, end: group.spanEnd };
    }
    laneByTarget.set(group.target, lane);
  }

  const segments: ConnectorSegment[] = resolved.map((edge) => ({
    source: edge.source,
    target: edge.target,
    fromRow: edge.fromRow,
    toRow: edge.toRow,
    lane: laneByTarget.get(edge.target) ?? 0,
  }));

  return { segments, laneCount: laneSpans.length };
}
