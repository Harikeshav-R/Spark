import { describe, it, expect, vi } from "vitest";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import {
  PollRepository,
  type PollDatabaseClientPort,
} from "../../../src/server/classroom/poll-repository.js";

describe("PollRepository Unit Tests (Lane B)", () => {
  const teacherAuthId: UUID = "11111111-1111-4111-8111-111111111111";
  const teacherId: UUID = "22222222-2222-4222-8222-222222222222";
  const studentAuthId: UUID = "33333333-3333-4333-8333-333333333333";
  const studentId: UUID = "44444444-4444-4444-8444-444444444444";
  const courseId: UUID = "55555555-5555-4555-8555-555555555555";
  const lectureId: UUID = "66666666-6666-4666-8666-666666666666";
  const pollId: UUID = "77777777-7777-4777-8777-777777777777";
  const conceptId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const responseId: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const timestamp = "2026-10-23T14:30:00.000Z";

  const teacherActor: ActorContext = {
    userId: teacherAuthId,
    authId: teacherAuthId,
    teacherId,
    role: "teacher",
    name: "Prof. Alan Turing",
    email: "turing@example.edu",
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Grace Hopper",
    email: "hopper@example.edu",
    enrolledCourses: [{ studentId, courseId }],
  };

  describe("getPoll", () => {
    it("rejects invalid pollId format with 400 VALIDATION_ERROR", async () => {
      const mockClient = {
        from: vi.fn(),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;
      const repo = new PollRepository(mockClient);

      await expect(repo.getPoll(teacherActor, "not-a-uuid" as UUID)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects teacher actor without teacherId with 404 NOT_FOUND", async () => {
      const teacherWithoutId: ActorContext = {
        ...teacherActor,
        teacherId: undefined,
      };
      const mockClient = {
        from: vi.fn(),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;
      const repo = new PollRepository(mockClient);

      await expect(repo.getPoll(teacherWithoutId, pollId)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("rejects student actor with empty enrolledCourses with 404 NOT_FOUND", async () => {
      const studentWithoutCourses: ActorContext = {
        ...studentActor,
        enrolledCourses: [],
      };
      const mockClient = {
        from: vi.fn(),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;
      const repo = new PollRepository(mockClient);

      await expect(repo.getPoll(studentWithoutCourses, pollId)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("returns scoped poll, courseId, and lectureStatus for authorized teacher", async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: pollId,
                  lecture_id: lectureId,
                  concept_id: conceptId,
                  question: "What is 2+2?",
                  expected_answer: "4",
                  status: "draft",
                  generated_at: timestamp,
                  activated_at: null,
                  closed_at: null,
                  lecture_sessions: {
                    id: lectureId,
                    status: "live",
                    course_id: courseId,
                    courses: {
                      id: courseId,
                      teacher_id: teacherId,
                    },
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;

      const repo = new PollRepository(mockClient);
      const result = await repo.getPoll(teacherActor, pollId);

      expect(result.courseId).toBe(courseId);
      expect(result.lectureStatus).toBe("live");
      expect(result.poll.id).toBe(pollId);
      expect(result.poll.status).toBe("draft");
    });

    it("rejects teacher if course does not belong to actor's teacherId with 404 NOT_FOUND", async () => {
      const otherTeacherId: UUID = "99999999-9999-4999-8999-999999999999";
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: pollId,
                  lecture_id: lectureId,
                  concept_id: conceptId,
                  question: "What is 2+2?",
                  expected_answer: "4",
                  status: "draft",
                  generated_at: timestamp,
                  lecture_sessions: {
                    id: lectureId,
                    status: "live",
                    course_id: courseId,
                    courses: {
                      id: courseId,
                      teacher_id: otherTeacherId, // mismatch
                    },
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;

      const repo = new PollRepository(mockClient);
      await expect(repo.getPoll(teacherActor, pollId)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("rejects malformed row data with 500 INTERNAL_SERVER_ERROR", async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: pollId,
                  lecture_id: lectureId,
                  // missing concept_id, question, etc.
                  lecture_sessions: {
                    id: lectureId,
                    status: "live",
                    course_id: courseId,
                    courses: { id: courseId, teacher_id: teacherId },
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;

      const repo = new PollRepository(mockClient);
      await expect(repo.getPoll(teacherActor, pollId)).rejects.toMatchObject({
        statusCode: 500,
      });
    });
  });

  describe("transitionPoll", () => {
    it("maps RPC errors to typed AppError", async () => {
      const testCases = [
        { pgCode: "P0002", message: "Not found", expectedStatus: 404 },
        { pgCode: "42501", message: "Forbidden", expectedStatus: 403 },
        { pgCode: "22023", message: "Invalid argument", expectedStatus: 400 },
        { pgCode: "P0001", message: "ACTIVE_POLL_EXISTS", expectedStatus: 409, expectedCode: "ACTIVE_POLL_EXISTS" },
        { pgCode: "P0001", message: "INVALID_POLL_STATUS", expectedStatus: 400, expectedCode: "INVALID_POLL_STATUS" },
        { pgCode: "P0001", message: "INVALID_LECTURE_STATUS", expectedStatus: 400, expectedCode: "INVALID_LECTURE_STATUS" },
        { pgCode: "23505", message: "idx_poll_questions_single_active", expectedStatus: 409, expectedCode: "ACTIVE_POLL_EXISTS" },
      ];

      for (const tc of testCases) {
        const mockClient = {
          from: vi.fn(),
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: {
              code: tc.pgCode,
              message: tc.message,
              details: tc.message,
            },
          }),
        } as unknown as PollDatabaseClientPort;

        const repo = new PollRepository(mockClient);
        await expect(
          repo.transitionPoll(teacherActor, pollId, "active", timestamp),
        ).rejects.toMatchObject({
          statusCode: tc.expectedStatus,
          ...(tc.expectedCode ? { code: tc.expectedCode } : {}),
        });
      }
    });

    it("returns updated PollQuestion on successful transition", async () => {
      const mockClient = {
        from: vi.fn(),
        rpc: vi.fn().mockResolvedValue({
          data: [
            {
              id: pollId,
              lecture_id: lectureId,
              concept_id: conceptId,
              question: "What is an eigenvalue?",
              expected_answer: "Av = lambda v",
              status: "active",
              generated_at: timestamp,
              activated_at: timestamp,
              closed_at: null,
            },
          ],
          error: null,
        }),
      } as unknown as PollDatabaseClientPort;

      const repo = new PollRepository(mockClient);
      const result = await repo.transitionPoll(teacherActor, pollId, "active", timestamp);

      expect(result.id).toBe(pollId);
      expect(result.status).toBe("active");
      expect(result.activatedAt).toBe(timestamp);
    });
  });

  describe("storeMasteryResult", () => {
    it("returns stored: true when conditional compare-and-set succeeds", async () => {
      const evaluation = { outcome: "correct" as const, feedback: "Great." };
      const mastery = { confidence: 0.85, band: "green" as const, attempts: 1, version: 2 };

      const updatedRow = {
        id: responseId,
        question_id: pollId,
        student_id: studentId,
        answer: "4",
        status: "evaluated",
        evaluation: { ...evaluation, mastery },
        answered_at: timestamp,
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: updatedRow,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;

      const repo = new PollRepository(mockClient);
      const result = await repo.storeMasteryResult(responseId, studentId, evaluation, mastery);

      expect(result.stored).toBe(true);
      expect(result.response.id).toBe(responseId);
      expect(result.response.evaluation?.mastery?.confidence).toBe(0.85);
    });

    it("returns stored: false and fetches winner when conditional update matches 0 rows", async () => {
      const evaluation = { outcome: "correct" as const, feedback: "Great." };
      const mastery = { confidence: 0.85, band: "green" as const, attempts: 1, version: 2 };

      const winnerRow = {
        id: responseId,
        question_id: pollId,
        student_id: studentId,
        answer: "4",
        status: "evaluated",
        evaluation: { ...evaluation, mastery: { confidence: 0.85, band: "green" as const, attempts: 1, version: 2 } },
        answered_at: timestamp,
      };

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "poll_responses") {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      is: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: null, // matched 0 rows because mastery already set
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: winnerRow,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
        rpc: vi.fn(),
      } as unknown as PollDatabaseClientPort;

      const repo = new PollRepository(mockClient);
      const result = await repo.storeMasteryResult(responseId, studentId, evaluation, mastery);

      expect(result.stored).toBe(false);
      expect(result.response.id).toBe(responseId);
    });
  });
});
