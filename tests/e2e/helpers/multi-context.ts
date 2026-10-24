import type { Browser, BrowserContext, Page, BrowserContextOptions } from "@playwright/test";

export interface UserPersonaSession {
  context: BrowserContext;
  page: Page;
  role: "teacher" | "student";
  name: string;
}

export interface MultiUserHarness {
  teacher: UserPersonaSession;
  hari: UserPersonaSession;
  rahul: UserPersonaSession;
  closeAll(): Promise<void>;
}

/**
 * Creates three isolated browser contexts for multi-role Playwright testing:
 * - Teacher (Course Owner / Lecturer)
 * - Hari (Student 1)
 * - Rahul (Student 2)
 *
 * Each context has fully independent cookies, storage, and WebSocket connections.
 */
export async function createMultiUserHarness(
  browser: Browser,
  options: BrowserContextOptions = {}
): Promise<MultiUserHarness> {
  const teacherContext = await browser.newContext({
    ...options,
    userAgent: "HackOHIO-E2E-Teacher",
  });
  const teacherPage = await teacherContext.newPage();

  const hariContext = await browser.newContext({
    ...options,
    userAgent: "HackOHIO-E2E-Student-Hari",
  });
  const hariPage = await hariContext.newPage();

  const rahulContext = await browser.newContext({
    ...options,
    userAgent: "HackOHIO-E2E-Student-Rahul",
  });
  const rahulPage = await rahulContext.newPage();

  const closeAll = async (): Promise<void> => {
    await Promise.allSettled([
      teacherContext.close(),
      hariContext.close(),
      rahulContext.close(),
    ]);
  };

  return {
    teacher: {
      context: teacherContext,
      page: teacherPage,
      role: "teacher",
      name: "Professor",
    },
    hari: {
      context: hariContext,
      page: hariPage,
      role: "student",
      name: "Hari",
    },
    rahul: {
      context: rahulContext,
      page: rahulPage,
      role: "student",
      name: "Rahul",
    },
    closeAll,
  };
}
