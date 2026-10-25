import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "../../../server/index";
import * as contracts from "../../../src/contracts/index";

describe("P0-A-01: Toolchain & Skeleton Verification", () => {
  const rootDir = process.cwd();

  const requiredDirectories = [
    "server",
    "src/contracts",
    "src/server/platform",
    "src/server/core",
    "src/server/classroom",
    "src/server/realtime",
    "src/server/zoom",
    "src/server/study-groups",
    "src/server/ai",
    "src/server/learning",
    "src/features/auth",
    "src/features/courses",
    "src/features/professor",
    "src/features/student",
    "src/features/graph",
    "src/features/tutor",
    "src/features/learning",
    "src/features/study-groups",
    "src/components/ui",
    "src/lib/client",
    "src/app",
    "supabase/migrations",
    "scripts",
    "tests/unit/lane-a",
    "tests/unit/lane-b",
    "tests/unit/lane-c",
    "tests/unit/lane-d",
    "tests/contracts/lane-a",
    "tests/contracts/lane-b",
    "tests/contracts/lane-c",
    "tests/contracts/lane-d",
    "tests/integration/lane-a",
    "tests/integration/lane-b",
    "tests/integration/lane-c",
    "tests/e2e",
  ];

  it("should have all architectural directories present in repository skeleton", () => {
    for (const dir of requiredDirectories) {
      const fullPath = path.join(rootDir, dir);
      expect(fs.existsSync(fullPath), `Directory missing: ${dir}`).toBe(true);
    }
  });

  it("should export composition root from server/index.ts", () => {
    expect(createServer).toBeDefined();
    expect(typeof createServer).toBe("function");
  });

  it("should export shared contracts from src/contracts/index.ts", () => {
    expect(contracts).toBeDefined();
  });
});
