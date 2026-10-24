import { test, expect, type Page } from "@playwright/test";
import { fixturePrerequisiteGraph } from "../../src/server/ai/fixtures/prerequisite-graph";

const COURSE_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Helper to upload an in-memory PDF through the actual /professor/upload form
 * with an intercepted fixture response.
 */
async function uploadFixtureSyllabus(page: Page, customPreview?: unknown) {
  const fixture = fixturePrerequisiteGraph();
  const payload = customPreview ?? {
    courseId: COURSE_ID,
    totalPages: 11,
    processedPages: 10,
    truncated: true,
    preview: fixture,
  };

  await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.goto(`/professor/upload?courseId=${COURSE_ID}`);
  await page.waitForSelector('input[type="file"]');

  await page.setInputFiles('input[type="file"]', {
    name: "syllabus.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 mock syllabus content"),
  });

  if (!customPreview) {
    await page.waitForSelector("text=Knowledge Graph Preview");
    await page.waitForSelector("svg .nodes-layer");
  }
}

test.describe("Lane D: Interactive Knowledge Graph E2E (P2-D-02)", () => {
  test("renders 33 star vessels, 34 edges, and unassessed preview mastery state", async ({
    page,
  }) => {
    await uploadFixtureSyllabus(page);

    // Verify 33 star buttons in SVG
    const starButtons = page.locator('g[role="button"][data-node-id]');
    await expect(starButtons).toHaveCount(33);

    // Verify 34 directed edges
    const edges = page.locator(".edges-layer line");
    await expect(edges).toHaveCount(34);

    // Verify all preview nodes display "Mastery unavailable"
    const firstStar = page.locator('g[role="button"][data-node-id="preview:Vectors"]');
    await expect(firstStar).toBeVisible();
    await expect(firstStar).toHaveAttribute("aria-label", /Mastery unavailable/);

    // Verify truncation disclosure and commit section are intact
    await expect(page.locator("text=Truncated extraction:")).toBeVisible();
    await expect(page.locator("button:has-text('Confirm graph')")).toBeVisible();
  });

  test("selects Backpropagation and highlights upstream prerequisite path while dimming unrelated nodes", async ({
    page,
  }) => {
    await uploadFixtureSyllabus(page);

    const backpropStar = page.locator(
      'g[role="button"][data-node-id="preview:Backpropagation"]'
    );
    await backpropStar.click();

    // Node is selected
    await expect(backpropStar).toHaveAttribute("aria-pressed", "true");

    // Drawer opens with details
    const drawer = page.locator('div[role="region"][aria-label="Selected concept details"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Backpropagation");
    await expect(drawer).toContainText("Direct Prerequisites");

    // Live announcement updated
    const liveRegion = page.locator('div[aria-live="polite"]');
    await expect(liveRegion).toContainText("Selected concept Backpropagation");

    // Upstream ancestor nodes remain full opacity
    const chainRuleStar = page.locator('g[role="button"][data-node-id="preview:Chain Rule"]');
    const chainRuleGeom = chainRuleStar.locator("> g").first();
    await expect(chainRuleGeom).toHaveAttribute("opacity", "1");

    // Unrelated concept node geometry dims to 0.25 opacity
    const overfittingStar = page.locator('g[role="button"][data-node-id="preview:Overfitting"]');
    const overfittingGeom = overfittingStar.locator("> g").first();
    await expect(overfittingGeom).toHaveAttribute("opacity", "0.25");

    // Clear selection restores all
    await page.locator('button:has-text("Clear selection")').first().click();
    await expect(backpropStar).toHaveAttribute("aria-pressed", "false");
    await expect(overfittingGeom).toHaveAttribute("opacity", "1");
  });

  test("supports keyboard traversal (Tab, Enter, Escape) and text alternative selection", async ({
    page,
  }) => {
    await uploadFixtureSyllabus(page);

    const firstStar = page.locator('g[role="button"]').first();
    await firstStar.focus();

    // Select with Enter
    await page.keyboard.press("Enter");
    await expect(firstStar).toHaveAttribute("aria-pressed", "true");

    // Clear with Escape
    await page.keyboard.press("Escape");
    await expect(firstStar).toHaveAttribute("aria-pressed", "false");

    // Expand Concept Details disclosure and select via text list button
    const detailsDisclosure = page.locator(
      'details:has-text("Concept details & prerequisites")'
    );
    await detailsDisclosure.locator("summary").click();

    const vectorsTextBtn = detailsDisclosure.getByRole("button", {
      name: /^Vectors\b/,
    });
    await vectorsTextBtn.click();

    const vectorsStar = page.locator(
      'g[role="button"][data-node-id="preview:Vectors"]'
    );
    await expect(vectorsStar).toHaveAttribute("aria-pressed", "true");
  });

  test("camera zoom and reset controls", async ({ page }) => {
    await uploadFixtureSyllabus(page);

    const svg = page.locator("svg.cursor-grab");
    const initialViewBox = await svg.getAttribute("viewBox");
    expect(initialViewBox).toBeTruthy();

    const zoomInBtn = page.locator('button[aria-label="Zoom in"]');
    await zoomInBtn.click();

    const zoomedViewBox = await svg.getAttribute("viewBox");
    expect(zoomedViewBox).not.toBe(initialViewBox);

    const resetBtn = page.locator('button[aria-label="Reset view"]');
    await resetBtn.click();

    const resetViewBox = await svg.getAttribute("viewBox");
    expect(resetViewBox).toBe(initialViewBox);
  });

  test("responsive viewport check on mobile (390x844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadFixtureSyllabus(page);

    // Verify SVG container renders without horizontal page overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // Controls remain visible and clickable
    await expect(page.locator('button[aria-label="Zoom in"]')).toBeVisible();
  });

  test("displays error alert for cyclic graph preview", async ({ page }) => {
    const cyclicGraph = {
      concepts: [
        { label: "ConceptA", description: "Desc", category: "Cat", difficulty: 1 },
        { label: "ConceptB", description: "Desc", category: "Cat", difficulty: 1 },
      ],
      edges: [
        ["ConceptA", "ConceptB"],
        ["ConceptB", "ConceptA"],
      ],
    };

    await uploadFixtureSyllabus(page, {
      courseId: COURSE_ID,
      totalPages: 2,
      processedPages: 2,
      truncated: false,
      preview: cyclicGraph,
    });

    const alert = page.locator('div[role="alert"]:has-text("Unable to display this knowledge graph.")');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("cycle detected");
  });

  test("supports reduced motion mode and dynamic preference changes", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await uploadFixtureSyllabus(page);

    // Nodes render and selection works in reduced motion mode
    const backpropStar = page.locator(
      'g[role="button"][data-node-id="preview:Backpropagation"]'
    );
    await backpropStar.click();
    await expect(backpropStar).toHaveAttribute("aria-pressed", "true");

    // Dynamic toggle of reduced motion preference
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(backpropStar).toHaveAttribute("aria-pressed", "true");
  });

  test("verifies 320px narrow viewport without page overflow and captures screenshots", async ({
    page,
  }) => {
    // 1440x1000 Desktop
    await page.setViewportSize({ width: 1440, height: 1000 });
    await uploadFixtureSyllabus(page);
    await page.screenshot({ path: "test-results/desktop-graph.png" });

    // 390x844 Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/mobile-graph.png" });

    // 320px Narrow Screen
    await page.setViewportSize({ width: 320, height: 600 });
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });
});
