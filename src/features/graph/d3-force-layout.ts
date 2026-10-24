import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceY,
  forceX,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { z } from "zod";
import type {
  graphNodeResponseSchema,
  graphEdgeResponseSchema,
} from "../../contracts/course";
import { confidenceSchema } from "../../contracts/mastery";

export type GraphNode = Omit<z.infer<typeof graphNodeResponseSchema>, "importance">;
export type GraphEdge = z.infer<typeof graphEdgeResponseSchema>;

export type GraphData = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
};

export type PositionedNode = {
  id: string;
  level: number;
  x: number;
  y: number;
};

export type GraphLayout = {
  nodes: PositionedNode[];
  edges: readonly GraphEdge[];
};

interface D3SimNode extends SimulationNodeDatum {
  id: string;
  level: number;
}

interface D3SimLink extends SimulationLinkDatum<D3SimNode> {
  id: string;
  source: string | D3SimNode;
  target: string | D3SimNode;
}

/**
 * Validates graph invariants:
 * - Empty graph or <= 40 nodes
 * - Unique node IDs and finite [0, 1] confidence
 * - Unique edge IDs and unique directed pairs
 * - No self-edges and no missing endpoints
 * - Acyclic (strictly directed DAG)
 */
export function validateKnowledgeGraph(
  graph: GraphData
): { valid: true } | { valid: false; reason: string } {
  if (graph.nodes.length === 0 && graph.edges.length === 0) {
    return { valid: true };
  }

  if (graph.nodes.length > 40) {
    return {
      valid: false,
      reason: `node count exceeds maximum of 40 (found ${graph.nodes.length})`,
    };
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (nodeMap.has(node.id)) {
      return { valid: false, reason: `duplicate node ID "${node.id}"` };
    }
    nodeMap.set(node.id, node);

    if (node.confidence !== undefined) {
      const parsed = confidenceSchema.safeParse(node.confidence);
      if (!parsed.success) {
        return {
          valid: false,
          reason: `node "${node.id}" has invalid confidence ${node.confidence}`,
        };
      }
    }
  }

  const edgeIdSet = new Set<string>();
  const directedPairSet = new Set<string>();
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (edgeIdSet.has(edge.id)) {
      return { valid: false, reason: `duplicate edge ID "${edge.id}"` };
    }
    edgeIdSet.add(edge.id);

    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      return {
        valid: false,
        reason: `edge "${edge.id}" references missing endpoint (${edge.source} -> ${edge.target})`,
      };
    }

    if (edge.source === edge.target) {
      return {
        valid: false,
        reason: `self-edge detected on node "${edge.source}"`,
      };
    }

    const pairKey = `${edge.source}->${edge.target}`;
    if (directedPairSet.has(pairKey)) {
      return {
        valid: false,
        reason: `duplicate directed edge from "${edge.source}" to "${edge.target}"`,
      };
    }
    directedPairSet.add(pairKey);

    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }

  // Cycle detection via Kahn's algorithm
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
    }
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    visitedCount++;
    for (const v of outgoing.get(u)!) {
      const nextDegree = (inDegree.get(v) ?? 0) - 1;
      inDegree.set(v, nextDegree);
      if (nextDegree === 0) {
        queue.push(v);
      }
    }
  }

  if (visitedCount < graph.nodes.length) {
    return {
      valid: false,
      reason: `cycle detected (visited ${visitedCount} of ${graph.nodes.length} nodes)`,
    };
  }

  return { valid: true };
}

/**
 * Computes deterministic topological depth and spatial coordinates for knowledge graph nodes.
 * Validates graph invariants (acyclic, <= 40 nodes, no duplicate IDs, valid confidence).
 */
