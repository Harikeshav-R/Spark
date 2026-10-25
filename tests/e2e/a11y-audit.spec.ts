import { test, expect, type JourneyFixture } from "./helpers/journey-fixture";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import {
  create11PageSyllabusPdf,
  startLecture,
  ingestTranscript,
  signIn,
} from "./helpers/journey-actions";
import { setupJ09Scenario } from "./helpers/game-scenarios";
import { DEMO_PASSWORD } from "../../src/server/platform/index";

const AUDIT_CONFIGS: Array<{ width: number; motion: "reduce" | "no-preference" }> = [
  { width: 1360, motion: "no-preference" },
  { width: 1360, motion: "reduce" },
  { width: 400, motion: "no-preference" },
  { width: 400, motion: "reduce" },
];

async function configurePages(
  journey: JourneyFixture,
  width: number,
  reducedMotion: "reduce" | "no-preference"
): Promise<void> {
  const pages = [
    journey.harness.teacher.page,
    journey.harness.hari.page,
    journey.harness.rahul.page,
  ];
  for (const page of pages) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
  }
}

async function auditPage(
  page: Page,
  testInfo: TestInfo,
  stateName: string,
  width: number,
  motion: "reduce" | "no-preference"
): Promise<void> {
  const browserName = testInfo.project.name;
  const label = `${browserName}-${width}px-${motion}-${stateName}`;

  // 1. Run full-page WCAG 2.0 & 2.1 A + AA axe analysis
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  await testInfo.attach(`${label}-axe-results`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${label}-screenshot`, {
    body: screenshot,
    contentType: "image/png",
  });

  expect(results.violations).toEqual([]);

  // 2. Horizontal scroll check
  const scrollMetrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(
    scrollMetrics.clientWidth + 1
  );

  // Check Encounter scrolling panel if open
  const encounterDrawer = page.locator('[data-testid="encounter-drawer"]');
  if (await encounterDrawer.isVisible()) {
    const drawerMetrics = await encounterDrawer.evaluate((el) => {
      const panel = el.querySelector(".overflow-y-auto");
      if (!panel) return null;
      return {
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
      };
    });
    if (drawerMetrics) {
      expect(drawerMetrics.scrollWidth).toBeLessThanOrEqual(
        drawerMetrics.clientWidth + 1
      );
    }
  }

  // 3. Landmark & heading checks
  const visibleModal = page.locator('[role="dialog"]:visible').first();
  if (await visibleModal.isVisible()) {
    const dialogHeading = visibleModal
      .locator('h1, h2, h3, [role="heading"]')
      .first();
    await expect(dialogHeading).toBeVisible();
  } else {
    const mainLandmark = page.locator("main, [role='main']").first();
    await expect(mainLandmark).toBeVisible();
    const heading = page.locator("h1, h2, [role='heading']").first();
    await expect(heading).toBeVisible();
  }
}

test.describe("P7-D-02 Responsive Layout & Accessibility Audit Verification", () => {
  // --------------------------------------------------------------------------
  // Surface 1: Anonymous landing page (/)
  // --------------------------------------------------------------------------
  test("Anonymous landing page (/)", async ({ journey }, testInfo) => {
    const anonPage = await journey.harness.teacher.context.newPage();
    try {
      for (const { width, motion } of AUDIT_CONFIGS) {
        await anonPage.setViewportSize({ width, height: 900 });
        await anonPage.emulateMedia({ reducedMotion: motion });
        await anonPage.goto(journey.baseURL + "/");
        await expect(anonPage.locator("#auth-email")).toBeVisible();
        await expect(anonPage.locator("#auth-password")).toBeVisible();
        await expect(
          anonPage.getByRole("heading", { name: "Sign in to Spark" })
        ).toBeVisible();
        await auditPage(
          anonPage,
          testInfo,
          "anonymous-landing",
          width,
          motion
        );
      }
    } finally {
      await anonPage.close();
    }
  });

  // --------------------------------------------------------------------------
  // Surface 2: Professor course chooser (/professor/dashboard)
  // --------------------------------------------------------------------------
  test("Professor course chooser (/professor/dashboard)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const teacherPage = journey.harness.teacher.page;
    await teacherPage.goto("/professor/dashboard");
    await expect(teacherPage.locator("#course-name-input")).toBeVisible();
    await expect(
      teacherPage.getByRole("button", { name: "Create Course" })
    ).toBeVisible();

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        teacherPage,
        testInfo,
        "professor-course-chooser",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 3: Professor live lecture view (/professor/dashboard?courseId=...)
  // --------------------------------------------------------------------------
  test("Professor live lecture view (/professor/dashboard?courseId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const teacherPage = journey.harness.teacher.page;
    await teacherPage.goto(
      `/professor/dashboard?courseId=${journey.courseId}`
    );
    await expect(teacherPage.locator("#lecture-title-input")).toBeVisible();
    const { lectureId } = await startLecture(journey, "A11y Audit Lecture");
    await ingestTranscript(
      journey,
      lectureId,
      "Welcome to modern deep learning and backpropagation foundations.",
      1
    );
    await expect(
      teacherPage.getByText("Welcome to modern deep learning")
    ).toBeVisible();

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        teacherPage,
        testInfo,
        "professor-live-lecture",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 4: Professor Class Sky tab
  // --------------------------------------------------------------------------
  test("Professor Class Sky tab", async ({ journey }, testInfo) => {
    await journey.initCanonicalDemo();
    const teacherPage = journey.harness.teacher.page;
    await teacherPage.goto(
      `/professor/dashboard?courseId=${journey.courseId}`
    );
    await teacherPage.click("#tab-class-sky");
    await expect(teacherPage.getByText("Class Sky Analytics")).toBeVisible();
    await expect(
      teacherPage.locator('#panel-class-sky g[role="button"][data-node-id]')
    ).toHaveCount(33);
    await expect(
      teacherPage.getByRole("region", {
        name: "Student effort and mastery table",
      })
    ).toBeVisible();
    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        teacherPage,
        testInfo,
        "professor-class-sky",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 5: Professor syllabus upload preview (/professor/upload?courseId=...)
  // --------------------------------------------------------------------------
  test("Professor syllabus upload preview (/professor/upload?courseId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initEmptyOnboarding();
    const teacherPage = journey.harness.teacher.page;
    await teacherPage.goto("/professor/dashboard");
    await teacherPage.waitForSelector("#course-name-input", {
      state: "visible",
    });

    const createCourseResPromise = teacherPage.waitForResponse(
      (res) =>
        res.url().includes("/api/courses") &&
        res.request().method() === "POST" &&
        !res.url().includes("/enroll")
    );
    await teacherPage.fill("#course-name-input", "A11y Test Course");
    await teacherPage.fill("#course-desc-input", "Audit Syllabus Upload");
    await teacherPage.click('button:has-text("Create Course")');
    const createRes = await createCourseResPromise;
    expect(createRes.ok()).toBe(true);
    const courseData = (await createRes.json()) as {
      id: string;
      joinCode: string;
    };
    journey.courseId = courseData.id;
    journey.joinCode = courseData.joinCode;

    await teacherPage.goto(`/professor/upload?courseId=${journey.courseId}`);
    await teacherPage.waitForSelector("#syllabus-file-input", {
      state: "attached",
    });

    const pdfBuffer = await create11PageSyllabusPdf();
    const uploadResPromise = teacherPage.waitForResponse(
      (res) =>
        res.url().includes(`/api/courses/${journey.courseId}/upload`) &&
        res.request().method() === "POST"
    );
    await teacherPage.setInputFiles("#syllabus-file-input", {
      name: "cs229-syllabus.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });
    await uploadResPromise;

    await expect(
      teacherPage.locator('div[role="alert"]:has-text("Truncated extraction")')
    ).toBeVisible();
    await expect(
      teacherPage.locator('g[role="button"][data-node-id]')
    ).toHaveCount(33);

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        teacherPage,
        testInfo,
        "professor-syllabus-upload-preview",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 6: Student course chooser (/student/<rahulId>)
  // --------------------------------------------------------------------------
  test("Student course chooser (/student/<rahulId>)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const rahulPage = journey.harness.rahul.page;
    await rahulPage.goto(`/student/${journey.rahul.studentId}`);
    await expect(
      rahulPage.locator('[data-testid="course-entry"]')
    ).toBeVisible();
    await expect(
      rahulPage.getByRole("heading", { name: "Your Enrolled Courses" })
    ).toBeVisible();

    const courseLink = rahulPage.locator(
      `a:has-text("Enter Course Workspace")[href*="/student/${journey.rahul.studentId}?courseId=${journey.courseId}"]`
    );
    await expect(courseLink).toBeVisible();
    await expect(rahulPage.getByLabel("Course join code")).toBeVisible();

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "student-course-chooser",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 7: Student workspace (/student/<rahulId>?courseId=...)
  // --------------------------------------------------------------------------
  test("Student workspace (/student/<rahulId>?courseId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const { lectureId } = await startLecture(journey, "Student Workspace Audit");
    await ingestTranscript(
      journey,
      lectureId,
      "Live stream transcript data for lecture workspace.",
      1
    );

    const rahulPage = journey.harness.rahul.page;
    await rahulPage.goto(
      `/student/${journey.rahul.studentId}?courseId=${journey.courseId}&lectureId=${lectureId}`
    );
    await expect(
      rahulPage.locator('g[role="button"][data-node-id]')
    ).toHaveCount(33);
    await expect(
      rahulPage.locator('[data-testid="daily-quest-panel"]')
    ).toBeVisible();
    await expect(
      rahulPage.locator('[data-testid="eclipse-banner"]')
    ).toBeVisible();
    await expect(
      rahulPage.locator('[data-testid="spark-mascot-container"]')
    ).toBeVisible();

    // 1360px wide audit: all 3 rails visible
    for (const motion of ["no-preference", "reduce"] as const) {
      await configurePages(journey, 1360, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "student-workspace-3rails",
        1360,
        motion
      );
    }

    // 400px mobile segmented audits
    for (const motion of ["no-preference", "reduce"] as const) {
      await configurePages(journey, 400, motion);
      // Quests segmented view
      const questsBtn = rahulPage.getByRole("button", {
        name: "Daily Quests",
      });
      if (await questsBtn.isVisible()) {
        await questsBtn.click();
        await expect(
          rahulPage.locator('[data-testid="daily-quest-panel"]')
        ).toBeVisible();
        await auditPage(
          rahulPage,
          testInfo,
          "student-workspace-mobile-quests",
          400,
          motion
        );
      }

      // Stream segmented view
      const streamBtn = rahulPage.getByRole("button", {
        name: "Lecture Stream",
      });
      if (await streamBtn.isVisible()) {
        await streamBtn.click();
        await expect(
          rahulPage.getByText("Live feed connected")
        ).toBeVisible();
        await expect(
          rahulPage.getByText("Live stream transcript data")
        ).toBeVisible();
        await auditPage(
          rahulPage,
          testInfo,
          "student-workspace-mobile-stream",
          400,
          motion
        );
      }

      // Graph segmented view
      const graphBtn = rahulPage.getByRole("button", {
        name: "Knowledge Graph",
      });
      if (await graphBtn.isVisible()) {
        await graphBtn.click();
        await expect(
          rahulPage.locator('g[role="button"][data-node-id]').first()
        ).toBeVisible();
        await auditPage(
          rahulPage,
          testInfo,
          "student-workspace-mobile-graph",
          400,
          motion
        );
      }
    }
  });

  // --------------------------------------------------------------------------
  // Surface 8: Encounter and Hint Drawer
  // --------------------------------------------------------------------------
  test("Student Encounter and Hint Drawer", async ({ journey }, testInfo) => {
    const scenario = await setupJ09Scenario(journey);
    const rahulPage = journey.harness.rahul.page;
    await rahulPage.goto(
      `/student/${journey.rahul.studentId}?courseId=${scenario.courseId}`
    );
    await rahulPage.waitForSelector('[data-testid="daily-quest-panel"]');

    const firstQuestButton = rahulPage
      .locator('[data-testid^="practice-quest-"]')
      .first();
    await firstQuestButton.click();

    await rahulPage.waitForSelector('[data-testid="encounter-drawer"]', {
      state: "visible",
    });
    await rahulPage.waitForSelector('[data-testid="encounter-feature"]', {
      state: "visible",
    });

    // Audit initial drawer state at 1360 and 400
    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "encounter-drawer-initial",
        width,
        motion
      );
    }

    // Open hints and request hint level 1
    await rahulPage.click('button:has-text("View Hints")');
    await rahulPage.waitForSelector('[data-testid="request-hint-1"]', {
      state: "visible",
    });

    const hint1Promise = rahulPage.waitForResponse(
      (res) =>
        res.url().includes("/api/encounters/") &&
        res.url().includes("/hints") &&
        res.request().method() === "POST"
    );
    await rahulPage.click('[data-testid="request-hint-1"]');
    await hint1Promise;

    await rahulPage.waitForSelector('[data-testid="hint-text-1"]', {
      state: "visible",
    });

    // Audit revealed hint state at 1360 and 400
    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "encounter-drawer-hint-revealed",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 9: Student Concept Learning Guide & Resources
  // --------------------------------------------------------------------------
  test("Student Concept Learning Guide & Resources (/student/<rahulId>/concepts/<conceptId>?courseId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const rahulPage = journey.harness.rahul.page;
    const backpropId = journey.conceptIdsByLabel.get("Backpropagation")!;

    await rahulPage.goto(
      `/student/${journey.rahul.studentId}/concepts/${backpropId}?courseId=${journey.courseId}`
    );
    await expect(
      rahulPage.locator('[data-testid="learning-guide-panel"] article')
    ).toBeVisible();

    // 1. Audit Learning Guide Tab
    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "learning-guide-tab",
        width,
        motion
      );
    }

    // 2. Audit Practice Quiz Tab
    await rahulPage.click('button:has-text("Practice Quiz")');
    await expect(
      rahulPage.locator('[data-testid^="quiz-question-"]')
    ).toHaveCount(5);
    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "learning-quiz-tab",
        width,
        motion
      );
    }

    // 3. Audit Academic Resources Tab
    await rahulPage.click('button:has-text("Academic Resources")');
    const searchInput = rahulPage.getByLabel("Search Academic Literature:");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Backpropagation");
    await rahulPage.click('button:has-text("Search Literature")');

    await expect(
      rahulPage.locator('a[target="_blank"][rel="noopener noreferrer"]').first()
    ).toBeVisible({ timeout: 15_000 });

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "learning-resources-tab",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 10: Student Socratic Tutor (/student/<rahulId>/tutor?courseId=...&conceptId=...)
  // --------------------------------------------------------------------------
  test("Student Socratic Tutor (/student/<rahulId>/tutor?courseId=...&conceptId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const rahulPage = journey.harness.rahul.page;
    const backpropId = journey.conceptIdsByLabel.get("Backpropagation")!;

    await rahulPage.goto(
      `/student/${journey.rahul.studentId}/tutor?courseId=${journey.courseId}&conceptId=${backpropId}`
    );
    await expect(
      rahulPage.locator('[data-testid="tutor-feature"]')
    ).toBeVisible();
    await expect(
      rahulPage.locator('[role="radiogroup"][aria-label="Target concepts"]')
    ).toBeVisible();

    const tutorInput = rahulPage.getByLabel(
      "Explain your reasoning or ask a question:"
    );
    await expect(tutorInput).toBeVisible();
    await expect(tutorInput).toBeEnabled();

    // Send a question and await assistant reply
    await tutorInput.fill("How does the chain rule compute gradients in neural networks?");
    await rahulPage.click('button:has-text("Send Response")');

    await expect(
      rahulPage.locator('[data-testid="tutor-message-assistant"]').first()
    ).toBeVisible({ timeout: 20_000 });

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "student-tutor-populated",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 11: Student Study Group Workspace (/student/<rahulId>/study-group?courseId=...)
  // --------------------------------------------------------------------------
  test("Student Study Group Workspace (/student/<rahulId>/study-group?courseId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const rahulPage = journey.harness.rahul.page;
    const hariPage = journey.harness.hari.page;
    const backpropId = journey.conceptIdsByLabel.get("Backpropagation")!;

    await rahulPage.goto(
      `/student/${journey.rahul.studentId}/study-group?courseId=${journey.courseId}`
    );
    await expect(
      rahulPage.locator('[data-testid="study-group-workspace-content"]')
    ).toBeVisible();

    // Audit lobby before match
    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "study-group-lobby",
        width,
        motion
      );
    }

    // Bilateral opt-in for Backpropagation
    await rahulPage.check(`input[id*="${backpropId}"]`);
    await rahulPage.click('button:has-text("Join Study Pool")');
    await expect(
      rahulPage.locator('[data-testid="study-pool-waiting"]')
    ).toBeVisible();

    await hariPage.goto(
      `/student/${journey.hari.studentId}/study-group?courseId=${journey.courseId}`
    );
    await hariPage.waitForSelector(
      '[data-testid="study-group-workspace-content"]'
    );
    await hariPage.check(`input[id*="${backpropId}"]`);
    await hariPage.click('button:has-text("Join Study Pool")');

    // Both observe matched state and connected chat
    await expect(
      rahulPage.locator('[data-testid="study-pool-matched"]')
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      rahulPage.locator(
        '[data-testid="chat-connection-status"]:has-text("Connected")'
      )
    ).toBeVisible({ timeout: 15_000 });

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        rahulPage,
        testInfo,
        "study-group-matched",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Surface 12: Student Lecture Summaries (/student/<hariId>/summaries?courseId=...)
  // --------------------------------------------------------------------------
  test("Student Lecture Summaries (/student/<hariId>/summaries?courseId=...)", async ({
    journey,
  }, testInfo) => {
    await journey.initCanonicalDemo();
    const hariPage = journey.harness.hari.page;
    const teacherPage = journey.harness.teacher.page;

    // 1. Audit settled empty state
    await hariPage.goto(
      `/student/${journey.hari.studentId}/summaries?courseId=${journey.courseId}`
    );
    await expect(
      hariPage.locator('[data-testid="empty-summaries-guidance"]')
    ).toBeVisible();

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        hariPage,
        testInfo,
        "student-summaries-empty",
        width,
        motion
      );
    }

    // 2. Start lecture, ingest transcript, end lecture with confirmation
    const { lectureId } = await startLecture(
      journey,
      "Lecture on Optimization & Backprop"
    );
    await ingestTranscript(
      journey,
      lectureId,
      "Optimization foundations and gradient descent dynamics.",
      1
    );

    await teacherPage.click('button:has-text("End lecture")');
    await teacherPage.click('button:has-text("Confirm end lecture")');

    // 3. Student reloads summaries and audits populated state
    await hariPage.goto(
      `/student/${journey.hari.studentId}/summaries?courseId=${journey.courseId}`
    );
    await expect(
      hariPage.locator('[data-testid="lecture-summary-card-0"]')
    ).toBeVisible({ timeout: 15_000 });

    for (const { width, motion } of AUDIT_CONFIGS) {
      await configurePages(journey, width, motion);
      await auditPage(
        hariPage,
        testInfo,
        "student-summaries-populated",
        width,
        motion
      );
    }
  });

  // --------------------------------------------------------------------------
  // Behavioral: Encounter Drawer Keyboard Navigation & Focus Management
  // --------------------------------------------------------------------------
  test("EncounterDrawer keyboard navigation and focus management", async ({
    journey,
  }) => {
    const scenario = await setupJ09Scenario(journey);
    const rahulPage = journey.harness.rahul.page;
    await rahulPage.goto(
      `/student/${journey.rahul.studentId}?courseId=${scenario.courseId}`
    );
    await rahulPage.waitForSelector('[data-testid="daily-quest-panel"]');

    const firstQuestButton = rahulPage
      .locator('[data-testid^="practice-quest-"]')
      .first();
    await firstQuestButton.focus();
    await rahulPage.keyboard.press("Enter");

    const drawer = rahulPage.locator('[data-testid="encounter-drawer"]');
    await expect(drawer).toBeVisible();

    // 1. Initial focus inside drawer (close button)
    const closeBtn = drawer.locator(
      'button[aria-label="Close practice encounter drawer"]'
    );
    await expect(closeBtn).toBeFocused();

    // 2. Shift+Tab wraps to last focusable control
    await rahulPage.keyboard.press("Shift+Tab");
    const activeInsideAfterShiftTab = await drawer.evaluate((el) =>
      el.contains(document.activeElement)
    );
    expect(activeInsideAfterShiftTab).toBe(true);

    // 3. Tab from last wraps to first focusable control (close button)
    await rahulPage.keyboard.press("Tab");
    await expect(closeBtn).toBeFocused();

    // 4. Request hint: focus still trapped inside
    await rahulPage.click('button:has-text("View Hints")');
    await rahulPage.waitForSelector('[data-testid="request-hint-1"]', {
      state: "visible",
    });
    await rahulPage.click('[data-testid="request-hint-1"]');
    await rahulPage.waitForSelector('[data-testid="hint-text-1"]', {
      state: "visible",
    });

    await rahulPage.keyboard.press("Tab");
    const activeInsideAfterHint = await drawer.evaluate((el) =>
      el.contains(document.activeElement)
    );
    expect(activeInsideAfterHint).toBe(true);

    // 5. Escape closes and restores focus to quest button
    await rahulPage.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(firstQuestButton).toBeFocused();

    // 6. Repeat open/close to catch stale listeners and focus resets
    await firstQuestButton.focus();
    await rahulPage.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await rahulPage.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(firstQuestButton).toBeFocused();
  });

  // --------------------------------------------------------------------------
  // Behavioral: AppShell Skip Link Navigation
  // --------------------------------------------------------------------------
  test("AppShell skip link navigation", async ({ journey }, testInfo) => {
    const page = journey.harness.rahul.page;
    await page.goto(journey.baseURL + "/");

    // First Tab on landing focuses skip link (Alt+Tab on macOS WebKit for link navigation)
    if (testInfo.project.name === "webkit") {
      await page.keyboard.press("Alt+Tab");
    } else {
      await page.keyboard.press("Tab");
    }
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeFocused();
    // Enter moves focus to #main-content
    await page.keyboard.press("Enter");
    const mainContent = page.locator("#main-content");
    await expect(mainContent).toBeFocused();
  });

  // --------------------------------------------------------------------------
  // Behavioral: Responsive 1360px Wide Layout & 400px Mobile Segmented Views
  // --------------------------------------------------------------------------
  test("Responsive 1360px wide layout and 400px mobile segmented views", async ({
    journey,
  }) => {
    await journey.initCanonicalDemo();
    const rahulPage = journey.harness.rahul.page;
    const url = `/student/${journey.rahul.studentId}?courseId=${journey.courseId}`;

    // 1. At 1360px: grid computes 3 columns, companion/graph/stream simultaneously visible
    await rahulPage.setViewportSize({ width: 1360, height: 900 });
    await rahulPage.goto(url);
    await rahulPage.waitForSelector('[data-testid="spark-mascot-container"]');

    const layoutGrid = rahulPage.locator(
      '.min-\\[1360px\\]\\:grid-cols-\\[20fr_55fr_25fr\\]'
    );
    await expect(layoutGrid).toBeVisible();
    const cols1360 = await layoutGrid.evaluate(
      (el) =>
        window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/)
          .length
    );
    expect(cols1360).toBe(3);

    const mascotCard = rahulPage.locator(
      '[data-testid="spark-mascot-container"]'
    );
    const graphNode = rahulPage
      .locator('g[role="button"][data-node-id]')
      .first();
    await expect(mascotCard).toBeVisible();
    await expect(graphNode).toBeVisible();

    // 2. Spot check at 1359px: retains 2 columns
    await rahulPage.setViewportSize({ width: 1359, height: 900 });
    const cols1359 = await layoutGrid.evaluate(
      (el) =>
        window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/)
          .length
    );
    expect(cols1359).toBe(2);

    // 3. At 400px: segmented buttons reveal each panel without page overflow
    await rahulPage.setViewportSize({ width: 400, height: 900 });
    const overflowMetrics = await rahulPage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflowMetrics.scrollWidth).toBeLessThanOrEqual(
      overflowMetrics.clientWidth + 1
    );

    const questsBtn = rahulPage.getByRole("button", {
      name: "Daily Quests",
    });
    if (await questsBtn.isVisible()) {
      await questsBtn.click();
      await expect(
        rahulPage.locator('[data-testid="daily-quest-panel"]')
      ).toBeVisible();
    }

    const graphBtn = rahulPage.getByRole("button", {
      name: "Knowledge Graph",
    });
    if (await graphBtn.isVisible()) {
      await graphBtn.click();
      await expect(graphNode).toBeVisible();
    }
  });

  // --------------------------------------------------------------------------
  // Behavioral: Reduced Motion Stability & Non-Color Mastery Indicators
  // --------------------------------------------------------------------------
  test("Reduced motion stability and non-color mastery indicators", async ({
    journey,
  }) => {
    await journey.initCanonicalDemo();
    const rahulPage = journey.harness.rahul.page;

    const { lectureId } = await startLecture(
      journey,
      "Motion and Mastery Lecture"
    );
    await ingestTranscript(
      journey,
      lectureId,
      "Backpropagation gradient descent optimization.",
      1
    );

    await rahulPage.goto(
      `/student/${journey.rahul.studentId}?courseId=${journey.courseId}&lectureId=${lectureId}`
    );
    await rahulPage.waitForSelector('g[role="button"][data-node-id]');

    // 1. Toggle reduced motion on the same page
    await rahulPage.emulateMedia({ reducedMotion: "no-preference" });
    await rahulPage.emulateMedia({ reducedMotion: "reduce" });

    // 2. Reduced motion coordinate stability: Vectors y=0, Matrices y=120
    const vectorsNode = rahulPage.locator('g[data-node-id][aria-label*="Vectors"]');
    const matricesNode = rahulPage.locator('g[data-node-id][aria-label*="Matrices"]');

    await expect(vectorsNode).toHaveAttribute("transform", /,\s*0\)/);
    await expect(matricesNode).toHaveAttribute("transform", /,\s*120\)/);

    const transformVectorsBefore = await vectorsNode.getAttribute("transform");
    const transformMatricesBefore = await matricesNode.getAttribute("transform");
    await rahulPage.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const transformVectorsAfter = await vectorsNode.getAttribute("transform");
    const transformMatricesAfter = await matricesNode.getAttribute("transform");
    expect(transformVectorsBefore).toBe(transformVectorsAfter);
    expect(transformMatricesBefore).toBe(transformMatricesAfter);

    // 3. Mascot subtree has no running Web Animations under reduce
    const mascotAnimations = await rahulPage.evaluate(() => {
      const mascot = document.querySelector(
        '[data-testid="spark-mascot-container"]'
      );
      if (!mascot) return 0;
      return document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect)?.target;
        return (
          target &&
          mascot.contains(target) &&
          a.playState === "running"
        );
      }).length;
    });
    expect(mascotAnimations).toBe(0);

    // 4. Accessible names include semantic status and percentage
    // Rahul (red / yellow)
    const rahulStar = rahulPage
      .locator('g[role="button"][data-node-id]')
      .first();
    const rahulLabel = await rahulStar.getAttribute("aria-label");
    expect(rahulLabel).toMatch(
      /(Unassessed|Dim|Lit|Shining|Mastered|Developing|Needs practice|\d+%)/i
    );

    // Hari (green)
    const hariPage = journey.harness.hari.page;
    await hariPage.goto(
      `/student/${journey.hari.studentId}?courseId=${journey.courseId}`
    );
    await hariPage.waitForSelector('g[role="button"][data-node-id]');
    const hariStar = hariPage
      .locator('g[role="button"][data-node-id]')
      .first();
    const hariLabel = await hariStar.getAttribute("aria-label");
    expect(hariLabel).toMatch(
      /(Unassessed|Dim|Lit|Shining|Mastered|Developing|Needs practice|\d+%)/i
    );

    // Vamshi (gray - unstarted / 0%)
    const vamshi = journey.dataset?.students.find(
      (s) => s.name === "Vamshi"
    );
    if (vamshi) {
      const vamshiContext = await rahulPage
        .context()
        .browser()!
        .newContext();
      const vamshiPage = await vamshiContext.newPage();
      try {
        await signIn(vamshiPage, {
          email: vamshi.email,
          password: DEMO_PASSWORD,
        });
        await vamshiPage.goto(
          `/student/${vamshi.id}?courseId=${journey.courseId}`
        );
        await vamshiPage.waitForSelector('g[role="button"][data-node-id]');
        const vamshiStar = vamshiPage
          .locator('g[role="button"][data-node-id]')
          .first();
        const vamshiLabel = await vamshiStar.getAttribute("aria-label");
        expect(vamshiLabel).toMatch(/(Unassessed|0%)/i);
      } finally {
        await vamshiContext.close();
      }
    }
  });
});
