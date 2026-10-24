import type { ConceptEdge, ConceptNode } from "../../../contracts/course";
import type { UUID } from "../../../contracts/common";

export function calculateNodeImportance(
  nodes: readonly Pick<ConceptNode, "id">[],
  edges: readonly Pick<ConceptEdge, "sourceId" | "targetId">[],
): Map<UUID, number> {
  const result = new Map<UUID, number>();
  if (nodes.length === 0) {
    return result;
  }

  const inDegreeMap = new Map<UUID, number>();
  for (const node of nodes) {
    inDegreeMap.set(node.id, 0);
  }

  for (const edge of edges) {
    if (inDegreeMap.has(edge.targetId)) {
      inDegreeMap.set(edge.targetId, (inDegreeMap.get(edge.targetId) ?? 0) + 1);
    }
  }

  let maxIn = 0;
  for (const inDegree of inDegreeMap.values()) {
    if (inDegree > maxIn) {
      maxIn = inDegree;
    }
  }

  for (const node of nodes) {
    const inDegree = inDegreeMap.get(node.id) ?? 0;
    const score = maxIn > 0 ? inDegree / maxIn : 0.5;
    const roundedScore = Math.round(score * 1000) / 1000;
    const importance = 1 / (1 + Math.exp(-(roundedScore + 1)));
    result.set(node.id, importance);
  }

  return result;
}
