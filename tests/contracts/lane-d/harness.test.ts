import { describe, it, expect } from "vitest";
import playwrightConfig from "../../../playwright.config.js";
import { createMultiUserHarness } from "../../e2e/helpers/multi-context.js";

describe("Lane D: Playwright Multi-Context Harness Configuration (P0-D-01)", () => {
  it("configures Playwright testDir to point to tests/e2e", () => {
    expect(playwrightConfig.testDir).toBe("./tests/e2e");
  });

  it("exports multi-user harness factory supporting isolated contexts", () => {
    expect(typeof createMultiUserHarness).toBe("function");
  });

  it("configures chromium project for desktop e2e browser runs", () => {
    expect(playwrightConfig.projects).toBeDefined();
    const chromium = playwrightConfig.projects?.find((p) => p.name === "chromium");
    expect(chromium).toBeDefined();
  });
});
