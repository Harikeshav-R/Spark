/**
 * Playwright Multi-Context Test Harness
 * Lane D Setup (P0-D-01, P7-D-01, docs/11-testing.md)
 *
 * Provides isolated browser contexts for multi-user journey testing:
 * - Teacher Context
 * - Student Hari Context
 * - Student Rahul Context
 *
 * Ensures storage, cookies, and WebSocket state remain strictly isolated between contexts.
 */

export interface TestActorSession {
  userId: string;
  name: string;
  role: "teacher" | "student";
  token: string;
}

export interface IsolatedBrowserContextOptions {
  baseURL?: string;
  viewport?: { width: number; height: number };
  extraHTTPHeaders?: Record<string, string>;
}

export interface MultiContextSessionConfig {
  teacher: TestActorSession;
  studentHari: TestActorSession;
  studentRahul: TestActorSession;
}

export const DEFAULT_MULTI_CONTEXT_ACTORS: MultiContextSessionConfig = {
  teacher: {
    userId: "11111111-1111-4111-8111-111111111111",
    name: "Prof. Andrew Ng",
    role: "teacher",
    token: "mock-teacher-jwt-andrew-ng",
  },
  studentHari: {
    userId: "22222222-2222-4222-8222-222222222222",
    name: "Hari",
    role: "student",
    token: "mock-student-jwt-hari",
  },
  studentRahul: {
    userId: "33333333-3333-4333-8333-333333333333",
    name: "Rahul",
    role: "student",
    token: "mock-student-jwt-rahul",
  },
};

/**
 * Creates configuration headers for an actor context to emulate verified Supabase JWT auth
 */
export function getActorAuthHeaders(actor: TestActorSession): Record<string, string> {
  return {
    Authorization: `Bearer ${actor.token}`,
    "X-Actor-Role": actor.role,
    "X-Actor-Id": actor.userId,
  };
}

/**
 * Validates that two actor sessions do not share identity tokens or IDs
 */
export function assertActorIsolation(
  actorA: TestActorSession,
  actorB: TestActorSession
): boolean {
  if (actorA.userId === actorB.userId) {
    throw new Error(
      `Actor isolation violation: ${actorA.name} and ${actorB.name} share user ID ${actorA.userId}`
    );
  }
  if (actorA.token === actorB.token) {
    throw new Error(
      `Actor isolation violation: ${actorA.name} and ${actorB.name} share authentication token`
    );
  }
  return true;
}
