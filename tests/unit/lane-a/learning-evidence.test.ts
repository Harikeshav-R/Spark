import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type { Course, CourseService } from "../../../src/contracts/course.js";
import type { MasteryEvidence } from "../../../src/contracts/mastery.js";
import { AppError } from "../../../src/contracts/errors.js";
import { MasteryService } from "../../../src/server/core/mastery/mastery-service.js";
import { MasteryRepository } from "../../../src/server/core/mastery/mastery-repository.js";
import { LearningEvidenceService } from "../../../src/server/core/index.js";

interface MockQuizAttemptRow {
  id: string;
  student_id: string;
  concept_id: string;
  score: number;
  correct_count: number;
  total_questions: number;
  student: {
    id: string;
    auth_id: string;
    course_id: string;
  };
  concept: {
    course_id: string;
  };
}

interface MockTutoringMessageRow {
  id: string;
  session_id: string;
  role: string;
  concept_id: string | null;
  understanding_detected: boolean;
  session: {
    id: string;
    student_id: string;
    target_concepts: string[];
    student: {
      id: string;
      auth_id: string;
      course_id: string;
    };
  };
  concept: {
    course_id: string;
  };
}

interface TableStore {
  quizAttempts: MockQuizAttemptRow[];
  tutoringMessages: MockTutoringMessageRow[];
  forcedError?: unknown;
}

