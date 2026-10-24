import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  computeGraphLayout,
  getPrerequisitePath,
  type GraphData,
  type GraphNode,
} from "../../../src/features/graph/d3-force-layout";
import { StarVessel } from "../../../src/features/graph/star-vessel";
import { KnowledgeGraph } from "../../../src/features/graph/knowledge-graph";
import {
  FIXTURE_33_CONCEPTS,
  fixturePrerequisiteGraph,
} from "../../../src/server/ai/fixtures/prerequisite-graph";

describe("Lane D: Interactive D3-Force Knowledge Graph (P2-D-02)", () => {
  describe("computeGraphLayout & getPrerequisitePath", () => {
    it("computes topological levels for a diamond with multiple roots and isolated node", () => {
      // Diamond: A->B, A->C, B->D, C->D; plus E->D; plus isolated F
      const graph: GraphData = {
        nodes: [
          { id: "A", label: "A", description: "Root A", category: "Test", difficulty: 1 },
          { id: "B", label: "B", description: "Mid B", category: "Test", difficulty: 2 },
          { id: "C", label: "C", description: "Mid C", category: "Test", difficulty: 2 },
          { id: "D", label: "D", description: "Sink D", category: "Test", difficulty: 3 },
          { id: "E", label: "E", description: "Root E", category: "Test", difficulty: 1 },
          { id: "F", label: "F", description: "Isolated F", category: "Test", difficulty: 1 },
        ],
        edges: [
          { id: "e1", source: "A", target: "B", relationship: "prerequisite" },
          { id: "e2", source: "A", target: "C", relationship: "prerequisite" },
          { id: "e3", source: "B", target: "D", relationship: "prerequisite" },
          { id: "e4", source: "C", target: "D", relationship: "prerequisite" },
          { id: "e5", source: "E", target: "D", relationship: "prerequisite" },
        ],
      };

      // Deep freeze graph to verify immutability
      Object.freeze(graph.nodes);
      graph.nodes.forEach((n) => Object.freeze(n));
      Object.freeze(graph.edges);
      graph.edges.forEach((e) => Object.freeze(e));

      const layout = computeGraphLayout(graph, { width: 800, reducedMotion: false });

      const nodeLevelMap = new Map(layout.nodes.map((n) => [n.id, n.level]));
      expect(nodeLevelMap.get("A")).toBe(0);
      expect(nodeLevelMap.get("E")).toBe(0);
      expect(nodeLevelMap.get("F")).toBe(0);
      expect(nodeLevelMap.get("B")).toBe(1);
      expect(nodeLevelMap.get("C")).toBe(1);
      expect(nodeLevelMap.get("D")).toBe(2);

      // Verify finite coordinates
      for (const node of layout.nodes) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
      }

      // Edge endpoints remain original strings
      for (const edge of layout.edges) {
        expect(typeof edge.source).toBe("string");
        expect(typeof edge.target).toBe("string");
      }

      // Reduced motion layout produces initial grid levels
      const reducedLayout = computeGraphLayout(graph, { width: 800, reducedMotion: true });
      expect(reducedLayout.nodes.length).toBe(6);
      const reducedD = reducedLayout.nodes.find((n) => n.id === "D")!;
      expect(reducedD.y).toBe(2 * 120);

      // Normal layout simulation diffs from reduced layout
      const normalD = layout.nodes.find((n) => n.id === "D")!;
      // Normal layout runs 300 force ticks, so positions differ from pure initial grid
      expect(normalD.x !== reducedD.x || normalD.y !== reducedD.y).toBe(true);
    });

    it("handles empty, single-node, and exactly 40-node graphs", () => {
      // Empty graph
      const emptyLayout = computeGraphLayout(
        { nodes: [], edges: [] },
        { width: 800, reducedMotion: false }
      );
      expect(emptyLayout.nodes).toEqual([]);
      expect(emptyLayout.edges).toEqual([]);

      // Single node graph
      const singleLayout = computeGraphLayout(
        {
          nodes: [{ id: "n1", label: "Single", description: "", category: "C", difficulty: 1 }],
          edges: [],
        },
        { width: 800, reducedMotion: false }
      );
      expect(singleLayout.nodes.length).toBe(1);
      expect(singleLayout.nodes[0].level).toBe(0);

      // Exactly 40 nodes (chain)
      const nodes40: GraphNode[] = Array.from({ length: 40 }, (_, i) => ({
        id: `node-${i}`,
        label: `N${i}`,
        description: "",
        category: "Test",
        difficulty: 1,
      }));
      const edges40 = Array.from({ length: 39 }, (_, i) => ({
        id: `edge-${i}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        relationship: "prerequisite" as const,
      }));
      const layout40 = computeGraphLayout(
        { nodes: nodes40, edges: edges40 },
        { width: 1000, reducedMotion: false }
      );
      expect(layout40.nodes.length).toBe(40);
      expect(layout40.nodes[39].level).toBe(39);
    });

    it("rejects graphs exceeding 40 nodes, cycles, self-edges, duplicate IDs, and missing endpoints", () => {
      // > 40 nodes
      const nodes41: GraphNode[] = Array.from({ length: 41 }, (_, i) => ({
        id: `node-${i}`,
        label: `N${i}`,
        description: "",
        category: "Test",
        difficulty: 1,
      }));
      expect(() =>
        computeGraphLayout({ nodes: nodes41, edges: [] }, { width: 800, reducedMotion: false })
      ).toThrow(/^Invalid knowledge graph: node count exceeds maximum of 40/);

      // Duplicate node ID
      expect(() =>
        computeGraphLayout(
          {
            nodes: [
              { id: "dup", label: "A", description: "", category: "C", difficulty: 1 },
              { id: "dup", label: "B", description: "", category: "C", difficulty: 1 },
            ],
            edges: [],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: duplicate node ID/);

      // Self-edge
      expect(() =>
        computeGraphLayout(
          {
            nodes: [{ id: "self", label: "A", description: "", category: "C", difficulty: 1 }],
            edges: [{ id: "e1", source: "self", target: "self", relationship: "prerequisite" }],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: self-edge detected/);

      // Duplicate directed edge
      expect(() =>
        computeGraphLayout(
          {
            nodes: [
              { id: "a", label: "A", description: "", category: "C", difficulty: 1 },
              { id: "b", label: "B", description: "", category: "C", difficulty: 1 },
            ],
            edges: [
              { id: "e1", source: "a", target: "b", relationship: "prerequisite" },
              { id: "e2", source: "a", target: "b", relationship: "prerequisite" },
            ],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: duplicate directed edge/);

      // Missing endpoint
      expect(() =>
        computeGraphLayout(
          {
            nodes: [{ id: "a", label: "A", description: "", category: "C", difficulty: 1 }],
            edges: [{ id: "e1", source: "a", target: "missing", relationship: "prerequisite" }],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: edge "e1" references missing endpoint/);

      // Cycle
      expect(() =>
        computeGraphLayout(
          {
            nodes: [
              { id: "a", label: "A", description: "", category: "C", difficulty: 1 },
              { id: "b", label: "B", description: "", category: "C", difficulty: 1 },
            ],
            edges: [
              { id: "e1", source: "a", target: "b", relationship: "prerequisite" },
              { id: "e2", source: "b", target: "a", relationship: "prerequisite" },
            ],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: cycle detected/);
    });

    it("rejects nonfinite or out-of-range confidence", () => {
      expect(() =>
        computeGraphLayout(
          {
            nodes: [
              { id: "a", label: "A", description: "", category: "C", difficulty: 1, confidence: 1.5 },
            ],
            edges: [],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: node "a" has invalid confidence/);

      expect(() =>
        computeGraphLayout(
          {
            nodes: [
              { id: "a", label: "A", description: "", category: "C", difficulty: 1, confidence: NaN },
            ],
            edges: [],
          },
          { width: 800, reducedMotion: false }
        )
      ).toThrow(/^Invalid knowledge graph: node "a" has invalid confidence/);
    });

    it("computes transitive prerequisite path including diamonds and excluding unrelated nodes", () => {
      // A->B->D, A->C->D, E->D, F (isolated), D->G (outgoing)
      const graph: GraphData = {
        nodes: [
          { id: "A", label: "A", description: "", category: "C", difficulty: 1 },
          { id: "B", label: "B", description: "", category: "C", difficulty: 2 },
          { id: "C", label: "C", description: "", category: "C", difficulty: 2 },
          { id: "D", label: "D", description: "", category: "C", difficulty: 3 },
          { id: "E", label: "E", description: "", category: "C", difficulty: 1 },
          { id: "F", label: "F", description: "", category: "C", difficulty: 1 },
          { id: "G", label: "G", description: "", category: "C", difficulty: 4 },
        ],
        edges: [
          { id: "e_ab", source: "A", target: "B", relationship: "prerequisite" },
          { id: "e_ac", source: "A", target: "C", relationship: "prerequisite" },
          { id: "e_bd", source: "B", target: "D", relationship: "prerequisite" },
          { id: "e_cd", source: "C", target: "D", relationship: "prerequisite" },
          { id: "e_ed", source: "E", target: "D", relationship: "prerequisite" },
          { id: "e_dg", source: "D", target: "G", relationship: "prerequisite" },
        ],
      };

      const pathForD = getPrerequisitePath(graph, "D");
      expect(Array.from(pathForD.nodeIds).sort()).toEqual(["A", "B", "C", "D", "E"]);
      expect(Array.from(pathForD.edgeIds).sort()).toEqual([
        "e_ab",
        "e_ac",
        "e_bd",
        "e_cd",
        "e_ed",
      ]);
      expect(pathForD.nodeIds.has("F")).toBe(false);
      expect(pathForD.nodeIds.has("G")).toBe(false);
      expect(pathForD.edgeIds.has("e_dg")).toBe(false);

      // Root selection only returns the root itself
      const pathForA = getPrerequisitePath(graph, "A");
      expect(Array.from(pathForA.nodeIds)).toEqual(["A"]);
      expect(pathForA.edgeIds.size).toBe(0);

      // Unknown node returns empty sets
      const pathUnknown = getPrerequisitePath(graph, "NON_EXISTENT");
      expect(pathUnknown.nodeIds.size).toBe(0);
      expect(pathUnknown.edgeIds.size).toBe(0);
    });
  });

  describe("StarVessel component", () => {
    it("renders vertical clip rectangle proportional to confidence", () => {
      const testCases = [
        { c: 0.0, expectedHeight: 0, expectedY: 24, expectedText: "Unassessed (0%)" },
        { c: 0.2, expectedHeight: 10, expectedY: 14, expectedText: "Dim / Needs practice (20%)" },
        { c: 0.4, expectedHeight: 19, expectedY: 5, expectedText: "Lit / Developing (40%)" },
        { c: 0.7, expectedHeight: 34, expectedY: -10, expectedText: "Shining / Mastered (70%)" },
        { c: 1.0, expectedHeight: 48, expectedY: -24, expectedText: "Shining / Mastered (100%)" },
      ];

      for (const { c, expectedHeight, expectedY, expectedText } of testCases) {
        const node: GraphNode = {
          id: `node-${c}`,
          label: `Concept ${c}`,
          description: "Test description",
          category: "Testing",
          difficulty: 2,
          confidence: c,
        };

        const html = renderToString(
          React.createElement(StarVessel, {
            node,
            x: 100,
            y: 100,
            selected: false,
            dimmed: false,
            onSelect: () => {},
          })
        );

        expect(html).toContain(`height="${expectedHeight}"`);
        expect(html).toContain(`y="${expectedY}"`);
        expect(html).toContain(expectedText);
      }
    });

    it("handles boundary confidence values and contradictory band overrides", () => {
      // 0.3999 is red (< 0.4)
      const redNode: GraphNode = {
        id: "red-bound",
        label: "Red Boundary",
        description: "",
        category: "Test",
        difficulty: 1,
        confidence: 0.3999,
        band: "green", // Contradictory band in input must be ignored in favor of confidenceToBand(c)
      };
      const redHtml = renderToString(
        React.createElement(StarVessel, {
          node: redNode,
          x: 50,
          y: 50,
          selected: false,
          dimmed: false,
          onSelect: () => {},
        })
      );
      expect(redHtml).toContain("Dim / Needs practice (40%)");
      expect(redHtml).toContain('stroke-dasharray="2 3"'); // dotted outline for red

      // 0.6999 is yellow (< 0.7)
      const yellowNode: GraphNode = {
        id: "yellow-bound",
        label: "Yellow Boundary",
        description: "",
        category: "Test",
        difficulty: 1,
        confidence: 0.6999,
      };
      const yellowHtml = renderToString(
        React.createElement(StarVessel, {
          node: yellowNode,
          x: 50,
          y: 50,
          selected: false,
          dimmed: false,
          onSelect: () => {},
        })
      );
      expect(yellowHtml).toContain("Lit / Developing (70%)");

      // Missing confidence: neutral empty vessel and "Mastery unavailable"
      const unassessedNode: GraphNode = {
        id: "no-conf",
        label: "Unassessed Node",
        description: "",
        category: "Test",
        difficulty: 1,
      };
      const unassessedHtml = renderToString(
        React.createElement(StarVessel, {
          node: unassessedNode,
          x: 50,
          y: 50,
          selected: false,
          dimmed: false,
          onSelect: () => {},
        })
      );
      expect(unassessedHtml).toContain("Mastery unavailable");
      expect(unassessedHtml).toContain('height="0"');
    });

    it("ensures two star vessel instances produce distinct unique clip IDs", () => {
      const nodeA: GraphNode = {
        id: "node-a",
        label: "A",
        description: "",
        category: "Test",
        difficulty: 1,
        confidence: 0.5,
      };
      const nodeB: GraphNode = {
        id: "node-b",
        label: "B",
        description: "",
        category: "Test",
        difficulty: 1,
        confidence: 0.5,
      };

      const html = renderToString(
        React.createElement("svg", null, [
          React.createElement(StarVessel, {
            key: "a",
            node: nodeA,
            x: 0,
            y: 0,
            selected: false,
            dimmed: false,
            onSelect: () => {},
          }),
          React.createElement(StarVessel, {
            key: "b",
            node: nodeB,
            x: 50,
            y: 50,
            selected: false,
            dimmed: false,
            onSelect: () => {},
          }),
        ])
      );

      // Check clipPath IDs
      const clipMatches = html.match(/id="(star-clip-[^"]+)"/g);
      expect(clipMatches).not.toBeNull();
      expect(clipMatches!.length).toBe(2);
      expect(clipMatches![0]).not.toEqual(clipMatches![1]);
    });
  });

  describe("KnowledgeGraph component (SSR & Error states)", () => {
    it("renders empty state message when graph has zero nodes", () => {
      const html = renderToString(
        React.createElement(KnowledgeGraph, {
          graph: { nodes: [], edges: [] },
        })
      );
      expect(html).toContain("No concepts to display.");
    });

    it("renders alert with specific error reason for invalid graphs", () => {
      const cyclicGraph: GraphData = {
        nodes: [
          { id: "x", label: "X", description: "", category: "C", difficulty: 1 },
          { id: "y", label: "Y", description: "", category: "C", difficulty: 1 },
        ],
        edges: [
          { id: "e1", source: "x", target: "y", relationship: "prerequisite" },
          { id: "e2", source: "y", target: "x", relationship: "prerequisite" },
        ],
      };

      const html = renderToString(
        React.createElement(KnowledgeGraph, { graph: cyclicGraph })
      );
      expect(html).toContain("Unable to display this knowledge graph.");
      expect(html).toContain("cycle detected");
    });

    it("renders SSR preparation state with accessible concept list for valid graphs", () => {
      const graph: GraphData = {
        nodes: [
          {
            id: "vectors",
            label: "Vectors",
            description: "Mathematical vector spaces",
            category: "Linear Algebra",
            difficulty: 1,
          },
        ],
        edges: [],
      };

      const html = renderToString(React.createElement(KnowledgeGraph, { graph }));
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("Preparing knowledge graph…");
      expect(html).toContain("Vectors");
      expect(html).toContain("Mathematical vector spaces");
    });
  });

  describe("Canonical CS229 Fixture Verification", () => {
    it("verifies 33 nodes, 34 edges, and upstream prerequisite path for Backpropagation", () => {
      const fixture = fixturePrerequisiteGraph();
      expect(fixture.concepts.length).toBe(33);
      expect(fixture.edges.length).toBe(34);

      const graph: GraphData = {
        nodes: fixture.concepts.map((c) => ({
          id: `preview:${c.label}`,
          label: c.label,
          description: c.description,
          category: c.category,
          difficulty: c.difficulty,
        })),
        edges: fixture.edges.map(([s, t], i) => ({
          id: `edge:${i}`,
          source: `preview:${s}`,
          target: `preview:${t}`,
          relationship: "prerequisite" as const,
        })),
      };

      const layout = computeGraphLayout(graph, { width: 1200, reducedMotion: false });
      expect(layout.nodes.length).toBe(33);
      expect(layout.edges.length).toBe(34);

      // Verify all 33 concept IDs exist in layout
      for (const concept of FIXTURE_33_CONCEPTS) {
        expect(layout.nodes.some((n) => n.id === `preview:${concept.label}`)).toBe(true);
      }

      // Check Backpropagation upstream prerequisite selection
      const backpropId = "preview:Backpropagation";
      const backpropPath = getPrerequisitePath(graph, backpropId);

      // Ancestors of Backpropagation must include its direct prerequisites:
      // Chain Rule, Forward Pass, Gradients, and their ancestors
      expect(backpropPath.nodeIds.has(backpropId)).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Chain Rule")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Forward Pass")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Gradients")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Derivatives")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Partial Derivatives")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Activation Functions")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Layers")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Perceptron")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Matrix Multiplication")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Matrices")).toBe(true);
      expect(backpropPath.nodeIds.has("preview:Vectors")).toBe(true);

      // Dependents of Backpropagation must NOT be included:
      // In FIXTURE_34_EDGES, Backpropagation -> Computational Graphs, Backpropagation -> Weight Updates
      expect(backpropPath.nodeIds.has("preview:Computational Graphs")).toBe(false);
      expect(backpropPath.nodeIds.has("preview:Weight Updates")).toBe(false);
    });
  });
});
