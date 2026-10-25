import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import ConceptLearningPage from "@/app/student/[studentId]/concepts/[conceptId]/page";
import { LearningFeature } from "@/features/learning/learning-feature";

// Mock next/navigation notFound
const mockNotFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
}));

describe("P5-D-01: Student Concept Learning & Quiz Route Shell Mounting", () => {
  const studentId: UUID = "11111111-1111-4111-8111-111111111111";
  const conceptId: UUID = "22222222-2222-4222-8222-222222222222";
  const courseId: UUID = "33333333-3333-4333-8333-333333333333";

  describe("Route parameter validation & 404 invariant", () => {
    it("invokes notFound() when conceptId is not a valid UUID", async () => {
      mockNotFound.mockClear();

      await expect(
        ConceptLearningPage({
          params: Promise.resolve({
            studentId,
            conceptId: "invalid-concept-id",
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it("invokes notFound() when studentId is not a valid UUID", async () => {
      mockNotFound.mockClear();

      await expect(
        ConceptLearningPage({
          params: Promise.resolve({
            studentId: "invalid-student-id",
            conceptId,
          }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });
  });

  describe("Route shell, breadcrumbs & layout mounting", () => {
    it("renders concept learning page with breadcrumb navigation", async () => {
      const page = await ConceptLearningPage({
        params: Promise.resolve({
          studentId,
          conceptId,
        }),
        searchParams: Promise.resolve({
          courseId,
          conceptLabel: "Backpropagation",
          category: "Deep Learning",
          difficulty: "4",
        }),
      });

      const html = renderToString(page);

      // Verify breadcrumbs
      expect(html).toContain("Student workspace");
      expect(html).toContain(`/student/${studentId}?courseId=${courseId}`);
      expect(html).toContain("Backpropagation");
      expect(html).toContain('aria-current="page"');
      // Verify AppShell title and workspace
      expect(html).toContain("Backpropagation");
      expect(html).toContain("Student workspace");
      expect(html).toContain("Deep Learning");
      expect(html).toContain("Difficulty: 4 / 5");
    });

    it("uses default concept label when search params are omitted", async () => {
      const page = await ConceptLearningPage({
        params: Promise.resolve({
          studentId,
          conceptId,
        }),
        searchParams: Promise.resolve({}),
      });

      const html = renderToString(page);

      expect(html).toContain("Concept Learning &amp; Quiz");
      expect(html).toContain("Concept learning");
      expect(html).toContain(`/student/${studentId}`);
    });
  });

  describe("LearningFeature mounting: learning guide and quiz widget", () => {
    it("renders both the learning guide and the practice quiz widget", async () => {
      const page = await ConceptLearningPage({
        params: Promise.resolve({
          studentId,
          conceptId,
        }),
        searchParams: Promise.resolve({
          conceptLabel: "Computational Graphs",
        }),
      });

      const html = renderToString(page);

      // Verify LearningFeature container exists
      expect(html).toContain('data-testid="learning-feature"');

      // Verify tab navigation elements
      expect(html).toContain('role="tablist"');
      expect(html).toContain("Learning Guide");
      expect(html).toContain("Practice Quiz");
      expect(html).toContain("Academic Resources");

      // Verify learning guide panel content
      expect(html).toContain('data-testid="learning-guide-panel"');
      expect(html).toContain("Comprehensive Learning Guide");
      expect(html).toContain("Concept Overview &amp; Intuition");
      expect(html).toContain("Key Principles &amp; Formulation");

      // Verify practice quiz widget panel content
      expect(html).toContain('data-testid="quiz-widget-panel"');
      expect(html).toContain("Concept Practice Quiz");
      expect(html).toContain("Q1.");
      expect(html).toContain("Q2.");
      expect(html).toContain("Q3.");
      expect(html).toContain("Q4.");
      expect(html).toContain("Q5.");
      expect(html).toContain("Submit Quiz &amp; Record Mastery");
    });

    it("renders questions with accessible radio options", () => {
      const component = React.createElement(LearningFeature, {
        studentId,
        conceptId,
        initialConcept: {
          id: conceptId,
          courseId,
          label: "Chain Rule",
          description: "Calculus foundation for backpropagation.",
          category: "Mathematics",
          difficulty: 2,
          createdAt: new Date().toISOString(),
        },
      });

      const html = renderToString(component);

      expect(html).toContain("Chain Rule");
      expect(html).toContain("Mathematics");
      expect(html).toContain("Difficulty: 2 / 5");

      // Verify option labels A, B, C, D
      expect(html).toContain("A.");
      expect(html).toContain("B.");
      expect(html).toContain("C.");
      expect(html).toContain("D.");
    });
  });

  describe("Custom content and offline fixture resilience", () => {
    it("renders custom learning guide content when provided", () => {
      const customContent = "# Custom Title\n\nCustom explanation of the topic.";
      const component = React.createElement(LearningFeature, {
        studentId,
        conceptId,
        initialContent: customContent,
      });

      const html = renderToString(component);

      expect(html).toContain("Custom Title");
      expect(html).toContain("Custom explanation of the topic.");
    });

    it("renders custom quiz questions when provided", () => {
      const customQuestions = [
        {
          id: "custom-q-1" as UUID,
          question: "Custom Question Alpha?",
          options: ["Option 1", "Option 2", "Option 3", "Option 4"] as [string, string, string, string],
          questionOrder: 1,
        },
      ];

      const component = React.createElement(LearningFeature, {
        studentId,
        conceptId,
        initialQuizQuestions: customQuestions,
      });

      const html = renderToString(component);

      expect(html).toContain("Custom Question Alpha?");
      expect(html).toContain("Option 1");
      expect(html).toContain("Option 4");
    });
    it("clamps out-of-range difficulty in concept metadata to valid 1-5 bounds", async () => {
      const pageHigh = await ConceptLearningPage({
        params: Promise.resolve({ studentId, conceptId }),
        searchParams: Promise.resolve({
          conceptLabel: "High Difficulty Topic",
          difficulty: "99",
        }),
      });
      const htmlHigh = renderToString(pageHigh);
      expect(htmlHigh).toContain("Difficulty: 5 / 5");

      const pageLow = await ConceptLearningPage({
        params: Promise.resolve({ studentId, conceptId }),
        searchParams: Promise.resolve({
          conceptLabel: "Low Difficulty Topic",
          difficulty: "-5",
        }),
      });
      const htmlLow = renderToString(pageLow);
      expect(htmlLow).toContain("Difficulty: 1 / 5");
    });

    it("renders academic citations and search input in the resources panel", () => {
      const component = React.createElement(LearningFeature, {
        studentId,
        conceptId,
      });
      const html = renderToString(component);

      expect(html).toContain('data-testid="academic-resources-panel"');
      expect(html).toContain("Cited Academic Literature &amp; Sources");
      expect(html).toContain("[1]");
      expect(html).toContain("[2]");
      expect(html).toContain("[3]");
      expect(html).toContain("Search literature or ask a question about this concept…");
    });

    it("strictly preserves accessible ARIA tab and radio semantics", () => {
      const component = React.createElement(LearningFeature, {
        studentId,
        conceptId,
      });
      const html = renderToString(component);

      expect(html).toContain('role="tablist"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('type="radio"');
    });
  });
});
