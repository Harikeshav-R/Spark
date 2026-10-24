import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/contracts/errors";
import {
  FIXTURE_33_CONCEPTS,
  FIXTURE_34_EDGES,
} from "../../fixtures/ai.fixture";
import {
  calculateNodeImportance,
  type GraphNodeInput,
  topologicalSort,
  validateGraph,
} from "../../../src/server/core/index";
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function getCanonicalNodes(): GraphNodeInput[] {
  return FIXTURE_33_CONCEPTS.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ id, courseId, createdAt, ...node }) => ({ ...node }),
  );
}

describe("P2-A-01: DAG Validator and Cycle Detector", () => {
  it("passes validation and topologically sorts canonical 33/34 CS229 graph", async () => {
    const nodes = getCanonicalNodes();
    const edges = FIXTURE_34_EDGES.map(
      ([s, t]) => [s, t] as [string, string],
    );

    const isValid = await validateGraph(nodes, edges);
    expect(isValid).toBe(true);

    const sorted = topologicalSort(nodes, edges);
    expect(sorted).toHaveLength(33);
    expect(new Set(sorted)).toEqual(new Set(nodes.map((n) => n.label)));

    // Invariant: every prerequisite precedes dependent in sorted order
    const indexMap = new Map<string, number>(sorted.map((label, idx) => [label, idx]));
    for (const [source, target] of edges) {
      const sourceIdx = indexMap.get(source)!;
      const targetIdx = indexMap.get(target)!;
      expect(sourceIdx).toBeLessThan(targetIdx);
    }
  });

  it("detects injected cycle and rejects with 422 and cycle path details", async () => {
    const nodes = getCanonicalNodes();
    // Injected back-edge: Matrices -> Vectors (Vectors -> Matrices is already in canonical edges)
    const edges: [string, string][] = [
      ...FIXTURE_34_EDGES.map(([s, t]) => [s, t] as [string, string]),
      ["Matrices", "Vectors"],
    ];

    await expect(validateGraph(nodes, edges)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("Knowledge graph contains a cycle: Vectors -> Matrices -> Vectors");
      expect(appErr.cause).toEqual({
        cyclePath: ["Vectors", "Matrices", "Vectors"],
      });
      return true;
    });

    expect(() => topologicalSort(nodes, edges)).toThrow(AppError);
  });

  it("accepts valid structural variants: single edgeless, disconnected, converging diamond, 40 nodes", async () => {
    // Single edgeless
    const single: GraphNodeInput[] = [
      { label: "Alone", description: "Desc", category: "Cat", difficulty: 1 },
    ];
    await expect(validateGraph(single, [])).resolves.toBe(true);
    expect(topologicalSort(single, [])).toEqual(["Alone"]);

    // Disconnected components
    const disconnected: GraphNodeInput[] = [
      { label: "A1", description: "d", category: "c", difficulty: 1 },
      { label: "A2", description: "d", category: "c", difficulty: 2 },
      { label: "B1", description: "d", category: "c", difficulty: 3 },
    ];
    const disconnectedEdges: [string, string][] = [["A1", "A2"]];
    await expect(validateGraph(disconnected, disconnectedEdges)).resolves.toBe(true);
    const sortedDisc = topologicalSort(disconnected, disconnectedEdges);
    expect(sortedDisc.indexOf("A1")).toBeLessThan(sortedDisc.indexOf("A2"));

    // Converging diamond: A -> B, A -> C, B -> D, C -> D
    const diamondNodes: GraphNodeInput[] = [
      { label: "A", description: "d", category: "c", difficulty: 1 },
      { label: "B", description: "d", category: "c", difficulty: 2 },
      { label: "C", description: "d", category: "c", difficulty: 2 },
      { label: "D", description: "d", category: "c", difficulty: 3 },
    ];
    const diamondEdges: [string, string][] = [
      ["A", "B"],
      ["A", "C"],
      ["B", "D"],
      ["C", "D"],
    ];
    await expect(validateGraph(diamondNodes, diamondEdges)).resolves.toBe(true);
    const sortedDiamond = topologicalSort(diamondNodes, diamondEdges);
    expect(sortedDiamond.indexOf("A")).toBeLessThan(sortedDiamond.indexOf("B"));
    expect(sortedDiamond.indexOf("A")).toBeLessThan(sortedDiamond.indexOf("C"));
    expect(sortedDiamond.indexOf("B")).toBeLessThan(sortedDiamond.indexOf("D"));
    expect(sortedDiamond.indexOf("C")).toBeLessThan(sortedDiamond.indexOf("D"));

    // Exactly 40 nodes (upper bound)
    const fortyNodes: GraphNodeInput[] = Array.from({ length: 40 }, (_, i) => ({
      label: `Concept_${i + 1}`,
      description: `Description ${i + 1}`,
      category: "Stress",
      difficulty: ((i % 5) + 1),
    }));
    const chainEdges: [string, string][] = Array.from({ length: 39 }, (_, i) => [
      `Concept_${i + 1}`,
      `Concept_${i + 2}`,
    ]);
    await expect(validateGraph(fortyNodes, chainEdges)).resolves.toBe(true);
    expect(topologicalSort(fortyNodes, chainEdges)).toHaveLength(40);
  });

  it("rejects node count outside 1-40 with 422 UNPROCESSABLE_ENTITY", async () => {
    // 0 nodes
    await expect(validateGraph([], [])).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      return true;
    });

    // 41 nodes
    const fortyOneNodes: GraphNodeInput[] = Array.from({ length: 41 }, (_, i) => ({
      label: `Concept_${i + 1}`,
      description: `Description ${i + 1}`,
      category: "Overflow",
      difficulty: 1,
    }));
    await expect(validateGraph(fortyOneNodes, [])).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      return true;
    });
  });

  it("rejects duplicate labels, duplicate directed edges, self-edges, and missing endpoints with 422", async () => {
    const baseNodes: GraphNodeInput[] = [
      { label: "Alpha", description: "d", category: "c", difficulty: 1 },
      { label: "Beta", description: "d", category: "c", difficulty: 2 },
    ];

    // Duplicate label
    const dupNodes: GraphNodeInput[] = [
      ...baseNodes,
      { label: "Alpha", description: "different", category: "c", difficulty: 3 },
    ];
    await expect(validateGraph(dupNodes, [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("Duplicate concept label: Alpha");
      return true;
    });

    // Duplicate directed edges
    const dupEdges: [string, string][] = [
      ["Alpha", "Beta"],
      ["Alpha", "Beta"],
    ];
    await expect(validateGraph(baseNodes, dupEdges)).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("Duplicate edge");
      return true;
    });

    // Self edge
    const selfEdge: [string, string][] = [["Alpha", "Alpha"]];
    await expect(validateGraph(baseNodes, selfEdge)).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("Self-edge detected");
      return true;
    });

    // Missing source endpoint
    const missingSource: [string, string][] = [["Nonexistent", "Beta"]];
    await expect(validateGraph(baseNodes, missingSource)).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("Edge source not found in concept nodes: Nonexistent");
      return true;
    });

    // Missing target endpoint
    const missingTarget: [string, string][] = [["Alpha", "Nonexistent"]];
    await expect(validateGraph(baseNodes, missingTarget)).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.code).toBe("UNPROCESSABLE_ENTITY");
      expect(appErr.message).toContain("Edge target not found in concept nodes: Nonexistent");
      return true;
    });
  });

  it("rejects malformed field types, out-of-range difficulty, and nonfinite coordinates with 400", async () => {
    // Difficulty 0 (below min 1)
    const badDiff0: unknown[] = [
      { label: "Bad", description: "d", category: "c", difficulty: 0 },
    ];
    await expect(validateGraph(badDiff0 as GraphNodeInput[], [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Difficulty 6 (above max 5)
    const badDiff6: unknown[] = [
      { label: "Bad", description: "d", category: "c", difficulty: 6 },
    ];
    await expect(validateGraph(badDiff6 as GraphNodeInput[], [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Fractional difficulty
    const badDiffFloat: unknown[] = [
      { label: "Bad", description: "d", category: "c", difficulty: 2.5 },
    ];
    await expect(validateGraph(badDiffFloat as GraphNodeInput[], [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Overlong label (>255)
    const longLabel: GraphNodeInput[] = [
      { label: "x".repeat(256), description: "d", category: "c", difficulty: 1 },
    ];
    await expect(validateGraph(longLabel, [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Overlong category (>100)
    const longCategory: GraphNodeInput[] = [
      { label: "Normal", description: "d", category: "c".repeat(101), difficulty: 1 },
    ];
    await expect(validateGraph(longCategory, [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Nonfinite coordinate (NaN / Infinity)
    const nanCoord: GraphNodeInput[] = [
      { label: "Normal", description: "d", category: "c", difficulty: 1, x: Number.NaN },
    ];
    await expect(validateGraph(nanCoord, [])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });

    // Malformed edge tuple
    const validNode: GraphNodeInput[] = [
      { label: "Node1", description: "d", category: "c", difficulty: 1 },
    ];
    const malformedEdge: unknown[] = [["Node1"]];
    await expect(validateGraph(validNode, malformedEdge as [string, string][])).rejects.toSatisfy((err: unknown) => {
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      return true;
    });
  });

  it("preserves literal punctuation and case distinctions without mutating inputs", async () => {
    const rawNodes: GraphNodeInput[] = [
      { label: "bayes' theorem", description: "lower", category: "prob", difficulty: 1 },
      { label: "Bayes' Theorem", description: "title", category: "prob", difficulty: 2 },
    ];
    const rawEdges: [string, string][] = [["bayes' theorem", "Bayes' Theorem"]];

    const nodesCopy = JSON.parse(JSON.stringify(rawNodes));
    const edgesCopy = JSON.parse(JSON.stringify(rawEdges));

    await expect(validateGraph(rawNodes, rawEdges)).resolves.toBe(true);

    expect(rawNodes).toEqual(nodesCopy);
    expect(rawEdges).toEqual(edgesCopy);
  });
});

describe("P2-A-01: Importance Calculator", () => {
  it("calculates incoming-prerequisite importance according to mathematical formula", () => {
    // Input: A -> D, B -> D, C -> D, A -> B
    // inDegrees: A=0, B=1, C=0, D=3
    // maxIn = 3
    // A: 0/3 = 0 -> round(0, 3) = 0 -> sigmoid(0 + 1) = sigmoid(1)
    // B: 1/3 = 0.33333 -> round(0.33333, 3) = 0.333 -> sigmoid(0.333 + 1) = sigmoid(1.333)
    // C: 0/3 = 0 -> round(0, 3) = 0 -> sigmoid(0 + 1) = sigmoid(1)
    // D: 3/3 = 1 -> round(1, 3) = 1 -> sigmoid(1 + 1) = sigmoid(2)
    const nodeA = { id: "00000000-0000-0000-0000-00000000000a" as const };
    const nodeB = { id: "00000000-0000-0000-0000-00000000000b" as const };
    const nodeC = { id: "00000000-0000-0000-0000-00000000000c" as const };
    const nodeD = { id: "00000000-0000-0000-0000-00000000000d" as const };

    const nodes = [nodeA, nodeB, nodeC, nodeD];
    const edges = [
      { sourceId: nodeA.id, targetId: nodeD.id },
      { sourceId: nodeB.id, targetId: nodeD.id },
      { sourceId: nodeC.id, targetId: nodeD.id },
      { sourceId: nodeA.id, targetId: nodeB.id },
    ];

    const importanceMap = calculateNodeImportance(nodes, edges);

    expect(importanceMap.size).toBe(4);
    expect(importanceMap.get(nodeA.id)).toBeCloseTo(sigmoid(1), 6);
    expect(importanceMap.get(nodeB.id)).toBeCloseTo(sigmoid(1.333), 6);
    expect(importanceMap.get(nodeC.id)).toBeCloseTo(sigmoid(1), 6);
    expect(importanceMap.get(nodeD.id)).toBeCloseTo(sigmoid(2), 6);
  });

  it("handles edgeless topology with sigmoid(1.5) and empty topology with empty map", () => {
    // Empty topology -> empty map
    const emptyMap = calculateNodeImportance([], []);
    expect(emptyMap.size).toBe(0);

    // Edgeless topology -> maxIn = 0 -> score = 0.5 -> sigmoid(1.5) for all
    const node1 = { id: "11111111-1111-1111-1111-111111111111" as const };
    const node2 = { id: "22222222-2222-2222-2222-222222222222" as const };
    const edgelessMap = calculateNodeImportance([node1, node2], []);
    expect(edgelessMap.size).toBe(2);
    expect(edgelessMap.get(node1.id)).toBeCloseTo(sigmoid(1.5), 6);
    expect(edgelessMap.get(node2.id)).toBeCloseTo(sigmoid(1.5), 6);
  });
});
