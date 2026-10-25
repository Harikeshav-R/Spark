import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import StudentTutorPage from "@/app/student/[studentId]/tutor/page";
import StudentSummariesPage from "@/app/student/[studentId]/summaries/page";
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
    it("strictly preserves accessible ARIA landmarks for summaries view", () => {
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
