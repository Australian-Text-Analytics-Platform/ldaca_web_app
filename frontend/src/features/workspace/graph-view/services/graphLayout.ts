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
    ranker: 'longest-path',
  });
  g.setDefaultEdgeLabel(() => ({}));

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