interface MockQueryBuilder {
  select(cols?: string): MockQueryBuilder;
  eq(col: string, val: unknown): MockQueryBuilder;
  maybeSingle(): Promise<{ data: unknown | null; error: unknown }>;
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
    from: (table: string) => {
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
          if (table === "quiz_attempts") {
            let rows = [...store.quizAttempts];
            for (const f of filters) {
              rows = rows.filter((r) => getNestedValue(r, f.col) === f.val);
            }
            return { data: rows.length > 0 ? rows[0] : null, error: null };
          }
          if (table === "tutoring_messages") {
            let rows = [...store.tutoringMessages];
            for (const f of filters) {
              rows = rows.filter((r) => getNestedValue(r, f.col) === f.val);
            }
            return { data: rows.length > 0 ? rows[0] : null, error: null };
          }
          return { data: null, error: null };
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

interface AuditRecord {
  studentId: string;
  conceptId: string;
  evidenceType: string;
  sourceId: string;
  priorConfidence: number;
  newConfidence: number;
}

function createStatefulRpcClient() {
  const masteryStore = new Map<string, StatefulMasteryRecord>();
  const appliedEvidence = new Set<string>();
  const auditLog: AuditRecord[] = [];

  const rpc = vi.fn(async (fnName: string, args: Record<string, unknown>) => {
    if (fnName !== "apply_mastery_evidence") {
      throw new Error(`Unexpected RPC call: ${fnName}`);
    }

    const studentId = args.p_student_id as string;
    const conceptId = args.p_concept_id as string;
    const evidence = args.p_evidence as MasteryEvidence;
    const sourceId = evidence.sourceId;
    const replayKey = `${evidence.type}:${sourceId}:${studentId}:${conceptId}`;
    const storeKey = `${studentId}:${conceptId}`;
    const current = masteryStore.get(storeKey) ?? {
      confidence: 0.0,
      attempts: 0,
      version: 1,
    };

    if (appliedEvidence.has(replayKey)) {
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

    let calculatedConfidence = current.confidence;
    let nextAttempts = current.attempts;

    if (evidence.type === "poll") {
      if (evidence.outcome === "correct") {
        calculatedConfidence = Math.max(current.confidence, 0.85);
      } else if (evidence.outcome === "partial") {
        calculatedConfidence = Math.max(current.confidence, 0.50);
      } else {
        calculatedConfidence = current.confidence === 0.0 ? 0.20 : Math.min(current.confidence, 0.20);
      }
      nextAttempts = current.attempts + 1;
    } else if (evidence.type === "tutor") {
      calculatedConfidence = Math.min(current.confidence + 0.20, 1.0);
      // INV-MAS04: Does not increment attempts
    } else if (evidence.type === "quiz") {
      if (evidence.score >= 0.80) {
        calculatedConfidence = Math.min(current.confidence + 0.15, 1.0);
      } else if (evidence.score >= 0.60) {
        calculatedConfidence = Math.min(current.confidence + 0.10, 1.0);
      } else if (evidence.score >= 0.40) {
        calculatedConfidence = Math.min(current.confidence + 0.05, 1.0);
      } else {
        calculatedConfidence = Math.min(current.confidence + 0.02, 1.0);
      }
      // INV-MAS04: Does not increment attempts
    } else if (evidence.type === "attendance") {
      if (current.confidence < 0.30) {
        calculatedConfidence = Math.min(current.confidence + 0.05, 0.30);
      }
    }

    calculatedConfidence = Math.round(calculatedConfidence * 1000) / 1000;

    const updated: StatefulMasteryRecord = {
      confidence: calculatedConfidence,
      attempts: nextAttempts,
      version: current.version + 1,
    };

    masteryStore.set(storeKey, updated);
    appliedEvidence.add(replayKey);
    auditLog.push({
      studentId,
      conceptId,
      evidenceType: evidence.type,
      sourceId,
      priorConfidence: current.confidence,
      newConfidence: updated.confidence,
    });

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
    auditLog,
    rpc,
  };
}

describe("P5-A-01: Learning Evidence Service Unit Tests", () => {
  const teacherId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherCourseId: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const studentId: UUID = "22222222-2222-4222-8222-222222222222";
  const studentAuthId: UUID = "33333333-3333-4333-8333-333333333333";
  const otherStudentId: UUID = "44444444-4444-4444-8444-444444444444";
  const otherStudentAuthId: UUID = "55555555-5555-4555-8555-555555555555";
  const conceptId: UUID = "66666666-6666-4666-8666-666666666666";
  const otherConceptId: UUID = "77777777-7777-4777-8777-777777777777";
  const quizAttemptId: UUID = "88888888-8888-4888-8888-888888888888";
  const sessionId: UUID = "99999999-9999-4999-8999-999999999999";
  const messageId: UUID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
  const studentActor: ActorContext = {
    userId: studentId,
    authId: studentAuthId,
    email: "student@test.edu",
    name: "Student Test",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };


  const teacherActor: ActorContext = {
    userId: teacherId,
    authId: "auth-teacher-1",
    email: "teacher@test.edu",
    name: "Professor Test",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };
  const sampleCourse: Course = {
    id: courseId,
    teacherId,
    name: "Distributed Systems",
    description: "Advanced distributed systems course",
    joinCode: "DIST123",
    createdAt: "2026-10-20T00:00:00.000Z",
  };

  let store: TableStore;
  let rpcSubstitute: ReturnType<typeof createStatefulRpcClient>;
  let mockCourseService: Pick<CourseService, "getCourse">;
  let masteryRepo: MasteryRepository;
  let masteryService: MasteryService;
  let learningEvidenceService: LearningEvidenceService;

  beforeEach(() => {
    store = {
      quizAttempts: [],
      tutoringMessages: [],
    };

    rpcSubstitute = createStatefulRpcClient();

    mockCourseService = {
      getCourse: vi.fn(async (actor: ActorContext, targetCourseId: UUID) => {
        if (targetCourseId !== courseId) {
          throw new AppError({
            code: "NOT_FOUND",
            statusCode: 404,
            message: "Course not found",
          });
        }
        return sampleCourse;
      }),
    };

    masteryRepo = new MasteryRepository(rpcSubstitute.client);
    masteryService = new MasteryService(masteryRepo);

    learningEvidenceService = new LearningEvidenceService(
      createMockClient(store),
      mockCourseService,
      masteryService,
    );
  });

  describe("Quiz Evidence Application (INV-MAS04, INV-MAS05)", () => {
    it("applies a 4/5 quiz attempt (+0.15), keeping attempts 0 and auditing the attempt", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      const result = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        courseId,
        quizAttemptId,
      );

      expect(result).toEqual({
        sourceId: quizAttemptId,
        studentId,
        conceptId,
        confidence: 0.15,
        band: "red",
        attempts: 0,
        version: 2,
      });

      expect(rpcSubstitute.auditLog).toHaveLength(1);
      expect(rpcSubstitute.auditLog[0]).toEqual({
        studentId,
        conceptId,
        evidenceType: "quiz",
        sourceId: quizAttemptId,
        priorConfidence: 0.0,
        newConfidence: 0.15,
      });
    });

    it("does not increment poll attempts when nonzero baseline poll attempts exist", async () => {
      // 1. Establish nonzero poll attempts via MasteryService
      const pollRes = await masteryService.applyEvidence(studentActor, studentId, conceptId, {
        type: "poll",
        outcome: "correct",
        sourceId: "12345678-1234-4234-8234-123456789012",
      });
      expect(pollRes.confidence).toBe(0.85);
      expect(pollRes.attempts).toBe(1);
      expect(pollRes.version).toBe(2);

      // 2. Apply quiz evidence
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      const quizRes = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        courseId,
        quizAttemptId,
      );

      expect(quizRes.confidence).toBe(1.0); // 0.85 + 0.15 = 1.0
      expect(quizRes.attempts).toBe(1); // STILL 1!
      expect(quizRes.version).toBe(3);
    });

    it("verifies discrete quiz threshold increments: 0, 0.2, 0.4, 0.6, 0.8, 1.0", async () => {
      // Test discrete scores via multiple independent attempts on different concepts
      const scoreCases = [
        { correct: 0, score: 0.0, expectedInc: 0.02 },
        { correct: 1, score: 0.2, expectedInc: 0.02 },
        { correct: 2, score: 0.4, expectedInc: 0.05 },
        { correct: 3, score: 0.6, expectedInc: 0.10 },
        { correct: 4, score: 0.8, expectedInc: 0.15 },
        { correct: 5, score: 1.0, expectedInc: 0.15 },
      ];

      for (let i = 0; i < scoreCases.length; i++) {
        const sc = scoreCases[i];
        const cId = `66666666-6666-4666-8666-66666666660${i}`;
        const attId = `88888888-8888-4888-8888-88888888880${i}`;

        store.quizAttempts.push({
          id: attId,
          student_id: studentId,
          concept_id: cId,
          score: sc.score,
          correct_count: sc.correct,
          total_questions: 5,
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
          concept: {
            course_id: courseId,
          },
        });

        const res = await learningEvidenceService.applyQuizAttempt(studentActor, courseId, attId);
        expect(res.confidence).toBe(sc.expectedInc);
        expect(res.attempts).toBe(0);
      }
    });

    it("exercises canonical writer fractional scores immediately below boundaries (0.39, 0.59, 0.79)", async () => {
      // 0.39 -> +0.02
      const res039 = await masteryService.applyEvidence(studentActor, studentId, "77777777-7777-4777-8777-000000000001", {
        type: "quiz",
        score: 0.39,
        sourceId: "99999999-0000-4000-8000-000000000001",
      });
      expect(res039.confidence).toBe(0.02);

      // 0.59 -> +0.05
      const res059 = await masteryService.applyEvidence(studentActor, studentId, "77777777-7777-4777-8777-000000000002", {
        type: "quiz",
        score: 0.59,
        sourceId: "99999999-0000-4000-8000-000000000002",
      });
      expect(res059.confidence).toBe(0.05);

      // 0.79 -> +0.10
      const res079 = await masteryService.applyEvidence(studentActor, studentId, "77777777-7777-4777-8777-000000000003", {
        type: "quiz",
        score: 0.79,
        sourceId: "99999999-0000-4000-8000-000000000003",
      });
      expect(res079.confidence).toBe(0.10);
    });

    it("idempotently handles sequential duplicate quiz attempt replays", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      const first = await learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId);
      expect(first.confidence).toBe(0.15);
      expect(first.version).toBe(2);

      const replay = await learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId);
      expect(replay.confidence).toBe(0.15);
      expect(replay.version).toBe(2);
      expect(replay.attempts).toBe(0);

      expect(rpcSubstitute.auditLog).toHaveLength(1);
    });

    it("idempotently handles concurrent duplicate quiz attempt applications", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      const [res1, res2] = await Promise.all([
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ]);

      expect(res1.confidence).toBe(0.15);
      expect(res2.confidence).toBe(0.15);
      expect(res1.version).toBe(2);
      expect(res2.version).toBe(2);
      expect(rpcSubstitute.auditLog).toHaveLength(1);
    });

