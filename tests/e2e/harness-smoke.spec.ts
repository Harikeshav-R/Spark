import { test, expect } from "@playwright/test";
import { createMultiUserHarness } from "./helpers/multi-context.js";

test.describe("Playwright Multi-Context Harness Smoke", () => {
  test("initializes isolated contexts for Teacher, Hari, and Rahul", async ({ browser }) => {
    const harness = await createMultiUserHarness(browser);

    try {
      expect(harness.teacher.role).toBe("teacher");
      expect(harness.teacher.name).toBe("Professor");
      expect(harness.teacher.page).toBeDefined();

      expect(harness.hari.role).toBe("student");
      expect(harness.hari.name).toBe("Hari");
      expect(harness.hari.page).toBeDefined();

      expect(harness.rahul.role).toBe("student");
      expect(harness.rahul.name).toBe("Rahul");
      expect(harness.rahul.page).toBeDefined();

      // Ensure contexts are distinct instances
      expect(harness.teacher.context).not.toBe(harness.hari.context);
      expect(harness.hari.context).not.toBe(harness.rahul.context);
      expect(harness.teacher.context).not.toBe(harness.rahul.context);
    } finally {
      await harness.closeAll();
    }
  });
});
