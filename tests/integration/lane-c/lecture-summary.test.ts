import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DetectConceptsCandidate } from "../../../src/contracts/ai.js";
import type { LectureSession } from "../../../src/contracts/classroom.js";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  SummarizeLectureAi,
} from "../../../src/server/ai/index.js";
import {
  LectureSummaryRepository,
  LectureSummaryService,
  type LectureSummaryRecord,
} from "../../../src/server/learning/index.js";

describe("P3-C-02: LectureSummaryService Integration Tests", () => {
  const teacherId: UUID = "11111111-1111-4111-8111-111111111111";
  const studentId: UUID = "22222222-2222-4222-8222-222222222222";
  const unauthorizedTeacherId: UUID = "33333333-3333-4333-8333-333333333333";
  const courseId: UUID = "44444444-4444-4444-8444-444444444444";
  const lectureId: UUID = "55555555-5555-4555-8555-555555555555";
  const conceptLossId: UUID = "66666666-6666-4666-8666-666666666666";
  const conceptGradientId: UUID = "77777777-7777-4777-8777-777777777777";

  const teacherActor: ActorContext = {
    userId: teacherId,
    authId: teacherId,
    email: "prof@university.test",
    name: "Professor Turing",
    role: "teacher",
    teacherId,
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentId,
    authId: studentId,
    email: "student@university.test",
    name: "Student Ada",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };

  const unauthorizedTeacherActor: ActorContext = {
    userId: unauthorizedTeacherId,
    authId: unauthorizedTeacherId,
    email: "other@university.test",
    name: "Other Teacher",
    role: "teacher",
    teacherId: unauthorizedTeacherId,
    enrolledCourses: [],
  };

  const candidateConcepts: DetectConceptsCandidate[] = [
    { id: conceptLossId, label: "Loss Functions" },
    { id: conceptGradientId, label: "Gradient Descent" },
  ];

  let completedLecture: LectureSession;
  let summaryStore: Map<string, Record<string, unknown>>;
  let publishedEvents: Array<{ lectureId: UUID; event: string; payload: unknown }>;
  let roomAuthMock: (actor: ActorContext, room: string) => Promise<void>;

  function createMockDbClient() {
    return {
      from: (table: string) => {
        if (table !== "lecture_summaries") {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                const row = summaryStore.get(val);
                return { data: row ?? null, error: null };
              },
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: (_cols?: string) => ({
              single: async () => {
                const lectureIdKey = String(row.lecture_id);
                if (summaryStore.has(lectureIdKey)) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message: "duplicate key value violates unique constraint",
                    },
                  };
                }
                summaryStore.set(lectureIdKey, { ...row });
                return { data: { ...row }, error: null };
              },
            }),
          }),
        };
      },
    };
  }

  beforeEach(() => {
    summaryStore = new Map();
    publishedEvents = [];

    completedLecture = {
      id: lectureId,
      courseId,
      title: "Optimization & Gradients",
      status: "completed",
      startedAt: "2026-10-23T10:00:00.000Z",
      endedAt: "2026-10-23T11:00:00.000Z",
    };

    roomAuthMock = async (actor: ActorContext, room: string) => {
      if (room.startsWith("professor:")) {
        if (actor.role !== "teacher" || actor.userId !== teacherId) {
          throw new AppError({
            code: DomainErrorCode.FORBIDDEN,
            statusCode: 403,
            message: "Room authorization failed",
          });
        }
      } else if (room.startsWith("lecture:")) {
        const isOwningTeacher = actor.role === "teacher" && actor.userId === teacherId;
        const isEnrolledStudent = actor.enrolledCourses.some((c) => c.courseId === courseId);
        if (!isOwningTeacher && !isEnrolledStudent) {
          throw new AppError({
            code: DomainErrorCode.FORBIDDEN,
            statusCode: 403,
            message: "Room authorization failed",
          });
        }
      }
    };
  });

  function setupService(options?: {
    chunks?: { text: string; timestampSec: number }[];
    lecture?: LectureSession;
    insertError?: { code?: string; message: string };
    onEmit?: (event: string, payload: unknown) => void;
  }) {
    const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const summarizer = new SummarizeLectureAi(aiClient);

    const dbClient = options?.insertError
      ? {
          from: () => ({
            select: () => ({
              eq: (_col: string, val: string) => ({
                maybeSingle: async () => ({ data: summaryStore.get(val) ?? null, error: null }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: options.insertError ?? null }),
              }),
            }),
          }),
        }
      : createMockDbClient();

    const repository = new LectureSummaryRepository(dbClient);

    const classroom = {
      getLecture: vi.fn().mockResolvedValue(options?.lecture ?? completedLecture),
      getLectureTranscript: vi.fn().mockResolvedValue(options?.chunks ?? []),
      getCandidateConcepts: vi.fn().mockResolvedValue(candidateConcepts),
    };

    const rooms = {
      authorizeRoom: vi.fn().mockImplementation((actor, room) => roomAuthMock(actor, room)),
    };

    const publisher = {
      emitToLecture: vi.fn().mockImplementation(async (lId: UUID, ev: string, payload: unknown) => {
        publishedEvents.push({ lectureId: lId, event: ev, payload });
        if (options?.onEmit) {
          options.onEmit(ev, payload);
        }
      }),
    };

    const clock = {
      now: () => new Date("2026-10-23T11:00:05.000Z"),
      nowISO: () => "2026-10-23T11:00:05.000Z",
    };

    const ids = {
      generateId: () => "88888888-8888-4888-8888-888888888888",
      generateJoinCode: () => "ABCDEF",
    };

    const service = new LectureSummaryService({
      classroom,
      rooms,
      repository,
      summarizer,
      publisher,
      clock,
      ids,
    });

    return { service, repository, classroom, rooms, publisher, clock, ids };
  }

  describe("1. Authorization Before Access", () => {
    it("rejects non-teacher actors attempting generation with 403 FORBIDDEN", async () => {
      const { service } = setupService();

      await expect(
        service.generateForLecture(studentActor, lectureId)
      ).rejects.toMatchObject({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
      });
    });

    it("rejects unauthorized teacher via room authorization with 403 FORBIDDEN", async () => {
      const { service } = setupService();

      await expect(
        service.generateForLecture(unauthorizedTeacherActor, lectureId)
      ).rejects.toMatchObject({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
      });
    });

    it("rejects unauthorized student reading summary with 403 FORBIDDEN", async () => {
      const { service } = setupService();
      const unenrolledStudent: ActorContext = {
        ...studentActor,
        userId: "99999999-9999-4999-8999-999999999999",
        enrolledCourses: [],
      };

      await expect(
        service.getSummary(unenrolledStudent, lectureId)
      ).rejects.toMatchObject({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
      });
    });

    it("validates lectureId UUID on generation and read (400 VALIDATION_ERROR)", async () => {
      const { service } = setupService();

      await expect(
        service.generateForLecture(teacherActor, "invalid-uuid")
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });

      await expect(
        service.getSummary(studentActor, "invalid-uuid")
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });
    });
  });

  describe("2. Completed-Only Generation", () => {
    it("rejects generation for a live lecture with 409 CONFLICT", async () => {
      const liveLecture: LectureSession = {
        ...completedLecture,
        status: "live",
        endedAt: undefined,
      };

      const { service } = setupService({ lecture: liveLecture });

      await expect(
        service.generateForLecture(teacherActor, lectureId)
      ).rejects.toMatchObject({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: "Lecture must be completed before summarization",
      });
    });
  });

  describe("3. Whole-Transcript Behavior Across 1205 Chunks", () => {
    it("ingests 1205 chunks and detects concepts at boundary indices (0 and 1204)", async () => {
      const chunks: { text: string; timestampSec: number }[] = [];
      chunks.push({
        text: "In this opening segment we formulate Loss Functions to measure discrepancy.",
        timestampSec: 0,
      });

      for (let i = 1; i <= 1203; i++) {
        chunks.push({
          text: `Intermediate theoretical exposition paragraph step ${i} discussing vector properties.`,
          timestampSec: i * 2,
        });
      }

      chunks.push({
        text: "Finally, we apply Gradient Descent to update parameters toward the minimum.",
        timestampSec: 2500,
      });

      expect(chunks).toHaveLength(1205);

      let recordCommittedDuringEvent = false;
      const { service } = setupService({
        chunks,
        onEmit: (event, _payload) => {
          if (event === "lecture:summary-ready") {
            // Invariant check: verify persisted summary is readable when event fires
            expect(summaryStore.has(lectureId)).toBe(true);
            recordCommittedDuringEvent = true;
          }
        },
      });

      const summary = await service.generateForLecture(teacherActor, lectureId);

      expect(summary.lectureId).toBe(lectureId);
      expect(summary.keyConceptsCovered).toContain(conceptLossId);
      expect(summary.keyConceptsCovered).toContain(conceptGradientId);
      expect(summary.summary).toContain("Loss Functions");
      expect(summary.summary.length).toBeGreaterThanOrEqual(100);
      expect(summary.summary.length).toBeLessThanOrEqual(3000);
      expect(recordCommittedDuringEvent).toBe(true);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]).toEqual({
        lectureId,
        event: "lecture:summary-ready",
        payload: {
          eventId: "88888888-8888-4888-8888-888888888888",
          occurredAt: "2026-10-23T11:00:05.000Z",
          lectureId,
          summary: summary.summary,
          keyConceptsCovered: summary.keyConceptsCovered,
        },
      });

      // Verify student readback
      const readSummary = await service.getSummary(studentActor, lectureId);
      expect(readSummary).toEqual(summary);
    });
  });

  describe("4. Empty Lecture Handling", () => {
    it("persists standard notice and emits ready event without candidate matches", async () => {
      const { service } = setupService({ chunks: [] });

      const summary = await service.generateForLecture(teacherActor, lectureId);

      expect(summary.summary).toBe(
        "## Lecture summary\n\nNo transcript was recorded for this lecture. Key concepts and timestamped excerpts are unavailable."
      );
      expect(summary.keyConceptsCovered).toEqual([]);
      expect(summary.timelineHighlights).toEqual([]);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].event).toBe("lecture:summary-ready");

      const readback = await service.getSummary(studentActor, lectureId);
      expect(readback).toEqual(summary);
    });
  });

  describe("5. Existing-Summary Reuse & Duplicate Convergence", () => {
    it("returns existing summary without re-invoking summarizer or emitting ready", async () => {
      const chunks = [
        { text: "Introduction to Loss Functions", timestampSec: 0 },
      ];

      const { service, classroom, publisher } = setupService({ chunks });

      const firstResult = await service.generateForLecture(teacherActor, lectureId);
      expect(publishedEvents).toHaveLength(1);

      // Second call
      const secondResult = await service.generateForLecture(teacherActor, lectureId);
      expect(secondResult).toEqual(firstResult);

      // No second model generation / transcript fetch
      expect(classroom.getLectureTranscript).toHaveBeenCalledTimes(1);
      // No second broadcast
      expect(publisher.emitToLecture).toHaveBeenCalledTimes(1);
    });

    it("converges on duplicate insert 23505 without re-emitting ready event", async () => {
      const existingRecord: LectureSummaryRecord = {
        lectureId,
        summary:
          "## Lecture summary\n\nExisting persisted summary from a concurrent worker thread.\n\n### Key Concepts\n- Loss Functions",
        keyConceptsCovered: [conceptLossId],
        timelineHighlights: [],
        generatedAt: "2026-10-23T10:59:00.000Z",
      };

      summaryStore.set(lectureId, {
        lecture_id: existingRecord.lectureId,
        summary: existingRecord.summary,
        key_concepts_covered: existingRecord.keyConceptsCovered,
        timeline_highlights: existingRecord.timelineHighlights,
        generated_at: existingRecord.generatedAt,
      });

      const { service, publisher } = setupService({ chunks: [] });

      const result = await service.generateForLecture(teacherActor, lectureId);
      expect(result.summary).toBe(existingRecord.summary);
      expect(publisher.emitToLecture).not.toHaveBeenCalled();
    });
  });

  describe("6. Failure & Non-Publication Guarantees", () => {
    it("emits NO ready event when database persistence fails", async () => {
      const { service, publisher } = setupService({
        chunks: [{ text: "Loss Functions overview", timestampSec: 0 }],
        insertError: { message: "connection lost", code: "08006" },
      });

      await expect(
        service.generateForLecture(teacherActor, lectureId)
      ).rejects.toMatchObject({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
      });

      expect(publisher.emitToLecture).not.toHaveBeenCalled();
    });

    it("returns 404 NOT_FOUND when reading summary for lecture without one", async () => {
      const { service } = setupService();

      await expect(
        service.getSummary(studentActor, lectureId)
      ).rejects.toMatchObject({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Lecture summary is not available",
      });
    });
  });
});
