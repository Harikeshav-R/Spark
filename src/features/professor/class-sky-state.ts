import type { GraphData, GraphNode } from "../graph/d3-force-layout";
import type { ClassSkySnapshot, CourseEffortDTO } from "../../contracts/game";
import { confidenceToBand } from "../../contracts/mastery";

export type EffortSortKey =
  | "name"
  | "enrolledAt"
  | "xp"
  | "averageConfidence"
  | "effortPercentile"
  | "masteryPercentile";

export type EffortRow = CourseEffortDTO & {
  effortPercentile: number;
  masteryPercentile: number;
};

/**
 * Builds a Class Sky GraphData from existing course graph and Class Sky cohort snapshot.
 * Replaces node confidence and band with cohort averages.
 * If totalStudents === 0, nodes have undefined confidence/band so stars indicate unavailable cohort mastery.
 * Throws an Error if graph and snapshot have non-matching concept ID sets.
 */
export function buildClassSkyGraph(graph: GraphData, snapshot: ClassSkySnapshot): GraphData {
  if (graph.nodes.length === 0 && snapshot.concepts.length === 0) {
    return { nodes: [], edges: [] };
  }

  if (graph.nodes.length !== snapshot.concepts.length) {
    throw new Error(
      `Class Sky concept count (${snapshot.concepts.length}) does not match course graph node count (${graph.nodes.length})`,
    );
  }

  const conceptMap = new Map<string, (typeof snapshot.concepts)[number]>();
  for (const concept of snapshot.concepts) {
    conceptMap.set(concept.conceptId, concept);
  }

  for (const node of graph.nodes) {
    if (!conceptMap.has(node.id)) {
      throw new Error(`Graph node concept '${node.id}' not found in Class Sky snapshot`);
    }
  }

  const updatedNodes: GraphNode[] = graph.nodes.map((node) => {
    const cohortConcept = conceptMap.get(node.id)!;
    if (snapshot.totalStudents === 0) {
      return {
        ...node,
        confidence: undefined,
        band: undefined,
      };
    }

    const averageConfidence = cohortConcept.averageConfidence;
    return {
      ...node,
      confidence: averageConfidence,
      band: confidenceToBand(averageConfidence),
    };
  });

  return {
    nodes: updatedNodes,
    edges: graph.edges,
  };
}

/**
 * Computes effort and mastery percentiles over a returned cohort roster.
 * round(100 * countStrictlyLower / max(1, N - 1)); ties share rank and N=1 gives zero.
 * Uses sorted values and first-index maps, preserving server flag.
 */
export function buildEffortRows(effort: readonly CourseEffortDTO[]): EffortRow[] {
  if (effort.length === 0) {
    return [];
  }

  const n = effort.length;
  const denominator = Math.max(1, n - 1);

  const computePercentileMap = (values: number[]): Map<number, number> => {
    if (n <= 1) {
      return new Map(values.map((v) => [v, 0]));
    }
    const sorted = values.toSorted((a, b) => a - b);
    const firstIndexMap = new Map<number, number>();
    for (let i = 0; i < sorted.length; i += 1) {
      const val = sorted[i]!;
      if (!firstIndexMap.has(val)) {
        firstIndexMap.set(val, i);
      }
    }

    const percentileMap = new Map<number, number>();
    for (const [val, firstIndex] of firstIndexMap.entries()) {
      percentileMap.set(val, Math.round((100 * firstIndex) / denominator));
    }
    return percentileMap;
  };

  const xpPercentiles = computePercentileMap(effort.map((e) => e.xp));
  const masteryPercentiles = computePercentileMap(effort.map((e) => e.averageConfidence));

  return effort.map((row) => ({
    ...row,
    effortPercentile: xpPercentiles.get(row.xp) ?? 0,
    masteryPercentile: masteryPercentiles.get(row.averageConfidence) ?? 0,
  }));
}

/**
 * Sorts effort rows by key and direction.
 * Ties are broken deterministically by name ascending, then studentId ascending.
 */
export function sortEffortRows(
  rows: readonly EffortRow[],
  key: EffortSortKey,
  direction: "asc" | "desc",
): EffortRow[] {
  const dirFactor = direction === "asc" ? 1 : -1;

  return rows.toSorted((a, b) => {
    const cmp =
      key === "name"
        ? a.name.localeCompare(b.name, "en")
        : key === "enrolledAt"
          ? a.enrolledAt.localeCompare(b.enrolledAt)
          : a[key] - b[key];

    if (cmp !== 0) {
      return cmp * dirFactor;
    }

    // Stable tie-breakers: name ascending, then studentId ascending
    const nameCmp = a.name.localeCompare(b.name, "en");
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return a.studentId.localeCompare(b.studentId);
  });
}
