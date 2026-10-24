import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { CommitSection } from "../../../src/features/courses/syllabus-upload";
import { GraphPreview } from "../../../src/features/courses/graph-preview";
import {
  fixturePrerequisiteGraph,
  FIXTURE_33_CONCEPTS,
} from "../../../src/server/ai/fixtures/prerequisite-graph";

describe("Lane D: Syllabus Upload & Graph Preview UI (P2-D-01)", () => {
  const fixtureGraph = fixturePrerequisiteGraph();


  describe("GraphPreview component", () => {
    it("renders all 33 concept labels and summary stats from fixture data", () => {
      const html = renderToString(
        React.createElement(GraphPreview, {
          courseId: "11111111-1111-4111-8111-111111111111",
          totalPages: 11,
          processedPages: 10,
          truncated: true,
          concepts: fixtureGraph.concepts,
          edges: fixtureGraph.edges,
        })
      );

      // Verify all 33 concept labels from fixture are present (handling HTML entity escaping)
      for (const concept of FIXTURE_33_CONCEPTS) {
        const escapedLabel = concept.label.replace(/'/g, "&#x27;");
        expect(html).toContain(escapedLabel);
      }

      // Verify summary stats
      expect(html).toContain("33 concepts extracted");
      expect(html).toContain("34 prerequisite edges");
    });

    it("renders prerequisite edge list with arrow notation", () => {
      const html = renderToString(
        React.createElement(GraphPreview, {
          courseId: "11111111-1111-4111-8111-111111111111",
          totalPages: 8,
          processedPages: 8,
          truncated: false,
          concepts: fixtureGraph.concepts,
          edges: [["Vectors", "Matrices"]],
        })
      );

      expect(html).toContain("Vectors");
      expect(html).toContain("Matrices");
      expect(html).toContain("→");
      expect(html).toContain('aria-label="is a prerequisite for"');
    });

    it("renders truncation warning when truncated is true", () => {
      const html = renderToString(
        React.createElement(GraphPreview, {
          courseId: "11111111-1111-4111-8111-111111111111",
          totalPages: 11,
          processedPages: 10,
          truncated: true,
          concepts: fixtureGraph.concepts,
          edges: fixtureGraph.edges,
        })
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain("Truncated extraction");
      expect(html).toContain("11 pages");
      expect(html).toContain("first 10");
    });

    it("does not render truncation warning when truncated is false", () => {
      const html = renderToString(
        React.createElement(GraphPreview, {
          courseId: "11111111-1111-4111-8111-111111111111",
          totalPages: 8,
          processedPages: 8,
          truncated: false,
          concepts: fixtureGraph.concepts,
          edges: fixtureGraph.edges,
        })
      );

      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain("Truncated extraction");
    });

    it("renders category groupings with headings", () => {
      const html = renderToString(
        React.createElement(GraphPreview, {
          courseId: "11111111-1111-4111-8111-111111111111",
          totalPages: 10,
          processedPages: 10,
          truncated: false,
          concepts: fixtureGraph.concepts,
          edges: fixtureGraph.edges,
        })
      );

      expect(html).toContain("Linear Algebra");
      expect(html).toContain("Calculus");
      expect(html).toContain("Probability");
      expect(html).toContain("Neural Networks");
    });

    it("renders difficulty indicators with accessible aria-label", () => {
      const html = renderToString(
        React.createElement(GraphPreview, {
          courseId: "11111111-1111-4111-8111-111111111111",
          totalPages: 10,
          processedPages: 10,
          truncated: false,
          concepts: [
            {
              label: "Test Concept",
              description: "A description",
              category: "Testing",
              difficulty: 3,
            },
          ],
          edges: [],
        })
      );

      expect(html).toContain('aria-label="Difficulty 3 of 5"');
      expect(html).toContain("●●●○○");
    });
  });

  describe("CommitSection component", () => {
    it("renders commit button with concept count when idle", () => {
      const html = renderToString(
        React.createElement(CommitSection, {
          conceptCount: 33,
          isCommitting: false,
          onCommit: () => {},
        })
      );

      expect(html).toContain("Confirm graph (33 concepts)");
      expect(html).not.toContain("Committing graph…");
    });

    it("renders loading state when isCommitting is true", () => {
      const html = renderToString(
        React.createElement(CommitSection, {
          conceptCount: 33,
          isCommitting: true,
          onCommit: () => {},
        })
      );

      expect(html).toContain("Committing graph…");
      expect(html).toContain('aria-busy="true"');
    });
  });

});
