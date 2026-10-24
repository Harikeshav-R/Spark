import { describe, it, expect } from "vitest";
import { config } from "../../../playwright.config.js";
import {
  DEFAULT_MULTI_CONTEXT_ACTORS,
  getActorAuthHeaders,
  assertActorIsolation,
} from "../../e2e/harness.js";

describe("Lane D: Playwright Multi-Context Test Harness Setup (P0-D-01)", () => {
  describe("1. Playwright Configuration", () => {
    it("targets tests/e2e directory with appropriate timeouts", () => {
      expect(config.testDir).toBe("./tests/e2e");
      expect(config.timeout).toBeGreaterThanOrEqual(30000);
      expect(config.expect.timeout).toBeGreaterThanOrEqual(5000);
    });

    it("configures isolated multi-browser projects including multi-context classroom", () => {
      const projectNames = config.projects.map((p) => p.name);
      expect(projectNames).toContain("chromium");
      expect(projectNames).toContain("firefox");
      expect(projectNames).toContain("webkit");
      expect(projectNames).toContain("multi-context-classroom");
    });

    it("configures webServer for local application execution", () => {
      expect(config.webServer).toBeDefined();
      expect(config.webServer?.url).toBe("http://localhost:3000");
      expect(config.webServer?.command).toBe("npm run dev");
    });
  });

  describe("2. Multi-Context Harness & Actor Isolation", () => {
    it("defines distinct test actors for Teacher, Student Hari, and Student Rahul", () => {
      const { teacher, studentHari, studentRahul } = DEFAULT_MULTI_CONTEXT_ACTORS;

      expect(teacher.role).toBe("teacher");
      expect(studentHari.role).toBe("student");
      expect(studentRahul.role).toBe("student");

      // Invariant: User IDs and tokens must be strictly isolated
      expect(teacher.userId).not.toBe(studentHari.userId);
      expect(teacher.userId).not.toBe(studentRahul.userId);
      expect(studentHari.userId).not.toBe(studentRahul.userId);

      expect(teacher.token).not.toBe(studentHari.token);
      expect(studentHari.token).not.toBe(studentRahul.token);
    });

    it("generates verified actor auth headers", () => {
      const headers = getActorAuthHeaders(DEFAULT_MULTI_CONTEXT_ACTORS.teacher);
      expect(headers.Authorization).toBe("Bearer mock-teacher-jwt-andrew-ng");
      expect(headers["X-Actor-Role"]).toBe("teacher");
      expect(headers["X-Actor-Id"]).toBe(DEFAULT_MULTI_CONTEXT_ACTORS.teacher.userId);
    });

    it("enforces actor isolation and throws if two contexts share identity", () => {
      expect(
        assertActorIsolation(
          DEFAULT_MULTI_CONTEXT_ACTORS.teacher,
          DEFAULT_MULTI_CONTEXT_ACTORS.studentHari
        )
      ).toBe(true);

      // Throws if user IDs match
      expect(() =>
        assertActorIsolation(DEFAULT_MULTI_CONTEXT_ACTORS.teacher, {
          ...DEFAULT_MULTI_CONTEXT_ACTORS.studentHari,
          userId: DEFAULT_MULTI_CONTEXT_ACTORS.teacher.userId,
        })
      ).toThrow(/Actor isolation violation/);

      // Throws if tokens match
      expect(() =>
        assertActorIsolation(DEFAULT_MULTI_CONTEXT_ACTORS.studentHari, {
          ...DEFAULT_MULTI_CONTEXT_ACTORS.studentRahul,
          token: DEFAULT_MULTI_CONTEXT_ACTORS.studentHari.token,
        })
      ).toThrow(/Actor isolation violation/);
    });
  });
});
