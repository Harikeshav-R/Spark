import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type { ConceptNode, ConceptEdge } from "../../../src/contracts/course.js";
import { DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  GenerateLearningPageAi,
  fixtureGenerateLearningPage,
} from "../../../src/server/ai/index.js";
import {
  LearningPageRepository,
  LearningPageService,
} from "../../../src/server/learning/index.js";

describe("P5-C-02: LearningPageService & Repository Integration Tests", () => {
  const teacherId: UUID = "11111111-1111-4111-8111-111111111111";
  const studentId: UUID = "22222222-2222-4222-8222-222222222222";
  const unenrolledStudentId: UUID = "33333333-3333-4333-8333-333333333333";
  const courseId: UUID = "44444444-4444-4444-8444-444444444444";

  const nodeAId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const nodeBId: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const nodeCId: UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const nodeDId: UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const nodeEId: UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const absentConceptId: UUID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  const teacherActor: ActorContext = {
    userId: teacherId,
    authId: teacherId,
    email: "teacher@university.test",
    name: "Teacher Ada",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentId,
    authId: studentId,
    email: "student@university.test",
    name: "Student Grace",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };

  const unenrolledStudentActor: ActorContext = {
    userId: unenrolledStudentId,
    authId: unenrolledStudentId,
    email: "other@university.test",
    name: "Unenrolled Student",
    role: "student",
    enrolledCourses: [],
  };

  const nodes: ConceptNode[] = [
    {
      id: nodeAId,
      courseId,
      label: "Linear Algebra",
      description: "Vector spaces and matrix transforms",
      category: "Mathematics",
      difficulty: 1,
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: nodeBId,
      courseId,
      label: "Multivariate Calculus",
      description: "Partial derivatives and gradients",
      category: "Mathematics",
      difficulty: 2,
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: nodeCId,
      courseId,
      label: "Loss Functions",
      description: "Formulating scalar loss surfaces",
      category: "Optimization",
      difficulty: 2,
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: nodeDId,
      courseId,
      label: "Gradient Descent",
      description: "Iterative parameter optimization via negative gradient steps",
      category: "Optimization",
      difficulty: 3,
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: nodeEId,
      courseId,
      label: "Backpropagation",
      description: "Chain rule gradient propagation through computation graphs",
      category: "Deep Learning",
      difficulty: 4,
      createdAt: "2026-10-20T12:00:00.000Z",
    },
  ];

  // Diamond prerequisite graph:
  // A -> B -> D
  // A -> C -> D
  // D -> E
  const edges: ConceptEdge[] = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      courseId,
      sourceId: nodeAId,
      targetId: nodeBId,
      relationship: "prerequisite",
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      courseId,
      sourceId: nodeAId,
      targetId: nodeCId,
      relationship: "prerequisite",
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      courseId,
      sourceId: nodeBId,
      targetId: nodeDId,
      relationship: "prerequisite",
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      courseId,
      sourceId: nodeCId,
      targetId: nodeDId,
      relationship: "prerequisite",
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      courseId,
      sourceId: nodeDId,
      targetId: nodeEId,
      relationship: "prerequisite",
      createdAt: "2026-10-20T12:00:00.000Z",
    },
  ];

  let pageStore: Map<string, Record<string, unknown>>;
  let topologyMock: { getTopology: Mock };
  function createMockDbClient(options?: {
    failSelect?: boolean;
    failInsert?: boolean;
    duplicateNoWinner?: boolean;
  }) {
    return {
      from: (table: string) => {
        if (table !== "concept_learning_pages") {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                if (options?.failSelect) {
                  throw new Error("DB connection failure");
                }
                const row = pageStore.get(val);
                return { data: row ? { ...row } : null, error: null };
              },
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: (_cols?: string) => ({
              single: async () => {
                if (options?.failInsert) {
                  throw new Error("DB insert connection failure");
                }
                const conceptKey = String(row.concept_id);
                if (pageStore.has(conceptKey)) {
                  if (options?.duplicateNoWinner) {
                    pageStore.delete(conceptKey);
                  }
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message: "duplicate key value violates unique constraint",
                    },
                  };
                }
                const created = {
                  id: "99999999-9999-4999-8999-999999999999",
                  concept_id: row.concept_id,
                  content: row.content,
                  created_at: new Date().toISOString(),
                };
                pageStore.set(conceptKey, created);
                return { data: { ...created }, error: null };
              },
            }),
          }),
        };
      },
    };
  }

  beforeEach(() => {
    pageStore = new Map();
    topologyMock = {
      getTopology: vi.fn().mockImplementation(async (actor: ActorContext, cId: UUID) => {
        if (cId !== courseId) {
          throw new Error("Course not found");
        }
        if (actor.role === "teacher" && actor.userId !== teacherId) {
          throw new Error("Unauthorized teacher");
        }
        if (
          actor.role === "student" &&
          !actor.enrolledCourses.some((c) => c.courseId === cId)
        ) {
          throw new Error("Student not enrolled");
        }
        return { nodes, edges };
      }),
    };
  });

  it("1. Generates on cache miss, caches in repository, and reuses cache on second read without calling AI", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);
    const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const realAi = new GenerateLearningPageAi(aiClient);

    const generateSpy = vi.spyOn(realAi, "generateLearningPage");

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: realAi,
    });

    // 1st call: Cache miss -> calls AI -> inserts into DB
    const firstResult = await service.getLearningPage(studentActor, nodeDId);
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(firstResult).toContain("## Formal Definition");
    expect(firstResult).toContain("Gradient Descent");
    expect(pageStore.size).toBe(1);

    // 2nd call: Recreate service and repository over the SAME database store, but with failing AI
    const failingAi = {
      generateLearningPage: vi.fn().mockRejectedValue(new Error("AI should not be called")),
    };
    const cachedService = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository: new LearningPageRepository(dbClient),
      ai: failingAi,
    });

    const secondResult = await cachedService.getLearningPage(studentActor, nodeDId);
    expect(failingAi.generateLearningPage).not.toHaveBeenCalled();
    expect(secondResult).toBe(firstResult);

    const teacherResult = await cachedService.getLearningPage(teacherActor, nodeDId);
    expect(teacherResult).toBe(firstResult);
  });

  it("2. Handles concurrent cache misses via unique insert 23505 race arbitration, returning single winner", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);

    let callCount = 0;
    const varyingAi = {
      generateLearningPage: vi.fn().mockImplementation(async (concept: ConceptNode) => {
        callCount++;
        // Both return valid content >= 500 chars
        return `# ${concept.label}\n\n## Formal Definition\nVersion ${callCount} ` + "valid content text ".repeat(30);
      }),
    };

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: varyingAi,
    });

    // Run two concurrent requests on cold cache
    const [res1, res2] = await Promise.all([
      service.getLearningPage(studentActor, nodeDId),
      service.getLearningPage(studentActor, nodeDId),
    ]);

    // Both callers receive the exact same persisted winner
    expect(res1).toBe(res2);
    expect(pageStore.size).toBe(1);
  });

  it("3. Enforces course authorization before cache/AI access, even when cache is already populated", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);

    // Pre-populate cache
    const validContent = "# Pre-cached guide\n\n## Formal Definition\n" + "valid content ".repeat(40);
    pageStore.set(nodeDId, {
      id: "99999999-9999-4999-8999-999999999999",
      concept_id: nodeDId,
      content: validContent,
      created_at: new Date().toISOString(),
    });

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: { generateLearningPage: vi.fn() },
    });

    // Unenrolled student throws
    await expect(service.getLearningPage(unenrolledStudentActor, nodeDId)).rejects.toThrow(
      "Student not enrolled"
    );
  });

  it("4. Returns 404 NOT_FOUND for concept not belonging to the authorized course", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);
    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: { generateLearningPage: vi.fn() },
    });

    await expect(service.getLearningPage(studentActor, absentConceptId)).rejects.toMatchObject({
      code: DomainErrorCode.NOT_FOUND,
      statusCode: 404,
      message: "Concept not found in authorized course",
    });

    expect(pageStore.size).toBe(0);
  });

  it("5. Does not block students based on mastery status (unmastered prerequisite does not gate access)", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);
    const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const realAi = new GenerateLearningPageAi(aiClient);

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: realAi,
    });

    // Student can access advanced concept (nodeEId) without having mastered prereqs
    const result = await service.getLearningPage(studentActor, nodeEId);
    expect(result.length).toBeGreaterThanOrEqual(500);
    expect(result).toContain("Backpropagation");
  });

  it("6. Traverses diamond prerequisite DAG collecting unique transitive ancestors sorted deterministically", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);

    let passedAncestors: ConceptNode[] | undefined;
    const capturingAi = {
      generateLearningPage: vi.fn().mockImplementation(async (concept: ConceptNode, ancestors?: ConceptNode[]) => {
        passedAncestors = ancestors;
        return fixtureGenerateLearningPage(concept).content;
      }),
    };

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: capturingAi,
    });

    // Target is nodeDId (Gradient Descent)
    // Incoming DAG: A -> B -> D and A -> C -> D
    // Descendant is E (D -> E), which should NOT be in ancestors
    // Target D should NOT be in ancestors
    await service.getLearningPage(studentActor, nodeDId);

    expect(passedAncestors).toBeDefined();
    // Transitive ancestors must be [A, B, C]
    expect(passedAncestors!.map((a) => a.id)).toEqual([nodeAId, nodeBId, nodeCId]);
    // Each ancestor included exactly once (no duplicates from diamond)
    expect(passedAncestors!).toHaveLength(3);
    // Descendant E is excluded
    expect(passedAncestors!.some((a) => a.id === nodeEId)).toBe(false);
  });

  it("7. Does not write to DB if AI generation fails", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);
    const failingAi = {
      generateLearningPage: vi.fn().mockRejectedValue(new Error("AI generation error")),
    };

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: failingAi,
    });

    await expect(service.getLearningPage(studentActor, nodeDId)).rejects.toThrow(
      "AI generation error"
    );

    expect(pageStore.size).toBe(0);
  });

  it("8. Propagates 503 when database insert fails", async () => {
    const dbClient = createMockDbClient({ failInsert: true });
    const repository = new LearningPageRepository(dbClient);
    const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const realAi = new GenerateLearningPageAi(aiClient);

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: realAi,
    });

    await expect(service.getLearningPage(studentActor, nodeDId)).rejects.toMatchObject({
      code: DomainErrorCode.SERVICE_UNAVAILABLE,
      statusCode: 503,
      message: "Learning page database service unavailable",
    });
  });

  it("9. Throws 500 when duplicate key 23505 race occurs but existing winner cannot be read", async () => {
    const dbClient = createMockDbClient({ duplicateNoWinner: true });
    const repository = new LearningPageRepository(dbClient);

    // Pre-set in pageStore to trigger duplicate
    pageStore.set(nodeDId, {
      id: "99999999-9999-4999-8999-999999999999",
      concept_id: nodeDId,
      content: "placeholder",
    });

    const validContent = "# Guide\n\n## Formal Definition\n" + "valid content ".repeat(40);
    await expect(repository.insert(nodeDId, validContent)).rejects.toMatchObject({
      code: DomainErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      message: "Duplicate learning page was not found",
    });
  });

  it("10. Throws 500 on malformed stored row in database", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);

    // Insert malformed row with invalid date
    pageStore.set(nodeDId, {
      id: "99999999-9999-4999-8999-999999999999",
      concept_id: nodeDId,
      content: "Valid content ".repeat(40),
      created_at: "not-a-valid-date",
    });

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: { generateLearningPage: vi.fn() },
    });

    await expect(service.getLearningPage(studentActor, nodeDId)).rejects.toMatchObject({
      code: DomainErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      message: "Database returned malformed learning page",
    });
  });

  it("11. Throws 500 on cached content that becomes invalid (<500 chars) after sanitization", async () => {
    const dbClient = createMockDbClient();
    const repository = new LearningPageRepository(dbClient);

    // Insert cached content that passes raw length (600 chars of HTML), but sanitizes to empty
    pageStore.set(nodeDId, {
      id: "99999999-9999-4999-8999-999999999999",
      concept_id: nodeDId,
      content: "<script>alert('bad');</script>".repeat(20),
      created_at: new Date().toISOString(),
    });

    const service = new LearningPageService({
      courseId,
      topology: topologyMock,
      repository,
      ai: { generateLearningPage: vi.fn() },
    });

    await expect(service.getLearningPage(studentActor, nodeDId)).rejects.toMatchObject({
      code: DomainErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      message: "Database returned malformed learning page",
    });
  });
});
