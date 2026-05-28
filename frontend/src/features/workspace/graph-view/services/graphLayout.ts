import dagre from 'dagre';

export interface GraphLayoutOptions {
  rankdir?: 'LR' | 'TB';
  ranksep?: number;
  nodesep?: number;
}

interface GraphNode {
  id: string;
}

interface GraphEdge {
  source: string;
  target: string;
}

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 140;

// Synthetic node id only used inside this function. We add it to dagre's
// local graph as the parent of every real root so dagre's ranker treats
// all roots as rank-1 (one over from the super source), giving them a
// shared leftmost column. The id is then stripped from the output so no
// caller — and not the workspaceGraph React Query payload — ever sees
// it. The double-underscore prefix and uuid-like tail make a collision
// with a real workspace node id effectively impossible.
const SUPER_SOURCE_ID = '__dagre_super_source_2f7c3a__';

/**
 * Computes React Flow node positions from workspace graph nodes and edges.
 * Used by: graphLayout tests, useWorkspaceGraph hook (rg call sites/imports).
 * Why: because the graph hook needs deterministic Dagre positions before React Flow receives node coordinates.
 * Flow: build a Dagre graph, add nodes and edges, run layout, then map positions back onto React Flow nodes.
 */
export const computeDagreLayout = (
  nodes: GraphNode[] = [],
  edges: GraphEdge[] = [],
  options: GraphLayoutOptions = {}
) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: options.rankdir ?? 'LR',
    ranksep: options.ranksep ?? 140,
    nodesep: options.nodesep ?? 100,
    // ``network-simplex`` (the default) minimises total edge length, so
    // the super-source → root edges pull every root to the rank
    // directly after the super-source — a shared leftmost column.
    // The previously-used ``longest-path`` ranker greedily pushes each
    // node as far right as the longest descendant chain allows, which
    // is precisely why short-chain roots used to drift rightward.
    ranker: 'network-simplex',
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Pin every real root to a shared leftmost column by wiring them all
  // under a virtual super-source. Dagre 0.8.5 doesn't honour any
  // user-facing rank-constraint directive; with ``longest-path``, the
  // ranker normalises ranks so short-chain roots end up at the *right*
  // edge of the canvas — exactly the bug we're working around. Adding
  // a single artificial parent gives every root an incoming edge, so
  // they all share rank 1 in the layout pass. The super-source is then
  // stripped from the position output so the rest of the app never
  // learns it existed.
  const incomingTargets = new Set(edges.map((edge) => edge.target));
  const rootIds = nodes
    .filter((node) => !incomingTargets.has(node.id))
    .map((node) => node.id);
  const useSuperSource = rootIds.length > 0;

  if (useSuperSource) {
    g.setNode(SUPER_SOURCE_ID, { width: 0, height: 0 });
    rootIds.forEach((rootId) => g.setEdge(SUPER_SOURCE_ID, rootId));
  }

  nodes.forEach((node) => {
    g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
  });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const layoutNode = g.node(node.id);
    if (layoutNode) {
      positions.set(node.id, {
        x: layoutNode.x - DEFAULT_NODE_WIDTH / 2,
        y: layoutNode.y - DEFAULT_NODE_HEIGHT / 2,
      });
    } else {
      positions.set(node.id, {
        x: index * DEFAULT_NODE_WIDTH,
        y: 50,
      });
    }
  });

  return positions;
};