    it("allows teacher actor to apply quiz evidence for student in course", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      const result = await learningEvidenceService.applyQuizAttempt(
        teacherActor,
        courseId,
        quizAttemptId,
      );

      expect(result.confidence).toBe(0.15);
      expect(result.studentId).toBe(studentId);
    });
  });

  describe("Tutor Evidence Application (INV-MAS04, INV-MAS05)", () => {
    it("applies a verified assistant understanding message (+0.20), keeping attempts 0", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: conceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId],
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      const result = await learningEvidenceService.applyTutorMessage(
        studentActor,
        courseId,
        messageId,
      );

      expect(result).toEqual({
        sourceId: messageId,
        studentId,
        conceptId,
        confidence: 0.20,
        band: "red",
        attempts: 0,
        version: 2,
      });

      expect(rpcSubstitute.auditLog).toHaveLength(1);
      expect(rpcSubstitute.auditLog[0]).toEqual({
        studentId,
        conceptId,
        evidenceType: "tutor",
        sourceId: messageId,
        priorConfidence: 0.0,
        newConfidence: 0.20,
      });
    });

    it("chains quiz (0.15) and tutor (0.20) to reach 0.35 with attempts remaining 0", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: conceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId],
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      const quizRes = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        courseId,
        quizAttemptId,
      );
      expect(quizRes.confidence).toBe(0.15);
      expect(quizRes.attempts).toBe(0);
      expect(quizRes.version).toBe(2);

      const tutorRes = await learningEvidenceService.applyTutorMessage(
        studentActor,
        courseId,
        messageId,
      );
      expect(tutorRes.confidence).toBe(0.35);
      expect(tutorRes.attempts).toBe(0);
      expect(tutorRes.version).toBe(3);

      expect(rpcSubstitute.auditLog).toHaveLength(2);
      expect(rpcSubstitute.auditLog[0].evidenceType).toBe("quiz");
      expect(rpcSubstitute.auditLog[1].evidenceType).toBe("tutor");
      expect(rpcSubstitute.auditLog[1].sourceId).toBe(messageId); // message ID, not session ID!
    });

    it("clamps at 1.0 when multiple tutor messages are applied", async () => {
      for (let i = 0; i < 6; i++) {
        const msgId = `aaaaaaaa-${i}${i}${i}${i}-4aaa-8aaa-aaaaaaaaaaaa`;
        store.tutoringMessages.push({
          id: msgId,
          session_id: sessionId,
          role: "assistant",
          concept_id: conceptId,
          understanding_detected: true,
          session: {
            id: sessionId,
            student_id: studentId,
            target_concepts: [conceptId],
            student: {
              id: studentId,
              auth_id: studentAuthId,
              course_id: courseId,
            },
          },
          concept: {
            course_id: courseId,
          },
        });

        await learningEvidenceService.applyTutorMessage(studentActor, courseId, msgId);
      }

      const current = rpcSubstitute.masteryStore.get(`${studentId}:${conceptId}`);
      expect(current?.confidence).toBe(1.0);
      expect(current?.attempts).toBe(0);
      expect(current?.version).toBe(7);
    });

    it("idempotently handles tutor message replay", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: conceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId],
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      const first = await learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId);
      expect(first.confidence).toBe(0.20);
      expect(first.version).toBe(2);

      const replay = await learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId);
      expect(replay.confidence).toBe(0.20);
      expect(replay.version).toBe(2);
      expect(replay.attempts).toBe(0);

      expect(rpcSubstitute.auditLog).toHaveLength(1);
    });

    it("allows teacher actor to apply tutor evidence for student in course", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: conceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId],
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      const result = await learningEvidenceService.applyTutorMessage(teacherActor, courseId, messageId);
      expect(result.confidence).toBe(0.20);
      expect(result.studentId).toBe(studentId);
    });
  });

  describe("Validation & Eligibility Edge Cases", () => {
    it("rejects invalid UUIDs with 400 VALIDATION_ERROR", async () => {
      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, "invalid-uuid", quizAttemptId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, "invalid-uuid"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, "invalid-uuid", messageId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, "invalid-uuid"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("propagates course authorization errors from courseService", async () => {
      mockCourseService.getCourse = vi.fn(async () => {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "User not enrolled in course",
        });
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("wraps unexpected course service errors into 503 SERVICE_UNAVAILABLE", async () => {
      mockCourseService.getCourse = vi.fn(async () => {
        throw new Error("Network crash");
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to verify course authorization",
      });
    });

    it("returns 404 NOT_FOUND when quiz attempt row does not exist", async () => {
      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Quiz attempt not found for this course",
      });
    });

    it("returns 404 NOT_FOUND when tutor message row does not exist", async () => {
      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Tutoring message not found for this course",
      });
    });

    it("returns 404 NOT_FOUND when student accesses another student's quiz attempt", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: otherStudentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: otherStudentId,
          auth_id: otherStudentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });

    it("returns 404 NOT_FOUND when student accesses another student's tutor message", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: conceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: otherStudentId,
          target_concepts: [conceptId],
          student: {
            id: otherStudentId,
            auth_id: otherStudentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });

    it("returns 404 NOT_FOUND when concept belongs to another course", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: otherCourseId,
        },
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });

    it("returns 500 INTERNAL_SERVER_ERROR if quiz attempt score is inconsistent with correct_count", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 2, // 2/5 = 0.4 !== 0.8
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Malformed quiz attempt record in database",
      });
    });

    it("returns 500 INTERNAL_SERVER_ERROR if quiz total_questions is not 5", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 10 as unknown as 5, // invalid
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });
    });

    it("returns 400 VALIDATION_ERROR if tutor message role is not 'assistant'", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "user",
        concept_id: conceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId],
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Tutoring message is not eligible for mastery evidence",
      });
    });

    it("returns 400 VALIDATION_ERROR if tutor message understanding_detected is false", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: conceptId,
        understanding_detected: false,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId],
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Tutoring message is not eligible for mastery evidence",
      });
    });

    it("returns 400 VALIDATION_ERROR if tutor message concept is not in session target_concepts", async () => {
      store.tutoringMessages.push({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        concept_id: otherConceptId,
        understanding_detected: true,
        session: {
          id: sessionId,
          student_id: studentId,
          target_concepts: [conceptId], // otherConceptId NOT in target_concepts
          student: {
            id: studentId,
            auth_id: studentAuthId,
            course_id: courseId,
          },
        },
        concept: {
          course_id: courseId,
        },
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Tutoring message is not eligible for mastery evidence",
      });
    });

    it("maps PGRST000 database error to 503 SERVICE_UNAVAILABLE", async () => {
      store.forcedError = { code: "PGRST000", message: "Connection lost" };

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, courseId, messageId),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("maps 42501 database error to 403 FORBIDDEN", async () => {
      store.forcedError = { code: "42501", message: "Insufficient privileges" };

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("wraps unexpected writer errors into 503 SERVICE_UNAVAILABLE", async () => {
      store.quizAttempts.push({
        id: quizAttemptId,
        student_id: studentId,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        student: {
          id: studentId,
          auth_id: studentAuthId,
          course_id: courseId,
        },
        concept: {
          course_id: courseId,
        },
      });

      vi.spyOn(masteryService, "applyEvidence").mockRejectedValueOnce(
        new Error("Writer RPC crashed"),
      );

      await expect(
        learningEvidenceService.applyQuizAttempt(studentActor, courseId, quizAttemptId),
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        message: "Failed to apply quiz evidence",
      });
    });
  });
});