export function computeGraphLayout(
  graph: GraphData,
  options: { width: number; reducedMotion: boolean }
): GraphLayout {
  if (graph.nodes.length === 0 && graph.edges.length === 0) {
    return { nodes: [], edges: [] };
  }

  const validation = validateKnowledgeGraph(graph);
  if (!validation.valid) {
    throw new Error(`Invalid knowledge graph: ${validation.reason}`);
  }

  const originalOrder = new Map<string, number>();
  for (let i = 0; i < graph.nodes.length; i++) {
    originalOrder.set(graph.nodes[i].id, i);
  }

  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }

  // Kahn's traversal to compute longest-path level for each node
  const levels = new Map<string, number>();
  for (const node of graph.nodes) {
    levels.set(node.id, 0);
  }

  const queue: string[] = [];
  for (const node of graph.nodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    const uLevel = levels.get(u)!;

    for (const v of outgoing.get(u)!) {
      levels.set(v, Math.max(levels.get(v)!, uLevel + 1));
      const nextDegree = (inDegree.get(v) ?? 0) - 1;
      inDegree.set(v, nextDegree);
      if (nextDegree === 0) {
        queue.push(v);
      }
    }
  }

  // Sort nodes by level ascending, then original input order (keyboard traversal order)
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const levelA = levels.get(a.id)!;
    const levelB = levels.get(b.id)!;
    if (levelA !== levelB) {
      return levelA - levelB;
    }
    return originalOrder.get(a.id)! - originalOrder.get(b.id)!;
  });

  // Group sorted nodes by level to compute initial deterministic positions
  const levelGroups = new Map<number, string[]>();
  for (const node of sortedNodes) {
    const lvl = levels.get(node.id)!;
    const group = levelGroups.get(lvl) ?? [];
    group.push(node.id);
    levelGroups.set(lvl, group);
  }

  const width = options.width > 0 ? options.width : 640;
  const initialPositions = new Map<string, { x: number; y: number; level: number }>();

  for (const [lvl, nodeIds] of levelGroups.entries()) {
    const count = nodeIds.length;
    for (let i = 0; i < count; i++) {
      const id = nodeIds[i];
      const x = (width * (i + 1)) / (count + 1);
      const y = lvl * 120;
      initialPositions.set(id, { x, y, level: lvl });
    }
  }

  // Reduced-motion mode: return deterministic initial level positions
  if (options.reducedMotion) {
    return {
      nodes: sortedNodes.map((n) => {
        const pos = initialPositions.get(n.id)!;
        return {
          id: n.id,
          level: pos.level,
          x: pos.x,
          y: pos.y,
        };
      }),
      edges: graph.edges,
    };
  }

  // Normal mode: D3-force simulation (300 ticks synchronous off-screen)
  const simNodes: D3SimNode[] = sortedNodes.map((n) => {
    const pos = initialPositions.get(n.id)!;
    return {
      id: n.id,
      level: pos.level,
      x: pos.x,
      y: pos.y,
    };
  });

  // Create fresh link objects so D3 mutation does not touch caller edges
  const simLinks: D3SimLink[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));

  const simulation = forceSimulation(simNodes)
    .stop()
    .force("charge", forceManyBody().strength(-400))
    .force(
      "link",
      forceLink<D3SimNode, D3SimLink>(simLinks)
        .id((d) => d.id)
        .distance(80)
        .strength(0.7)
    )
    .force(
      "y",
      forceY<D3SimNode>((d) => d.level * 120).strength(0.8)
    )
    .force("x", forceX<D3SimNode>(width / 2).strength(0.1))
    .force("collide", forceCollide<D3SimNode>(88).iterations(2));

  simulation.tick(300);

  const positionedNodes: PositionedNode[] = simNodes.map((n) => {
    const fallback = initialPositions.get(n.id)!;
    return {
      id: n.id,
      level: n.level,
      x: Number.isFinite(n.x) ? n.x! : fallback.x,
      y: Number.isFinite(n.y) ? n.y! : fallback.y,
    };
  });

  return {
    nodes: positionedNodes,
    edges: graph.edges,
  };
}

/**
 * Traverses incoming prerequisite edges backward to foundational roots.
 * Collects all reachable ancestor node IDs (including the selected node)
 * and all traversed edge IDs (including both sides of diamonds).
 */
export function getPrerequisitePath(
  graph: GraphData,
  selectedId: string
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeExists = graph.nodes.some((n) => n.id === selectedId);
  if (!nodeExists) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }

  // Map each target node to its incoming edges
  const incoming = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }

  const nodeIds = new Set<string>([selectedId]);
  const edgeIds = new Set<string>();
  const queue = [selectedId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const inEdges = incoming.get(current) ?? [];

    for (const edge of inEdges) {
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.source)) {
        nodeIds.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  return { nodeIds, edgeIds };
}
