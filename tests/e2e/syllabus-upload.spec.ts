import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { fixturePrerequisiteGraph } from "../../src/server/ai/fixtures/prerequisite-graph";

const COURSE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_COURSE_ID = "33333333-3333-4333-8333-333333333333";

let pdf11PagesBuffer: Buffer | null = null;

async function get11PagePdfBuffer(): Promise<Buffer> {
  if (!pdf11PagesBuffer) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 11; i++) {
      doc.addPage([612, 792]);
    }
    const bytes = await doc.save();
    pdf11PagesBuffer = Buffer.from(bytes);
  }
  return pdf11PagesBuffer;
}

test.describe("Lane D: Syllabus Upload & Graph Commit E2E (P2-D-01)", () => {
  test("1. Full lifecycle: valid course -> upload multipart -> preview -> confirm commit", async ({
    page,
  }) => {
    const fixture = fixturePrerequisiteGraph();
    const pdfBuffer = await get11PagePdfBuffer();

    let interceptedUploadField: string | null = null;
    let interceptedUploadCourseId: string | null = null;
    const { promise: uploadHoldPromise, resolve: releaseUploadResponse } =
      Promise.withResolvers<void>();

    await page.route(`**/api/courses/*/upload`, async (route) => {
      const url = route.request().url();
      const match = url.match(/\/api\/courses\/([^/]+)\/upload/);
      interceptedUploadCourseId = match ? decodeURIComponent(match[1]) : null;

      const postData = route.request().postDataBuffer();
      if (postData) {
        const text = postData.toString("utf8", 0, Math.min(postData.length, 2048));
        const fieldMatch = text.match(/name="([^"]+)"/);
        interceptedUploadField = fieldMatch ? fieldMatch[1] : null;
      }

      await uploadHoldPromise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          courseId: COURSE_ID,
          totalPages: 11,
          processedPages: 10,
          truncated: true,
          preview: fixture,
        }),
      });
    });

    let commitCalled = false;
    let commitPayload: Record<string, unknown> | null = null;

    await page.route(`**/api/courses/*/graph`, async (route) => {
      commitCalled = true;
      commitPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          nodeCount: 33,
          edgeCount: 34,
        }),
      });
    });

    await page.goto(`/professor/upload?courseId=${COURSE_ID}`);
    await page.waitForSelector('input[type="file"]');

    // Trigger upload
    await page.setInputFiles('input[type="file"]', {
      name: "cs229-syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    // Observe loading state while response is held
    await expect(page.locator("button:has-text('Processing syllabus…')")).toBeVisible();
    await expect(page.locator("text=Extracting concepts and prerequisite relationships")).toBeVisible();

    // Release upload response
    releaseUploadResponse();

    // Inspect intercepted upload request
    expect(interceptedUploadCourseId).toBe(COURSE_ID);
    expect(interceptedUploadField).toBe("syllabus");

    // Observe preview state: 33 star vessels, truncation disclosure, confirm button
    await page.waitForSelector("svg .nodes-layer");
    const starButtons = page.locator('g[role="button"][data-node-id]');
    await expect(starButtons).toHaveCount(33);

    await expect(page.locator("text=Truncated extraction:")).toBeVisible();
    await expect(page.locator("text=10 of 11 pages")).toBeVisible();

    const confirmButton = page.locator("button:has-text('Confirm graph (33 concepts)')");
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toBeEnabled();

    // Verify no commit POST was sent prior to explicit confirmation
    expect(commitCalled).toBe(false);

    // Click confirm to commit
    await confirmButton.click();

    // Verify commit payload structure: concepts and edges, NO nodes key
    await expect(page.locator("text=Knowledge graph committed")).toBeVisible();
    expect(commitCalled).toBe(true);
    expect(commitPayload).not.toBeNull();
    expect(commitPayload).toHaveProperty("concepts");
    expect(commitPayload).toHaveProperty("edges");
    expect(commitPayload).not.toHaveProperty("nodes");

    // Verify committed counts
    await expect(page.locator("text=33 concepts and 34 prerequisite edges saved.")).toBeVisible();
    await expect(page.locator("a:has-text('Back to instructor workspace')")).toBeVisible();
  });

  test("2. Rejects missing, empty, malformed, or repeated courseId query parameter", async ({
    page,
  }) => {
    let requestMade = false;
    await page.route("**/api/courses/**", async (route) => {
      requestMade = true;
      await route.abort();
    });

    const invalidUrls = [
      "/professor/upload",
      "/professor/upload?courseId=",
      "/professor/upload?courseId=not-a-valid-uuid",
      `/professor/upload?courseId=${COURSE_ID}&courseId=${OTHER_COURSE_ID}`,
    ];

    for (const url of invalidUrls) {
      await page.goto(url);

      const alert = page.locator('main div[role="alert"]');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(
        "A valid course must be selected before uploading a syllabus."
      );

      // Verify link to instructor workspace
      const dashboardLink = alert.locator("a[href='/professor/dashboard']");
      await expect(dashboardLink).toBeVisible();

      // Verify file input and drop zone are NOT mounted
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(page.locator("text=Drop PDF here or click to browse")).toHaveCount(0);
    }

    expect(requestMade).toBe(false);
  });

  test("3. Rejects preview response with mismatched courseId and recovers on retry", async ({
    page,
  }) => {
    const fixture = fixturePrerequisiteGraph();
    const pdfBuffer = await get11PagePdfBuffer();
    let attempt = 0;

    await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
      attempt++;
      if (attempt === 1) {
        // Return preview with mismatched courseId
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            courseId: OTHER_COURSE_ID,
            totalPages: 11,
            processedPages: 10,
            truncated: true,
            preview: fixture,
          }),
        });
      } else {
        // Return valid preview on second attempt
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            courseId: COURSE_ID,
            totalPages: 11,
            processedPages: 10,
            truncated: true,
            preview: fixture,
          }),
        });
      }
    });

    await page.goto(`/professor/upload?courseId=${COURSE_ID}`);
    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    // Mismatched courseId triggers error modal
    const modal = page.locator('div[role="dialog"]:not([data-nextjs-dialog])');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Invalid server response");

    // Commit control must not be present
    await expect(page.locator("button:has-text('Confirm graph')")).toHaveCount(0);

    // Dismiss modal and retry
    await page.locator("button:has-text('Dismiss')").click();
    await expect(modal).not.toBeVisible();

    // Retry upload
    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    // Successful recovery
    await expect(page.locator("button:has-text('Confirm graph (33 concepts)')")).toBeVisible();
  });

  test("4. Displays canonical JSON error modals: 422 invalid graph and 409 conflict", async ({
    page,
  }) => {
    const fixture = fixturePrerequisiteGraph();
    const pdfBuffer = await get11PagePdfBuffer();
    let uploadAttempt = 0;

    await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
      uploadAttempt++;
      if (uploadAttempt === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "UNPROCESSABLE_ENTITY",
              message: "Extracted graph contains cycles",
              statusCode: 422,
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            courseId: COURSE_ID,
            totalPages: 11,
            processedPages: 10,
            truncated: true,
            preview: fixture,
          }),
        });
      }
    });

    await page.route(`**/api/courses/${COURSE_ID}/graph`, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "CONFLICT",
            message: "A knowledge graph has already been committed",
            statusCode: 409,
          },
        }),
      });
    });

    await page.goto(`/professor/upload?courseId=${COURSE_ID}`);
    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    // 422 error modal
    const modal = page.locator('div[role="dialog"]:not([data-nextjs-dialog])');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(
      "The extracted graph contains a cycle or invalid structure and cannot be committed."
    );

    // Dismiss and retry
    await page.locator("button:has-text('Dismiss')").click();
    await expect(modal).not.toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    // Arrive at preview, then confirm commit
    await expect(page.locator("button:has-text('Confirm graph (33 concepts)')")).toBeVisible();
    await page.locator("button:has-text('Confirm graph (33 concepts)')").click();

    // 409 error modal
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(
      "A knowledge graph has already been committed for this course. To start fresh, create a new course."
    );

    // Must not be in committed state
    await expect(page.locator("text=Knowledge graph committed")).toHaveCount(0);
  });

  test("5. Handles non-JSON error responses (413, 409) and network abort cleanly", async ({
    page,
  }) => {
    const fixture = fixturePrerequisiteGraph();
    const pdfBuffer = await get11PagePdfBuffer();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Case 5a: non-JSON 413 on upload
    await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
      await route.fulfill({
        status: 413,
        contentType: "text/html",
        body: "<html><body><h1>413 Request Entity Too Large</h1></body></html>",
      });
    });

    await page.goto(`/professor/upload?courseId=${COURSE_ID}`);
    await page.setInputFiles('input[type="file"]', {
      name: "huge-syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    const modal = page.locator('div[role="dialog"]:not([data-nextjs-dialog])');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("File exceeds the 50 MiB maximum size.");
    // Ensure raw HTML is NOT displayed
    await expect(modal).not.toContainText("<h1>");

    // Verify contextual decode diagnostic logged
    expect(
      consoleErrors.some((log) => log.includes("[SyllabusUpload] Failed to decode API error response"))
    ).toBe(true);

    // Dismiss
    await page.locator("button:has-text('Dismiss')").click();

    // Case 5b: network abort on upload
    await page.unroute(`**/api/courses/${COURSE_ID}/upload`);
    await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
      await route.abort("failed");
    });

    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/Failed to fetch|An unexpected error occurred/);
    await page.locator("button:has-text('Dismiss')").click();

    // Case 5c: non-JSON 409 on commit
    await page.unroute(`**/api/courses/${COURSE_ID}/upload`);
    await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          courseId: COURSE_ID,
          totalPages: 11,
          processedPages: 10,
          truncated: true,
          preview: fixture,
        }),
      });
    });

    await page.route(`**/api/courses/${COURSE_ID}/graph`, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "text/html",
        body: "<html><body><h1>Conflict</h1></body></html>",
      });
    });

    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    await expect(page.locator("button:has-text('Confirm graph (33 concepts)')")).toBeVisible();
    await page.locator("button:has-text('Confirm graph (33 concepts)')").click();

    await expect(modal).toBeVisible();
    await expect(modal).toContainText(
      "A knowledge graph has already been committed for this course. To start fresh, create a new course."
    );
    await expect(modal).not.toContainText("<h1>");
  });

  test("6. Rejects malformed 2xx commit response missing canonical fields", async ({
    page,
  }) => {
    const fixture = fixturePrerequisiteGraph();
    const pdfBuffer = await get11PagePdfBuffer();

    await page.route(`**/api/courses/${COURSE_ID}/upload`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          courseId: COURSE_ID,
          totalPages: 11,
          processedPages: 10,
          truncated: true,
          preview: fixture,
        }),
      });
    });

    // 200 OK but malformed body (missing success: true, nodeCount, edgeCount)
    await page.route(`**/api/courses/${COURSE_ID}/graph`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto(`/professor/upload?courseId=${COURSE_ID}`);
    await page.setInputFiles('input[type="file"]', {
      name: "syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    await expect(page.locator("button:has-text('Confirm graph (33 concepts)')")).toBeVisible();
    await page.locator("button:has-text('Confirm graph (33 concepts)')").click();

    // Must show Invalid server response modal, not fake success
    const modal = page.locator('div[role="dialog"]:not([data-nextjs-dialog])');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Invalid server response");
    await expect(page.locator("text=Knowledge graph committed")).toHaveCount(0);
  });
});
