import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import StudentTutorPage from "@/app/student/[studentId]/tutor/page";
import StudentSummariesPage from "@/app/student/[studentId]/summaries/page";
import { TutorFeature } from "@/features/tutor/tutor-feature";
import {
  LectureSummariesView,
  type LectureSummaryItem,
} from "@/features/student/lecture-summaries-view";

// Mock next/navigation notFound
const mockNotFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
}));

describe("P5-D-02: Student Tutoring & Lecture Summaries Shell Mounting", () => {
  const studentId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "22222222-2222-4222-8222-222222222222";
  const conceptId: UUID = "33333333-3333-4333-8333-333333333331";
  const sessionId: UUID = "55555555-5555-4555-8555-555555555555";

  describe("1. Route Parameter Validation & notFound() Invariants", () => {
    it("invokes notFound() on /student/[studentId]/tutor when studentId is malformed", async () => {
      mockNotFound.mockClear();

      await expect(
        StudentTutorPage({
          params: Promise.resolve({ studentId: "not-a-valid-uuid" }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it("invokes notFound() on /student/[studentId]/summaries when studentId is malformed", async () => {
      mockNotFound.mockClear();

      await expect(
        StudentSummariesPage({
          params: Promise.resolve({ studentId: "not-a-valid-uuid" }),
          searchParams: Promise.resolve({}),
        })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });
  });

  describe("2. Layout Shell & Breadcrumb Mounting", () => {
    it("renders /student/[studentId]/tutor with AppShell and student breadcrumbs", async () => {
      const page = await StudentTutorPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({ courseId }),
      });

      const html = renderToString(page);

      // Shell & breadcrumbs
      expect(html).toContain("Socratic Tutoring");
      expect(html).toContain("Student workspace");
      expect(html).toContain(`/student/${studentId}?courseId=${courseId}`);
      expect(html).toContain('aria-current="page"');
    });

    it("renders /student/[studentId]/summaries with AppShell and student breadcrumbs", async () => {
      const page = await StudentSummariesPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({ courseId }),
      });

      const html = renderToString(page);

      // Shell & breadcrumbs
      expect(html).toContain("Lecture Summaries");
      expect(html).toContain("Student workspace");
      expect(html).toContain(`/student/${studentId}?courseId=${courseId}`);
      expect(html).toContain('aria-current="page"');
    });
  });

  describe("3. TutorFeature Mounting & Interactive Socratic Chat", () => {
    it("renders TutorFeature with concept selector and initial Socratic dialogue", async () => {
      const page = await StudentTutorPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({
          courseId,
          conceptId,
          sessionId,
        }),
      });

      const html = renderToString(page);

      // TutorFeature mounted
      expect(html).toContain('data-testid="tutor-feature"');
      expect(html).toContain("Socratic Tutoring Workspace");
      expect(html).toContain("Select Concept for Tutoring:");

      // Concept radio items
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain("Backpropagation");
      expect(html).toContain("Gradient Descent Optimization");
      expect(html).toContain("Self-Attention Mechanism");

      // Companion Mascot and mastery progress
      expect(html).toContain("Spark Companion");
      expect(html).toContain('role="progressbar"');
      expect(html).toContain("Concept Confidence:");

      // Chat feed and composer
      expect(html).toContain("Socratic Dialogue Feed");
      expect(html).toContain('data-testid="tutor-message-assistant"');
      expect(html).toContain("Spark (Tutor)");
      expect(html).toContain("Send Response");
    });

    it("renders LaTeX math expressions with accessible role='math'", () => {
      const component = React.createElement(TutorFeature, {
        studentId,
        courseId,
        initialMessages: [
          {
            id: "msg-math-01" as UUID,
            sessionId,
            role: "assistant",
            content: "Recall that $\\nabla L$ indicates the steepest ascent direction. We compute $$\\frac{\\partial L}{\\partial w} = x \\cdot e$$ to adjust weights.",
            conceptId,
            understandingDetected: false,
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const html = renderToString(component);

      // Verifies math containers
      expect(html).toContain('role="math"');
      expect(html).toContain("\\nabla L");
      expect(html).toContain("\\frac{\\partial L}{\\partial w} = x \\cdot e");
    });

    it("renders understanding detected celebration badge when flag is true", () => {
      const component = React.createElement(TutorFeature, {
        studentId,
        courseId,
        initialMessages: [
          {
            id: "msg-celebration-01" as UUID,
            sessionId,
            role: "assistant",
            content: "Excellent synthesis! That demonstrates a clear grasp of chain rule propagation.",
            conceptId,
            understandingDetected: true,
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const html = renderToString(component);

      expect(html).toContain("Understanding Detected! +20% Mastery Confidence");
      expect(html).toContain('role="status"');
    });

    it("renders custom concept selection when initialConcepts is provided", () => {
      const customConcepts = [
        {
          id: "custom-concept-1" as UUID,
          courseId,
          label: "Custom Transformer Block",
          description: "Multi-head attention and feedforward residual connections.",
          category: "Deep Learning",
          difficulty: 5,
          createdAt: new Date().toISOString(),
        },
      ];

      const component = React.createElement(TutorFeature, {
        studentId,
        courseId,
        initialConcepts: customConcepts,
        initialConceptId: "custom-concept-1" as UUID,
      });

      const html = renderToString(component);

      expect(html).toContain("Custom Transformer Block");
      expect(html).toContain("Diff 5/5");
      expect(html).toContain("Multi-head attention and feedforward residual connections.");
    });
  });

  describe("4. Lecture Summaries Mounting & Chronological Highlights", () => {
    it("renders past lecture summaries with completed status, key concepts, and timeline highlights", async () => {
      const page = await StudentSummariesPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({ courseId }),
      });

      const html = renderToString(page);

      // Summaries view container
      expect(html).toContain('data-testid="lecture-summaries-view"');
      expect(html).toContain("Past Lecture Summaries");
      expect(html).toContain('data-testid="summaries-list"');

      // Default fixtures rendered
      expect(html).toContain("Lecture 1: Introduction to Deep Learning, Perceptrons &amp; Loss Surfaces");
      expect(html).toContain("Lecture 2: Computational Graphs, Forward Propagation &amp; Vectorization");
      expect(html).toContain("Lecture 3: Reverse-Mode Automatic Differentiation &amp; Backpropagation");
      expect(html).toContain("COMPLETED");

      // Key concepts tags
      expect(html).toContain("#Backpropagation");
      expect(html).toContain("#Computational Graphs");
      expect(html).toContain("#Perceptrons");

      // Timeline highlights
      expect(html).toContain("Lecture Timeline Highlights");
      expect(html).toContain("08:15");
      expect(html).toContain("Biological vs Artificial Neurons");
      expect(html).toContain("12:00");
      expect(html).toContain("Directed Acyclic Graphs for Math");

      // Tutoring navigation action
      expect(html).toContain("Tutor on this Lecture");
    });

    it("renders custom lecture summaries when provided", () => {
      const customSummaries: LectureSummaryItem[] = [
        {
          lectureId: "custom-lecture-101" as UUID,
          title: "Lecture 10: Diffusion Models & Score Matching",
          summary: "Theoretical breakdown of forward noising processes and reverse denoising trajectories.",
          keyConceptsCovered: ["Diffusion", "Langevin Dynamics", "Score Matching"],
          timelineHighlights: [
            {
              timestampSec: 615,
              conceptLabel: "Forward SDE",
              description: "Continuous formulation of Gaussian noise addition.",
            },
          ],
          generatedAt: "2026-10-23T14:00:00.000Z",
        },
      ];

      const component = React.createElement(LectureSummariesView, {
        studentId,
        courseId,
        initialSummaries: customSummaries,
      });

      const html = renderToString(component);

      expect(html).toContain("Lecture 10: Diffusion Models &amp; Score Matching");
      expect(html).toContain("Theoretical breakdown of forward noising processes");
      expect(html).toContain("#Diffusion");
      expect(html).toContain("#Score Matching");
      expect(html).toContain("10:15");
      expect(html).toContain("Forward SDE");
    });
  });

  describe("5. Invariant / Error Cases: Empty Summaries List Guidance", () => {
    it("renders helpful guidance when the summaries list is empty", () => {
      const component = React.createElement(LectureSummariesView, {
        studentId,
        courseId,
        initialSummaries: [],
      });

      const html = renderToString(component);

      // Verify empty summaries guidance invariant
      expect(html).toContain('data-testid="empty-summaries-guidance"');
      expect(html).toContain("No Lecture Summaries Available Yet");
      expect(html).toContain(
        "Lecture summaries are automatically generated by Spark when your instructor completes a live lecture."
      );
      expect(html).toContain("Return to Student Workspace");
      expect(html).toContain(`/student/${studentId}?courseId=${courseId}`);
    });
  });

  describe("6. Accessibility & Semantic Invariants", () => {
    it("strictly preserves accessible ARIA landmarks, radio groups, and form labels", () => {
      const tutorComponent = React.createElement(TutorFeature, {
        studentId,
        courseId,
      });
      const tutorHtml = renderToString(tutorComponent);

      expect(tutorHtml).toContain('aria-label="Socratic Tutoring Interface"');
      expect(tutorHtml).toContain('role="radiogroup"');
      expect(tutorHtml).toContain('role="radio"');
      expect(tutorHtml).toContain('role="progressbar"');
      expect(tutorHtml).toContain('aria-valuenow="35"');

      const summariesComponent = React.createElement(LectureSummariesView, {
        studentId,
        courseId,
      });
      const summariesHtml = renderToString(summariesComponent);

      expect(summariesHtml).toContain('aria-label="Lecture Summaries Directory"');
      expect(summariesHtml).toContain('placeholder="Filter summaries by concept or keyword…"');
    });
  });
});
