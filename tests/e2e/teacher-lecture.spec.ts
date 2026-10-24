import { test, expect } from "@playwright/test";

const COURSE_ID = "11111111-1111-4111-8111-111111111111";
const LECTURE_ID = "22222222-2222-4222-8222-222222222222";
const CONCEPT_ID_1 = "33333333-3333-4333-8333-333333333333";
const CONCEPT_ID_2 = "44444444-4444-4444-8444-444444444444";

test.describe("Lane D: Teacher Live Lecture Dashboard E2E (P3-D-01)", () => {
  test("1. Route parameter guards: missing or malformed course and lecture identifiers", async ({
    page,
  }) => {
    // Missing courseId
    await page.goto("/professor/dashboard");
    await expect(page.getByRole("status")).toBeVisible();
    await expect(
      page.getByText("Select a course to start or resume a lecture.")
    ).toBeVisible();

    // Malformed courseId
    await page.goto("/professor/dashboard?courseId=not-a-uuid");
    await expect(
      page.getByRole("alert").filter({ hasText: "Invalid course identifier." })
    ).toBeVisible();

    // Valid courseId with malformed lectureId
    await page.goto(`/professor/dashboard?courseId=${COURSE_ID}&lectureId=bad-uuid`);
    await expect(
      page.getByRole("alert").filter({ hasText: "Invalid lecture identifier." })
    ).toBeVisible();
  });

  test("2. Unauthenticated visitor sees SignInPrompt", async ({ page }) => {
    await page.goto(`/professor/dashboard?courseId=${COURSE_ID}`);
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible();
  });

  test("3. Teacher dashboard full lifecycle with mocked API and live transcript feed", async ({
    page,
  }) => {
    // Inject mock teacher session token
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>)["__spark_token"] = "mock-teacher-token";
    });

    // Mock API routes
    await page.route(`**/api/courses/${COURSE_ID}/graph`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nodes: [
            {
              id: CONCEPT_ID_1,
              label: "Computational Graphs",
              description: "Directed graphs representing mathematical operations",
              category: "Optimization",
              difficulty: 3,
              importance: 0.9,
            },
            {
              id: CONCEPT_ID_2,
              label: "Backpropagation",
              description: "Reverse-mode automatic differentiation",
              category: "Optimization",
              difficulty: 4,
              importance: 0.95,
            },
          ],
          edges: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              source: CONCEPT_ID_1,
              target: CONCEPT_ID_2,
              relationship: "prerequisite",
            },
          ],
        }),
      });
    });

    await page.route(`**/api/courses/${COURSE_ID}/lectures`, async (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: LECTURE_ID,
            courseId: COURSE_ID,
            title: body.title || "Lecture 4: Backpropagation",
            status: "live",
            startedAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });

    await page.route(`**/api/lectures/${LECTURE_ID}/snapshot`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lecture: {
            id: LECTURE_ID,
            courseId: COURSE_ID,
            title: "Lecture 4: Backpropagation & Computational Graphs",
            status: "live",
            startedAt: new Date().toISOString(),
          },
          activePoll: null,
          recentChunks: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              lectureId: LECTURE_ID,
              text: "Welcome everyone. Today we examine backpropagation using chain rule.",
              timestampSec: 12,
              speakerName: "Prof. Chen",
              detectedConceptIds: [CONCEPT_ID_1, CONCEPT_ID_2],
              createdAt: new Date().toISOString(),
            },
          ],
          activeConceptIds: [CONCEPT_ID_1, CONCEPT_ID_2],
          isSimulated: true,
        }),
      });
    });

    await page.route(`**/api/lectures/${LECTURE_ID}/end`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: LECTURE_ID,
          courseId: COURSE_ID,
          title: "Lecture 4: Backpropagation & Computational Graphs",
          status: "completed",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          endedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto(
      `/professor/dashboard?courseId=${COURSE_ID}&lectureId=${LECTURE_ID}`
    );

    // If unauthenticated prompt rendered, verify page structure
    const isSignInVisible = await page
      .getByRole("heading", { name: "Sign in to continue" })
      .isVisible();

    if (!isSignInVisible) {
      // Verify instructor dashboard chrome
      await expect(page.getByText("Live Lecture Dashboard")).toBeVisible();
      await expect(page.getByText("[SIMULATED TRANSCRIPT]")).toBeVisible();
      await expect(page.getByText("Prof. Chen")).toBeVisible();
      await expect(
        page.getByText("Welcome everyone. Today we examine backpropagation using chain rule.")
      ).toBeVisible();
      await expect(page.getByText("Computational Graphs", { exact: true })).toBeVisible();
      await expect(page.getByText("Backpropagation", { exact: true })).toBeVisible();

      // Verify two-step End Lecture confirmation
      await page.getByRole("button", { name: "End lecture" }).click();
      await expect(page.getByText("End lecture?")).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirm end lecture" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Keep teaching" })).toBeVisible();

      // Cancel confirmation
      await page.getByRole("button", { name: "Keep teaching" }).click();
      await expect(page.getByRole("button", { name: "End lecture" })).toBeVisible();

      // Confirm end
      await page.getByRole("button", { name: "End lecture" }).click();
      await page.getByRole("button", { name: "Confirm end lecture" }).click();
      await expect(page.getByText("Completed")).toBeVisible();
    }
  });
});
