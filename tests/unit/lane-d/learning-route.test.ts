import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import ConceptLearningPage from "@/app/student/[studentId]/concepts/[conceptId]/page";

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

  describe("Concept metadata difficulty bounds", () => {
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
  });
});
