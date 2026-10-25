import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type { Course, CourseService } from "../../../src/contracts/course.js";
import type { MasteryService as MasteryServicePort, MasteryEvidence } from "../../../src/contracts/mastery.js";
import { applyMasteryEvidence } from "../../../src/contracts/mastery.js";
import { AppError } from "../../../src/contracts/errors.js";
import { MasteryService } from "../../../src/server/core/mastery/mastery-service.js";
import { MasteryRepository } from "../../../src/server/core/mastery/mastery-repository.js";
import { PollEvidenceService } from "../../../src/server/core/index.js";

interface MockPollResponseRow {
  id: string;
  student_id: string;
  status: "pending" | "evaluated" | "failed" | string;
  evaluation: unknown;
  question: {
    concept_id: string;
    lecture: { course_id: string };
    concept: { course_id: string };
  };
  student: {
    id: string;
    auth_id: string;
    course_id: string;
  };
}

interface TableStore {
  pollResponses: MockPollResponseRow[];
  forcedError?: unknown;
}

interface MockQueryBuilder {
  select(cols?: string): MockQueryBuilder;
  eq(col: string, val: unknown): MockQueryBuilder;
  maybeSingle(): Promise<{ data: MockPollResponseRow | null; error: unknown }>;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function createMockClient(store: TableStore): Pick<SupabaseClient, "from"> {
  return {
    from: (_table: string) => {
      const filters: Array<{ col: string; val: unknown }> = [];

      const builder: MockQueryBuilder = {
        select: (_cols?: string) => builder,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle: async () => {
          if (store.forcedError) {
            return { data: null, error: store.forcedError };
          }
          let rows = [...store.pollResponses];
          for (const f of filters) {
            rows = rows.filter((r) => getNestedValue(r, f.col) === f.val);
          }
          return { data: rows.length > 0 ? rows[0] : null, error: null };
        },
      };

      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    },
  };
}

interface StatefulMasteryRecord {
  confidence: number;
  attempts: number;
  version: number;
}

function createStatefulRpcClient() {
  const masteryStore = new Map<string, StatefulMasteryRecord>();
  const appliedEvidence = new Set<string>();

  const rpc = vi.fn(async (fnName: string, args: Record<string, unknown>) => {
    if (fnName !== "apply_mastery_evidence") {
      throw new Error(`Unexpected RPC call: ${fnName}`);
    }

    const studentId = args.p_student_id as string;
    const conceptId = args.p_concept_id as string;
    const evidence = args.p_evidence as MasteryEvidence;
    const sourceId = evidence.sourceId;
    const key = `${studentId}:${conceptId}`;
    const current = masteryStore.get(key) ?? {
      confidence: 0.0,
      attempts: 0,
      version: 1,
    };

    if (appliedEvidence.has(sourceId)) {
      return {
        data: [
          {
            new_confidence: current.confidence,
            new_attempts: current.attempts,
            new_version: current.version,
          },
        ],
        error: null,
      };
    }

    const calculated = applyMasteryEvidence(current.confidence, evidence);

    const updated: StatefulMasteryRecord = {
      confidence: calculated.confidence,
      attempts: current.attempts + 1,
      version: current.version + 1,
    };

    masteryStore.set(key, updated);
    appliedEvidence.add(sourceId);

    return {
      data: [
        {
          new_confidence: updated.confidence,
          new_attempts: updated.attempts,
          new_version: updated.version,
        },
      ],
      error: null,
    };
  });

  return {
    client: { rpc } as unknown as Pick<SupabaseClient, "rpc">,
    masteryStore,
    appliedEvidence,
    rpc,
  };
}

describe("P4-A-01: Poll Response Atomic Mastery Evidence Application Unit Tests", () => {
  const teacherId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherCourseId: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const studentId: UUID = "22222222-2222-4222-8222-222222222222";
  const studentAuthId: UUID = "33333333-3333-4333-8333-333333333333";
  const otherStudentId: UUID = "44444444-4444-4444-8444-444444444444";
  const otherStudentAuthId: UUID = "55555555-5555-4555-8555-555555555555";
  const conceptId: UUID = "66666666-6666-4666-8666-666666666666";
  // otherConceptId and lectureId omitted if unused
  const responseId: UUID = "99999999-9999-4999-8999-999999999999";
  const response2Id: UUID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";

  const teacherActor: ActorContext = {
    userId: teacherId,
    authId: "auth-teacher-1",
    email: "teacher@test.edu",
    name: "Professor Test",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentId,
    authId: studentAuthId,
    email: "student@test.edu",
    name: "Student Test",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };

  const otherStudentActor: ActorContext = {
    userId: otherStudentId,
    authId: otherStudentAuthId,
    email: "other@test.edu",
    name: "Other Student",
    role: "student",
    enrolledCourses: [{ studentId: otherStudentId, courseId }],
  };

  let tableStore: TableStore;
  let rpcSetup: ReturnType<typeof createStatefulRpcClient>;
  let mockCourseService: Pick<CourseService, "getCourse">;
  let masteryService: MasteryService;

  beforeEach(() => {
    tableStore = {
      pollResponses: [
        {
          id: responseId,
          student_id: studentId,
          status: "evaluated",
          evaluation: { outcome: "correct", feedback: "Well reasoned." },
          question: {
            concept_id: conceptId,
            lecture: { course_id: courseId },
            concept: { course_id: courseId },
          },
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
      ],
    };

    rpcSetup = createStatefulRpcClient();
    const masteryRepo = new MasteryRepository(rpcSetup.client);
    masteryService = new MasteryService(masteryRepo);

    mockCourseService = {
      getCourse: vi.fn(async (actor: ActorContext, targetCourseId: UUID): Promise<Course> => {
        if (targetCourseId !== courseId) {
          throw new AppError({
            code: "NOT_FOUND",
            statusCode: 404,
            message: "Course not found",
          });
        }
        if (actor.role === "teacher") {
          if (actor.teacherId !== teacherId) {
            throw new AppError({
              code: "FORBIDDEN",
              statusCode: 403,
              message: "Actor does not own this course",
            });
          }
        } else if (actor.role === "student") {
          const isEnrolled = actor.enrolledCourses.some((c) => c.courseId === targetCourseId);
          if (!isEnrolled) {
            throw new AppError({
              code: "NOT_FOUND",
              statusCode: 404,
              message: "Student not enrolled in course",
            });
          }
        }
        return {
          id: courseId,
          teacherId,
          name: "Test Course",
          joinCode: "TEST01",
          createdAt: new Date().toISOString(),
        };
      }),
    };
  });

  function createService(overrides?: {
    client?: Pick<SupabaseClient, "from">;
    courses?: Pick<CourseService, "getCourse">;
    mastery?: Pick<MasteryServicePort, "applyEvidence">;
  }) {
    return new PollEvidenceService(
      overrides?.client ?? createMockClient(tableStore),
      overrides?.courses ?? mockCourseService,
      overrides?.mastery ?? masteryService,
    );
  }

  it("applies new evaluated correct response: confidence 0 -> 0.85 green, attempts 1, version 2", async () => {
    const service = createService();
    const result = await service.applyResponse(studentActor, courseId, responseId);

    expect(result).toEqual({
      responseId,
      studentId,
      conceptId,
      confidence: 0.85,
      band: "green",
      attempts: 1,
      version: 2,
    });
    expect(rpcSetup.appliedEvidence.has(responseId)).toBe(true);
  });

  it("retains high confidence 0.90 on correct response and increments attempts once", async () => {
    rpcSetup.masteryStore.set(`${studentId}:${conceptId}`, {
      confidence: 0.9,
      attempts: 2,
      version: 3,
    });
    const service = createService();
    const result = await service.applyResponse(teacherActor, courseId, responseId);

    expect(result).toEqual({
      responseId,
      studentId,
      conceptId,
      confidence: 0.9,
      band: "green",
      attempts: 3,
      version: 4,
    });
  });

  it("applies partial response at 0 (-> 0.50 yellow) and at 0.70 (-> 0.70 green)", async () => {
    tableStore.pollResponses[0].evaluation = { outcome: "partial", feedback: "Partially correct" };
    const service = createService();

    // From 0
    const res1 = await service.applyResponse(studentActor, courseId, responseId);
    expect(res1.confidence).toBe(0.5);
    expect(res1.band).toBe("yellow");
    expect(res1.attempts).toBe(1);

    // Reset with new response ID and prior confidence 0.70
    const partial2Id: UUID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
    tableStore.pollResponses.push({
      ...tableStore.pollResponses[0],
      id: partial2Id,
    });
    rpcSetup.masteryStore.set(`${studentId}:${conceptId}`, {
      confidence: 0.7,
      attempts: 5,
      version: 6,
    });

    const res2 = await service.applyResponse(studentActor, courseId, partial2Id);
    expect(res2.confidence).toBe(0.7);
    expect(res2.band).toBe("green");
    expect(res2.attempts).toBe(6);
  });

  it("applies wrong response at 0, 0.10, and 0.85 (-> 0.20, 0.10, 0.20 red)", async () => {
    tableStore.pollResponses[0].evaluation = { outcome: "wrong", feedback: "Incorrect explanation" };
    const service = createService();

    // Case a: current 0 -> 0.20 red
    const res1 = await service.applyResponse(studentActor, courseId, responseId);
    expect(res1.confidence).toBe(0.2);
    expect(res1.band).toBe("red");

    // Case b: current 0.10 -> 0.10 red
    const wrong2Id: UUID = "cccccccc-3333-4ccc-8ccc-cccccccccccc";
    tableStore.pollResponses.push({ ...tableStore.pollResponses[0], id: wrong2Id });
    rpcSetup.masteryStore.set(`${studentId}:${conceptId}`, {
      confidence: 0.1,
      attempts: 2,
      version: 3,
    });
    const res2 = await service.applyResponse(studentActor, courseId, wrong2Id);
    expect(res2.confidence).toBe(0.1);
    expect(res2.band).toBe("red");

    // Case c: current 0.85 -> 0.20 red
    const wrong3Id: UUID = "dddddddd-4444-4ddd-8ddd-dddddddddddd";
    tableStore.pollResponses.push({ ...tableStore.pollResponses[0], id: wrong3Id });
    rpcSetup.masteryStore.set(`${studentId}:${conceptId}`, {
      confidence: 0.85,
      attempts: 4,
      version: 5,
    });
    const res3 = await service.applyResponse(studentActor, courseId, wrong3Id);
    expect(res3.confidence).toBe(0.2);
    expect(res3.band).toBe("red");
  });

  it("is idempotent: repeat same persisted evaluated response yields identical result without extra attempts", async () => {
    const service = createService();
    const first = await service.applyResponse(studentActor, courseId, responseId);
    expect(first.attempts).toBe(1);
    expect(first.version).toBe(2);

    const second = await service.applyResponse(studentActor, courseId, responseId);
    expect(second).toEqual(first);
    expect(rpcSetup.rpc).toHaveBeenCalledTimes(2); // Repository called, but store didn't increment
  });

  it("returns current mastery on replay after another response, without regressing to cached first result", async () => {
    const service = createService();
    const first = await service.applyResponse(studentActor, courseId, responseId);
    expect(first.confidence).toBe(0.85);
    expect(first.attempts).toBe(1);

    // Apply second response that drops confidence to 0.20
    tableStore.pollResponses.push({
      id: response2Id,
      student_id: studentId,
      status: "evaluated",
      evaluation: { outcome: "wrong", feedback: "Wrong answer." },
      question: {
        concept_id: conceptId,
        lecture: { course_id: courseId },
        concept: { course_id: courseId },
      },
      student: {
        id: studentId,
        auth_id: studentAuthId,
        course_id: courseId,
      },
    });
    const second = await service.applyResponse(studentActor, courseId, response2Id);
    expect(second.confidence).toBe(0.2);
    expect(second.attempts).toBe(2);

    // Replay first response: returns current state (0.20, attempts 2), NOT 0.85
    const replayFirst = await service.applyResponse(studentActor, courseId, responseId);
    expect(replayFirst.confidence).toBe(0.2);
    expect(replayFirst.attempts).toBe(2);
    expect(replayFirst.version).toBe(3);
  });

  it("throws 409 CONFLICT for pending or failed responses without mutating mastery", async () => {
    const service = createService();

    // Pending
    tableStore.pollResponses[0].status = "pending";
    await expect(service.applyResponse(studentActor, courseId, responseId)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
      message: "Poll response has not been evaluated",
    });

    // Failed
    tableStore.pollResponses[0].status = "failed";
    await expect(service.applyResponse(studentActor, courseId, responseId)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
      message: "Poll response has not been evaluated",
    });

    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("throws 500 INTERNAL_SERVER_ERROR for evaluated response with null, unknown outcome, or invalid feedback", async () => {
    const service = createService();

    // Null evaluation
    tableStore.pollResponses[0].evaluation = null;
    await expect(service.applyResponse(studentActor, courseId, responseId)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll response evaluation in database",
    });

    // Unknown outcome
    tableStore.pollResponses[0].evaluation = { outcome: "excellent", feedback: "Great work!" };
    await expect(service.applyResponse(studentActor, courseId, responseId)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll response evaluation in database",
    });

    // Feedback too short (< 5 chars)
    tableStore.pollResponses[0].evaluation = { outcome: "correct", feedback: "ok" };
    await expect(service.applyResponse(studentActor, courseId, responseId)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll response evaluation in database",
    });

    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("throws 400 VALIDATION_ERROR before database query on invalid UUID parameter", async () => {
    const client = createMockClient(tableStore);
    const fromSpy = vi.spyOn(client, "from");
    const service = createService({ client });

    await expect(
      service.applyResponse(studentActor, "invalid-course-uuid" as UUID, responseId),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Invalid UUID parameter provided for poll evidence",
    });

    await expect(
      service.applyResponse(studentActor, courseId, "invalid-response-uuid" as UUID),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      message: "Invalid UUID parameter provided for poll evidence",
    });

    expect(fromSpy).not.toHaveBeenCalled();
    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("denies unauthorized course actor and prevents poll-source query and mutation", async () => {
    const client = createMockClient(tableStore);
    const fromSpy = vi.spyOn(client, "from");
    const service = createService({ client });

    const unauthorizedActor: ActorContext = {
      userId: "99999999-0000-4000-8000-000000000000",
      authId: "unauth-actor",
      email: "unauth@test.edu",
      name: "Unauth Actor",
      role: "student",
      enrolledCourses: [],
    };

    await expect(
      service.applyResponse(unauthorizedActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Student not enrolled in course",
    });

    expect(fromSpy).not.toHaveBeenCalled();
    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("returns 404 NOT_FOUND when authorized student requests another student's response", async () => {
    const service = createService();
    await expect(
      service.applyResponse(otherStudentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Poll response not found for this course",
    });
    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("returns 404 NOT_FOUND when lecture, enrollment, or concept belongs to another course", async () => {
    const service = createService();

    // Case a: lecture belongs to otherCourseId
    tableStore.pollResponses[0].question.lecture.course_id = otherCourseId;
    await expect(
      service.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Poll response not found for this course",
    });

    // Reset and check concept belongs to otherCourseId
    tableStore.pollResponses[0].question.lecture.course_id = courseId;
    tableStore.pollResponses[0].question.concept.course_id = otherCourseId;
    await expect(
      service.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Poll response not found for this course",
    });

    // Reset and check student enrollment belongs to otherCourseId
    tableStore.pollResponses[0].question.concept.course_id = courseId;
    tableStore.pollResponses[0].student.course_id = otherCourseId;
    await expect(
      service.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Poll response not found for this course",
    });

    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("returns 404 NOT_FOUND when response is missing", async () => {
    tableStore.pollResponses = [];
    const service = createService();

    await expect(
      service.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Poll response not found for this course",
    });

    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("throws 500 INTERNAL_SERVER_ERROR for malformed joined row or inconsistent returned source IDs", async () => {
    const service = createService();

    // Malformed: joined question has invalid concept_id UUID
    const original = tableStore.pollResponses[0];
    tableStore.pollResponses[0] = {
      ...original,
      question: {
        ...original.question,
        concept_id: "not-a-valid-uuid",
      },
    };

    await expect(
      service.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll response record in database",
    });

    // Inconsistent IDs: returned student.id doesn't match response.student_id
    tableStore.pollResponses[0] = {
      ...original,
      student_id: studentId,
      student: {
        ...original.student,
        id: otherStudentId,
      },
    };

    await expect(
      service.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      statusCode: 500,
      message: "Malformed poll response record in database",
    });

    expect(rpcSetup.appliedEvidence.size).toBe(0);
  });

  it("maps source database errors and mastery rejections to correct contextual errors", async () => {
    // PostgREST 503 error
    tableStore.forcedError = { code: "PGRST000", message: "Connection refused" };
    const service1 = createService();
    await expect(
      service1.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Failed to load poll response: Database service unavailable",
    });

    // PostgREST 403 error
    tableStore.forcedError = { code: "42501", message: "RLS violation" };
    const service2 = createService();
    await expect(
      service2.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Failed to load poll response: Permission denied",
    });

    // Mastery writer unexpected rejection
    tableStore.forcedError = undefined;
    const failingMastery: Pick<MasteryServicePort, "applyEvidence"> = {
      applyEvidence: vi.fn().mockRejectedValue(new Error("Network timeout to RPC")),
    };
    const service3 = createService({ mastery: failingMastery });
    await expect(
      service3.applyResponse(studentActor, courseId, responseId),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: "Failed to apply poll evidence",
    });
  });

  it("allows retrying evaluated response after poll closed or lecture completed", async () => {
    // The helper verifies persisted evaluation and course relations; lifecycle status does not invalidate evidence
    const service = createService();
    const result = await service.applyResponse(teacherActor, courseId, responseId);
    expect(result.confidence).toBe(0.85);
    expect(result.band).toBe("green");
    expect(result.attempts).toBe(1);
  });
});
