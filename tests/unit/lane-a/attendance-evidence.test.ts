import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type { Course, CourseService } from "../../../src/contracts/course.js";
import type { MasteryService } from "../../../src/contracts/mastery.js";
import { applyMasteryEvidence } from "../../../src/contracts/mastery.js";
import { AppError } from "../../../src/contracts/errors.js";
import {
  AttendanceEvidenceService,
  type AttendanceEvidenceResult,
} from "../../../src/server/core/index.js";

interface TableStore {
  lectureSessions: Array<{ id: string; course_id: string; status: string }>;
  transcriptChunks: Array<{ id: string; lecture_id: string }>;
  transcriptConcepts: Array<{ transcript_chunk_id: string; concept_id: string }>;
  students: Array<{ id: string; course_id: string }>;
  conceptNodes: Array<{ id: string; course_id: string }>;
  forcedErrorTable?: string;
  forcedError?: unknown;
}

interface MockQueryBuilder {
  select(cols?: string): MockQueryBuilder;
  eq(col: string, val: unknown): MockQueryBuilder;
  in(col: string, val: readonly unknown[]): MockQueryBuilder;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
  then<TResult1 = { data: Record<string, unknown>[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Record<string, unknown>[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

interface MockDatabaseClient {
  from(table: string): MockQueryBuilder;
}

function createMockClient(store: TableStore): MockDatabaseClient {
  return {
    from: (table: string): MockQueryBuilder => {
      const filters: Array<{ col: string; op: "eq" | "in"; val: unknown }> = [];

      function getFilteredRows(): Record<string, unknown>[] {
        let rows: Record<string, unknown>[] = [];
        if (table === "lecture_sessions") rows = [...store.lectureSessions];
        else if (table === "transcript_chunks") rows = [...store.transcriptChunks];
        else if (table === "transcript_concepts") rows = [...store.transcriptConcepts];
        else if (table === "students") rows = [...store.students];
        else if (table === "concept_nodes") rows = [...store.conceptNodes];

        for (const f of filters) {
          if (f.op === "eq") {
            rows = rows.filter((r) => r[f.col] === f.val);
          } else if (f.op === "in") {
            const set = new Set(Array.isArray(f.val) ? f.val : []);
            rows = rows.filter((r) => set.has(r[f.col]));
          }
        }
        return rows;
      }

      const builder: MockQueryBuilder = {
        select: (_cols?: string) => builder,
        eq: (col: string, val: unknown) => {
          filters.push({ col, op: "eq", val });
          return builder;
        },
        in: (col: string, val: readonly unknown[]) => {
          filters.push({ col, op: "in", val });
          return builder;
        },
        maybeSingle: async () => {
          if (store.forcedErrorTable === table) {
            return { data: null, error: store.forcedError ?? { message: `DB error on ${table}` } };
          }
          const rows = getFilteredRows();
          return { data: rows.length > 0 ? rows[0] : null, error: null };
        },
        then: (onfulfilled, onrejected) => {
          if (store.forcedErrorTable === table) {
            return Promise.resolve({
              data: null,
              error: store.forcedError ?? { message: `DB error on ${table}` },
            }).then(onfulfilled, onrejected);
          }
          const rows = getFilteredRows();
          return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
        },
      };

      return builder;
    },
  };
}

describe("P3-A-01: Attendance Evidence Recording & Verification Unit Tests", () => {
  const teacherId: UUID = "11111111-1111-4111-8111-111111111111";
  const otherTeacherId: UUID = "22222222-2222-4222-8222-222222222222";
  const courseId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherCourseId: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const lectureId: UUID = "33333333-3333-4333-8333-333333333333";
  const chunkId: UUID = "44444444-4444-4444-8444-444444444444";
  const studentAId: UUID = "55555555-5555-4555-8555-555555555555";
  const studentBId: UUID = "66666666-6666-4666-8666-666666666666";
  const concept1Id: UUID = "77777777-7777-4777-8777-777777777777";
  const concept2Id: UUID = "88888888-8888-4888-8888-888888888888";

  const teacherActor: ActorContext = {
    userId: teacherId,
    authId: "auth-teacher-1",
    email: "prof@example.com",
    name: "Professor Turing",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const nonOwnerTeacherActor: ActorContext = {
    userId: otherTeacherId,
    authId: "auth-teacher-2",
    email: "other@example.com",
    name: "Professor Church",
    role: "teacher",
    teacherId: otherTeacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentAId,
    authId: "auth-student-1",
    email: "student@example.com",
    name: "Student Alice",
    role: "student",
    enrolledCourses: [{ studentId: studentAId, courseId }],
  };

  const mockCourse: Course = {
    id: courseId,
    teacherId,
    name: "CS101 Intro to CS",
    joinCode: "CS101JOIN",
    createdAt: "2026-10-20T10:00:00.000Z",
  };

  let store: TableStore;
  let mockClient: MockDatabaseClient;
  let mockCourseService: Pick<CourseService, "getCourse">;
  let masteryStore: Map<string, { confidence: number; attempts: number; version: number }>;
  let mockMasteryService: Pick<MasteryService, "applyEvidence">;
  let service: AttendanceEvidenceService;

  beforeEach(() => {
    store = {
      lectureSessions: [{ id: lectureId, course_id: courseId, status: "live" }],
      transcriptChunks: [{ id: chunkId, lecture_id: lectureId }],
      transcriptConcepts: [{ transcript_chunk_id: chunkId, concept_id: concept1Id }],
      students: [
        { id: studentAId, course_id: courseId },
        { id: studentBId, course_id: courseId },
      ],
      conceptNodes: [
        { id: concept1Id, course_id: courseId },
        { id: concept2Id, course_id: courseId },
      ],
    };

    mockClient = createMockClient(store);

    mockCourseService = {
      getCourse: vi.fn(async (actor: ActorContext, id: UUID) => {
        if (id !== courseId) {
          throw new AppError({
            code: "NOT_FOUND",
            statusCode: 404,
            message: "Course not found",
          });
        }
        return mockCourse;
      }),
    };

    masteryStore = new Map();
    // Pre-populate student A at 0.20, student B at 0.60
    masteryStore.set(`${studentAId}:${concept1Id}`, {
      confidence: 0.2,
      attempts: 2,
      version: 1,
    });
    masteryStore.set(`${studentBId}:${concept1Id}`, {
      confidence: 0.6,
      attempts: 5,
      version: 4,
    });

    mockMasteryService = {
      applyEvidence: vi.fn(async (_actor, studentId, conceptId, evidence) => {
        const key = `${studentId}:${conceptId}`;
        const current = masteryStore.get(key) ?? {
          confidence: 0.0,
          attempts: 0,
          version: 1,
        };
        const next = applyMasteryEvidence(current.confidence, evidence);
        // attendance does NOT increment attempts; version advances by 1
        const updated = {
          confidence: next.confidence,
          attempts: current.attempts,
          version: current.version + 1,
        };
        masteryStore.set(key, updated);
        return {
          confidence: updated.confidence,
          band: next.band,
          attempts: updated.attempts,
          version: updated.version,
        };
      }),
    };

    service = new AttendanceEvidenceService(
      mockClient as unknown as Pick<SupabaseClient, "from">,
      mockCourseService,
      mockMasteryService,
    );
  });

  describe("CP-P3-A-01: Attendance Evidence Verification", () => {
    it("advances confidence at 0.20 to 0.25 and leaves confidence at 0.60 unchanged at 0.60 without incrementing attempts", async () => {
      const results: AttendanceEvidenceResult[] = await service.recordChunkAttendance(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentAId, studentBId],
      );

      expect(results).toHaveLength(2);

      const studentAResult = results.find((r) => r.studentId === studentAId);
      expect(studentAResult).toBeDefined();
      expect(studentAResult?.confidence).toBe(0.25);
      expect(studentAResult?.band).toBe("red");
      expect(studentAResult?.attempts).toBe(2); // Unchanged from baseline
      expect(studentAResult?.version).toBe(2);

      const studentBResult = results.find((r) => r.studentId === studentBId);
      expect(studentBResult).toBeDefined();
      expect(studentBResult?.confidence).toBe(0.6);
      expect(studentBResult?.band).toBe("yellow");
      expect(studentBResult?.attempts).toBe(5); // Unchanged from baseline
      expect(studentBResult?.version).toBe(5);

      // Verify call arguments to mastery service use chunkId as sourceId
      expect(mockMasteryService.applyEvidence).toHaveBeenCalledWith(
        teacherActor,
        studentAId,
        concept1Id,
        { type: "attendance", sourceId: chunkId },
      );
      expect(mockMasteryService.applyEvidence).toHaveBeenCalledWith(
        teacherActor,
        studentBId,
        concept1Id,
        { type: "attendance", sourceId: chunkId },
      );
    });

    it("verifies ceiling boundary: 0.28 becomes 0.30, and 0.30 remains 0.30", async () => {
      masteryStore.set(`${studentAId}:${concept1Id}`, {
        confidence: 0.28,
        attempts: 1,
        version: 1,
      });
      masteryStore.set(`${studentBId}:${concept1Id}`, {
        confidence: 0.3,
        attempts: 3,
        version: 2,
      });

      const results = await service.recordChunkAttendance(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentAId, studentBId],
      );

      const resA = results.find((r) => r.studentId === studentAId);
      expect(resA?.confidence).toBe(0.3);
      expect(resA?.band).toBe("red");
      expect(resA?.attempts).toBe(1);

      const resB = results.find((r) => r.studentId === studentBId);
      expect(resB?.confidence).toBe(0.3);
      expect(resB?.band).toBe("red");
      expect(resB?.attempts).toBe(3);
    });
  });

  describe("Actor Authorization & Ownership Gates", () => {
    it("rejects student actor with 403 FORBIDDEN", async () => {
      await expect(
        service.recordChunkAttendance(studentActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: "FORBIDDEN",
        }),
      );
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });

    it("rejects teacher actor missing teacherId with 403 FORBIDDEN", async () => {
      const invalidTeacher: ActorContext = {
        ...teacherActor,
        teacherId: undefined,
      };
      await expect(
        service.recordChunkAttendance(invalidTeacher, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: "FORBIDDEN",
        }),
      );
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });

    it("rejects non-owning teacher with 403 FORBIDDEN", async () => {
      await expect(
        service.recordChunkAttendance(
          nonOwnerTeacherActor,
          courseId,
          lectureId,
          chunkId,
          [studentAId],
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: "FORBIDDEN",
        }),
      );
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });
  });

  describe("Input & UUID Validation", () => {
    it("rejects malformed courseId with 400 VALIDATION_ERROR", async () => {
      await expect(
        service.recordChunkAttendance(teacherActor, "not-a-uuid" as UUID, lectureId, chunkId, [
          studentAId,
        ]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: "VALIDATION_ERROR",
        }),
      );
    });

    it("rejects malformed lectureId with 400 VALIDATION_ERROR", async () => {
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, "not-a-uuid" as UUID, chunkId, [
          studentAId,
        ]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: "VALIDATION_ERROR",
        }),
      );
    });

    it("rejects malformed chunkId with 400 VALIDATION_ERROR", async () => {
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, "not-a-uuid" as UUID, [
          studentAId,
        ]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: "VALIDATION_ERROR",
        }),
      );
    });

    it("rejects malformed studentId in array with 400 VALIDATION_ERROR", async () => {
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [
          studentAId,
          "invalid-uuid" as UUID,
        ]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: "VALIDATION_ERROR",
        }),
      );
    });
  });

  describe("Lecture & Chunk State Invariants", () => {
    it("rejects non-existent lecture session with 404 NOT_FOUND", async () => {
      store.lectureSessions = [];
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          code: "NOT_FOUND",
        }),
      );
    });

    it("rejects lecture belonging to different course with 404 NOT_FOUND", async () => {
      store.lectureSessions = [{ id: lectureId, course_id: otherCourseId, status: "live" }];
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          code: "NOT_FOUND",
        }),
      );
    });

    it("rejects completed lecture session with 400 BAD_REQUEST", async () => {
      store.lectureSessions = [{ id: lectureId, course_id: courseId, status: "completed" }];
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: "BAD_REQUEST",
          message: "Attendance evidence requires a live lecture",
        }),
      );
    });

    it("rejects non-existent transcript chunk with 404 NOT_FOUND", async () => {
      store.transcriptChunks = [];
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          code: "NOT_FOUND",
        }),
      );
    });

    it("rejects transcript chunk belonging to different lecture with 404 NOT_FOUND", async () => {
      const otherLectureId: UUID = "99999999-9999-4999-8999-999999999999";
      store.transcriptChunks = [{ id: chunkId, lecture_id: otherLectureId }];
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          code: "NOT_FOUND",
        }),
      );
    });
  });

  describe("Concept and Membership Verification", () => {
    it("returns empty array without writes when studentIds array is empty", async () => {
      const results = await service.recordChunkAttendance(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [],
      );
      expect(results).toEqual([]);
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });

    it("returns empty array without writes when chunk has no detected concepts", async () => {
      store.transcriptConcepts = [];
      const results = await service.recordChunkAttendance(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentAId],
      );
      expect(results).toEqual([]);
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });

    it("rejects batch if any student is not enrolled in the course with 403 FORBIDDEN without applying any evidence", async () => {
      const unenrolledStudentId: UUID = "00000000-0000-4000-8000-000000000099";
      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [
          studentAId,
          unenrolledStudentId,
        ]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: "FORBIDDEN",
        }),
      );
      // Strict all-or-nothing: studentA must NOT receive mastery updates
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });

    it("rejects batch if any concept does not belong to the course with 403 FORBIDDEN without applying any evidence", async () => {
      const foreignConceptId: UUID = "99999999-0000-4000-8000-000000000001";
      store.transcriptConcepts.push({ transcript_chunk_id: chunkId, concept_id: foreignConceptId });
      // foreignConceptId is NOT in store.conceptNodes for courseId

      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: "FORBIDDEN",
        }),
      );
      expect(mockMasteryService.applyEvidence).not.toHaveBeenCalled();
    });

    it("deduplicates student IDs so duplicate presence entries do not apply duplicate evidence", async () => {
      const results = await service.recordChunkAttendance(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentAId, studentAId, studentAId],
      );
      expect(results).toHaveLength(1);
      expect(mockMasteryService.applyEvidence).toHaveBeenCalledTimes(1);
    });

    it("applies evidence across cartesian product of verified students and detected concepts", async () => {
      // 2 concepts for this chunk
      store.transcriptConcepts = [
        { transcript_chunk_id: chunkId, concept_id: concept1Id },
        { transcript_chunk_id: chunkId, concept_id: concept2Id },
      ];

      const results = await service.recordChunkAttendance(
        teacherActor,
        courseId,
        lectureId,
        chunkId,
        [studentAId, studentBId],
      );

      // 2 students * 2 concepts = 4 results
      expect(results).toHaveLength(4);
      expect(mockMasteryService.applyEvidence).toHaveBeenCalledTimes(4);
    });
  });

  describe("Error Propagation & Database Failure Handling", () => {
    it("maps database read failure to 500 INTERNAL_SERVER_ERROR", async () => {
      store.forcedErrorTable = "lecture_sessions";
      store.forcedError = { code: "42P01", message: "relation does not exist" };

      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 500,
          code: "INTERNAL_SERVER_ERROR",
        }),
      );
    });

    it("maps database connection failure code PGRST001 to 503 SERVICE_UNAVAILABLE", async () => {
      store.forcedErrorTable = "students";
      store.forcedError = { code: "PGRST001", message: "connection timeout" };

      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [studentAId]),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 503,
          code: "SERVICE_UNAVAILABLE",
        }),
      );
    });

    it("propagates mastery write failures and aborts remaining writes", async () => {
      store.transcriptConcepts = [
        { transcript_chunk_id: chunkId, concept_id: concept1Id },
        { transcript_chunk_id: chunkId, concept_id: concept2Id },
      ];

      vi.mocked(mockMasteryService.applyEvidence).mockRejectedValueOnce(
        new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Write failed",
        }),
      );

      await expect(
        service.recordChunkAttendance(teacherActor, courseId, lectureId, chunkId, [
          studentAId,
          studentBId,
        ]),
      ).rejects.toThrow("Write failed");

      // Aborted after first failure (only 1 call attempted)
      expect(mockMasteryService.applyEvidence).toHaveBeenCalledTimes(1);
    });
  });
});
