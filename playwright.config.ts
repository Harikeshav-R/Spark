// playwright.config.ts
/**
 * Playwright Test Configuration
 * Supports multi-context browser journeys (Teacher, Student Hari, Student Rahul)
 * as specified in docs/04-build-plan.md (P0-D-01 & P7-D-01) and docs/11-testing.md.
 */

export interface PlaywrightProjectConfig {
  name: string;
  use: {
    browserName?: "chromium" | "firefox" | "webkit";
    viewport?: { width: number; height: number };
    headless?: boolean;
    ignoreHTTPSErrors?: boolean;
    video?: "on" | "off" | "retain-on-failure" | "on-first-retry";
    trace?: "on" | "off" | "retain-on-failure" | "on-first-retry";
    screenshot?: "on" | "off" | "only-on-failure";
    [key: string]: unknown;
  };
}

export interface PlaywrightTestConfig {
  testDir: string;
  timeout: number;
  expect: {
    timeout: number;
  };
  fullyParallel: boolean;
  forbidOnly: boolean;
  retries: number;
  workers?: number;
  reporter: ("list" | "html" | "json" | [string, Record<string, unknown>])[];
  use: {
    baseURL: string;
    trace: "on" | "off" | "retain-on-failure" | "on-first-retry";
    screenshot: "on" | "off" | "only-on-failure";
    video: "on" | "off" | "retain-on-failure" | "on-first-retry";
    actionTimeout?: number;
    navigationTimeout?: number;
  };
  projects: PlaywrightProjectConfig[];
  webServer?: {
    command: string;
    url: string;
    reuseExistingServer: boolean;
    timeout: number;
  };
}

export const config: PlaywrightTestConfig = {
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list", {}],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "webkit",
      use: {
        browserName: "webkit",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "multi-context-classroom",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
};

export default config;
