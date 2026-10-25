import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT) || 3000;
const baseURL = process.env.APP_ORIGIN || `http://localhost:${port}`;
const shouldStartServer = process.env.PLAYWRIGHT_START_SERVER !== "0";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: shouldStartServer
    ? {
        command: "npx tsx server/index.ts",
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          PORT: String(port),
          NODE_ENV: "development",
          INTEGRATION_MODE: "fixture",
          LECTURE_SOURCE: "simulator",
          DEMO_MODE: "false",
        },
      }
    : undefined,
});
