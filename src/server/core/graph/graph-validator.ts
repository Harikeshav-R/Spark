import { z } from "zod";
import type { ConceptNode } from "../../../contracts/course";
import { AppError } from "../../../contracts/errors";

export type GraphNodeInput = Omit<ConceptNode, "id" | "courseId" | "createdAt">;

const graphNodeInputSchema = z.object({
  label: z.string().min(1).max(255),
  description: z.string(),
  category: z.string().max(100),
  difficulty: z.number().int().min(1).max(5),
  x: z.number().refine((val) => Number.isFinite(val), { message: "Coordinate must be a finite number" }).optional(),
  y: z.number().refine((val) => Number.isFinite(val), { message: "Coordinate must be a finite number" }).optional(),
});

const graphEdgeInputSchema = z.tuple([
  z.string().min(1).max(255),
  z.string().min(1).max(255),
]);

export function topologicalSort(
  nodes: readonly GraphNodeInput[],
  edges: readonly [string, string][],
): string[] {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Nodes and edges must be arrays",
    });
  }

  for (let i = 0; i < nodes.length; i++) {
    const parseResult = graphNodeInputSchema.safeParse(nodes[i]);
    if (!parseResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: `Invalid concept node input at index ${i}: ${parseResult.error.message}`,
        cause: parseResult.error,
      });
    }
  }

  for (let i = 0; i < edges.length; i++) {
    const parseResult = graphEdgeInputSchema.safeParse(edges[i]);
    if (!parseResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: `Invalid concept edge input at index ${i}: ${parseResult.error.message}`,
        cause: parseResult.error,
      });
    }
  }

  if (nodes.length < 1 || nodes.length > 40) {
    throw new AppError({
      code: "UNPROCESSABLE_ENTITY",
      statusCode: 422,
      message: `Concept count must be between 1 and 40, got ${nodes.length}`,
      cause: { count: nodes.length },
    });
  }

  const labelSet = new Set<string>();
  for (const node of nodes) {
    if (labelSet.has(node.label)) {
      throw new AppError({
        code: "UNPROCESSABLE_ENTITY",
        statusCode: 422,
        message: `Duplicate concept label: ${node.label}`,
        cause: { label: node.label },
      });
    }
    labelSet.add(node.label);
  }

  const seenEdges = new Set<string>();
  for (const [source, target] of edges) {
    if (source === target) {
      throw new AppError({
        code: "UNPROCESSABLE_ENTITY",
        statusCode: 422,
        message: `Self-edge detected: ${source} -> ${target}`,
        cause: { source, target },
      });
    }

    if (!labelSet.has(source)) {
      throw new AppError({
        code: "UNPROCESSABLE_ENTITY",
        statusCode: 422,
        message: `Edge source not found in concept nodes: ${source}`,
        cause: { endpoint: source },
      });
    }

    if (!labelSet.has(target)) {
      throw new AppError({
        code: "UNPROCESSABLE_ENTITY",
        statusCode: 422,
        message: `Edge target not found in concept nodes: ${target}`,
        cause: { endpoint: target },
      });
    }

    const edgeKey = `${source}\0${target}`;
    if (seenEdges.has(edgeKey)) {
      throw new AppError({
        code: "UNPROCESSABLE_ENTITY",
        statusCode: 422,
        message: `Duplicate edge: ${source} -> ${target}`,
        cause: { source, target },
      });
    }
    seenEdges.add(edgeKey);
  }

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.label, []);
  }
  for (const [source, target] of edges) {
    adjacency.get(source)!.push(target);
  }

  // DFS States: 0 = unvisited (white), 1 = visiting (gray), 2 = visited (black)
  const state = new Map<string, number>();
  for (const node of nodes) {
    state.set(node.label, 0);
  }

  const currentPath: string[] = [];
  const postOrder: string[] = [];

  function dfs(u: string): void {
    state.set(u, 1);
    currentPath.push(u);

    const neighbors = adjacency.get(u) ?? [];
    for (const v of neighbors) {
      const neighborState = state.get(v) ?? 0;
      if (neighborState === 1) {
        const cycleStartIdx = currentPath.indexOf(v);
        const cyclePath = [...currentPath.slice(cycleStartIdx), v];
        throw new AppError({
          code: "UNPROCESSABLE_ENTITY",
          statusCode: 422,
          message: `Knowledge graph contains a cycle: ${cyclePath.join(" -> ")}`,
          cause: { cyclePath },
        });
      }
      if (neighborState === 0) {
        dfs(v);
      }
    }

    currentPath.pop();
    state.set(u, 2);
    postOrder.push(u);
  }

  for (const node of nodes) {
    if ((state.get(node.label) ?? 0) === 0) {
      dfs(node.label);
    }
  }

  return postOrder.reverse();
}

export async function validateGraph(
  nodes: GraphNodeInput[],
  edges: [string, string][],
): Promise<boolean> {
  topologicalSort(nodes, edges);
  return true;
}
