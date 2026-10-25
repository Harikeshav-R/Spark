import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  PollQuestion,
  PollResponseResult,
} from "../../../src/contracts/classroom.js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
} from "../../../src/contracts/common.js";
import { AppError } from "../../../src/contracts/errors.js";
import type {
  PollNewQuestionEvent,
  PollClosedEvent,
} from "../../../src/contracts/realtime.js";
import type { MasteryUpdatedEvent } from "../../../src/contracts/mastery.js";
import {
  PollService,
  type PollServiceDependencies,
} from "../../../src/server/classroom/poll-service.js";
import type {
  PollRepository,
  PollContext,
  StoredPollResponse,
} from "../../../src/server/classroom/poll-repository.js";

describe("PollService Unit Tests (Lane B)", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const studentAuthId = "33333333-3333-4333-8333-333333333333";
  const studentId = "44444444-4444-4444-8444-444444444444";
  const courseId = "55555555-5555-4555-8555-555555555555";
  const lectureId = "66666666-6666-4666-8666-666666666666";
  const pollId = "77777777-7777-4777-8777-777777777777";
  const conceptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const responseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

  const mockTime = "2026-10-23T14:30:00.000Z";
  const mockClock: Clock = {
    now: () => new Date(mockTime),
    nowISO: () => mockTime,
  };

  const mockIds: IdGenerator = {
    generateId: () => eventId,
    generateJoinCode: () => "ABCDEF",
  };

  let mockPolls: Pick<
    PollRepository,
    | "getPoll"
    | "transitionPoll"
    | "ingestResponse"
    | "storeEvaluation"
    | "markEvaluationFailed"
    | "storeMasteryResult"
  >;
  let mockRooms: PollServiceDependencies["rooms"];
  let mockPresence: PollServiceDependencies["presence"];
  let mockAi: PollServiceDependencies["ai"];
  let mockEvidence: PollServiceDependencies["evidence"];
  let mockPublisher: PollServiceDependencies["publisher"];

  const draftPoll: PollQuestion = {
    id: pollId,
    lectureId,
    conceptId,
    question: "What is an eigenvalue?",
    expectedAnswer: "A scalar lambda where Av = lambda v.",
    status: "draft",
    generatedAt: "2026-10-23T14:00:00.000Z",
  };

  const activePoll: PollQuestion = {
    ...draftPoll,
    status: "active",
    activatedAt: mockTime,
  };

  const closedPoll: PollQuestion = {
    ...activePoll,
    status: "closed",
    closedAt: mockTime,
  };

  beforeEach(() => {
    mockPolls = {
      getPoll: vi.fn().mockResolvedValue({
        poll: draftPoll,
        courseId,
        lectureStatus: "live",
      } satisfies PollContext),
      transitionPoll: vi.fn().mockResolvedValue(activePoll),
      ingestResponse: vi.fn(),
      storeEvaluation: vi.fn(),
      markEvaluationFailed: vi.fn(),
      storeMasteryResult: vi.fn(),
    };
    mockRooms = {
      authorizeRoom: vi.fn().mockResolvedValue(undefined),
    };
    mockPresence = {
      getAttendingStudentIds: vi.fn().mockResolvedValue([studentId]),
    };
    mockAi = {
      evaluatePollResponse: vi.fn().mockResolvedValue({
        outcome: "correct",
        feedback: "Correct scalar relationship.",
      }),
    };
    mockEvidence = {
      applyResponse: vi.fn().mockResolvedValue({
        confidence: 0.85,
        band: "green",
        attempts: 1,
        version: 2,
      }),
    };
    mockPublisher = {
      emitToLecture: vi.fn().mockResolvedValue(undefined),
      emitToStudent: vi.fn().mockResolvedValue(undefined),
    };
  });

  function createService(): PollService {
    return new PollService({
      polls: mockPolls,
      rooms: mockRooms,
      presence: mockPresence,
      ai: mockAi,
      evidence: mockEvidence,
      publisher: mockPublisher,
      ids: mockIds,
      clock: mockClock,
    });
  }

  describe("activatePoll", () => {
    it("rejects non-teacher actors with 403 FORBIDDEN", async () => {
      const service = createService();
      await expect(service.activatePoll(studentActor, pollId)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockPolls.transitionPoll).not.toHaveBeenCalled();
    });

    it("authorizes professor room, transitions poll to active, and broadcasts poll:new-question without rubric leak", async () => {
      const service = createService();
      const result = await service.activatePoll(teacherActor, pollId);

      expect(mockRooms.authorizeRoom).toHaveBeenCalledWith(
        teacherActor,
        `professor:${lectureId}`,
      );
      expect(mockPolls.transitionPoll).toHaveBeenCalledWith(
        teacherActor,
        pollId,
        "active",
        mockTime,
      );
      expect(mockPublisher.emitToLecture).toHaveBeenCalledWith(
        lectureId,
        "poll:new-question",
        {
          eventId,
          occurredAt: mockTime,
          pollId,
          lectureId,
          conceptId,
          question: "What is an eigenvalue?",
          status: "active",
          activatedAt: mockTime,
        } satisfies PollNewQuestionEvent,
      );
      // Ensure expectedAnswer is NEVER in the emitted payload (SC-08)
      const emittedPayload = vi.mocked(mockPublisher.emitToLecture).mock.calls[0][2];
      expect(emittedPayload).not.toHaveProperty("expectedAnswer");
      expect(emittedPayload).not.toHaveProperty("rubric");
      expect(result).toEqual(activePoll);
    });

    it("propagates repository transition error without emitting broadcast", async () => {
      mockPolls.transitionPoll = vi.fn().mockRejectedValue(
        new AppError({
          code: "ACTIVE_POLL_EXISTS",
          statusCode: 409,
          message: "Another poll is already active in this lecture",
        }),
      );
      const service = createService();
      await expect(service.activatePoll(teacherActor, pollId)).rejects.toMatchObject({
        code: "ACTIVE_POLL_EXISTS",
        statusCode: 409,
      });
      expect(mockPublisher.emitToLecture).not.toHaveBeenCalled();
    });
  });

  describe("closePoll", () => {
    it("rejects non-teacher actors with 403 FORBIDDEN", async () => {
      const service = createService();
      await expect(service.closePoll(studentActor, pollId)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("authorizes professor room, transitions poll to closed, and broadcasts poll:closed", async () => {
      mockPolls.getPoll = vi.fn().mockResolvedValue({
        poll: activePoll,
        courseId,
        lectureStatus: "live",
      });
      mockPolls.transitionPoll = vi.fn().mockResolvedValue(closedPoll);

      const service = createService();
      const result = await service.closePoll(teacherActor, pollId);

      expect(mockRooms.authorizeRoom).toHaveBeenCalledWith(
        teacherActor,
        `professor:${lectureId}`,
      );
      expect(mockPolls.transitionPoll).toHaveBeenCalledWith(
        teacherActor,
        pollId,
        "closed",
        mockTime,
      );
      expect(mockPublisher.emitToLecture).toHaveBeenCalledWith(
        lectureId,
        "poll:closed",
        {
          eventId,
          occurredAt: mockTime,
          pollId,
          lectureId,
          status: "closed",
          closedAt: mockTime,
        } satisfies PollClosedEvent,
      );
      expect(result).toEqual(closedPoll);
    });
  });

  describe("respondToPoll", () => {
    const rawAnswer = "A scalar lambda where Av = lambda v.";

    beforeEach(() => {
      mockPolls.getPoll = vi.fn().mockResolvedValue({
        poll: activePoll,
        courseId,
        lectureStatus: "live",
      });
    });

    it("rejects non-student actors with 403 FORBIDDEN", async () => {
      const service = createService();
      await expect(
        service.respondToPoll(teacherActor, pollId, studentId, rawAnswer),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects blank or whitespace-only answer with 400 VALIDATION_ERROR", async () => {
      const service = createService();
      await expect(
        service.respondToPoll(studentActor, pollId, studentId, "   "),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects student not enrolled in the course with 403 FORBIDDEN", async () => {
      const outsiderStudent: ActorContext = {
        ...studentActor,
        enrolledCourses: [{ studentId: "99999999-9999-4999-8999-999999999999", courseId: "88888888-8888-4888-8888-888888888888" }],
      };
      const service = createService();
      await expect(
        service.respondToPoll(outsiderStudent, pollId, studentId, rawAnswer),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects when supplied studentId does not match actor enrollment studentId with 403 FORBIDDEN", async () => {
      const service = createService();
      const forgedStudentId = "99999999-9999-4999-8999-999999999999";
      await expect(
        service.respondToPoll(studentActor, pollId, forgedStudentId, rawAnswer),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects non-attending student with 403 FORBIDDEN", async () => {
      mockPresence.getAttendingStudentIds = vi.fn().mockResolvedValue([]); // not attending
      const service = createService();
      await expect(
        service.respondToPoll(studentActor, pollId, studentId, rawAnswer),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: expect.stringContaining("not attending"),
      });
    });

    it("evaluates newly inserted response, applies evidence, caches mastery, and emits private mastery update", async () => {
      const pendingResponse: StoredPollResponse = {
        id: responseId,
        questionId: pollId,
        studentId,
        answer: rawAnswer,
        status: "pending",
        evaluation: null,
        answeredAt: mockTime,
      };

      const evaluatedResponse: StoredPollResponse = {
        ...pendingResponse,
        status: "evaluated",
        evaluation: {
          outcome: "correct",
          feedback: "Correct scalar relationship.",
          mastery: {
            confidence: 0.85,
            band: "green",
            attempts: 1,
            version: 2,
          },
        },
      };

      mockPolls.ingestResponse = vi.fn().mockResolvedValue({
        response: pendingResponse,
        inserted: true,
      });
      mockPolls.storeEvaluation = vi.fn().mockResolvedValue({
        ...pendingResponse,
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Correct scalar relationship." },
      });
      mockPolls.storeMasteryResult = vi.fn().mockResolvedValue({
        response: evaluatedResponse,
        stored: true, // winner
      });

      const service = createService();
      const result = await service.respondToPoll(studentActor, pollId, studentId, rawAnswer);

      expect(mockRooms.authorizeRoom).toHaveBeenCalledWith(studentActor, `lecture:${lectureId}`);
      expect(mockPolls.ingestResponse).toHaveBeenCalledWith(
        studentActor,
        pollId,
        eventId,
        rawAnswer,
        mockTime,
      );
      expect(mockAi.evaluatePollResponse).toHaveBeenCalledWith(
        activePoll.question,
        activePoll.expectedAnswer,
        rawAnswer,
      );
      expect(mockPolls.storeEvaluation).toHaveBeenCalledWith(
        responseId,
        studentId,
        { outcome: "correct", feedback: "Correct scalar relationship." },
      );
      expect(mockEvidence.applyResponse).toHaveBeenCalledWith(
        studentActor,
        courseId,
        responseId,
      );
      expect(mockPolls.storeMasteryResult).toHaveBeenCalledWith(
        responseId,
        studentId,
        { outcome: "correct", feedback: "Correct scalar relationship." },
        { confidence: 0.85, band: "green", attempts: 1, version: 2 },
      );
      expect(mockPublisher.emitToStudent).toHaveBeenCalledWith(
        studentId,
        "mastery:updated",
        {
          eventId,
          occurredAt: mockTime,
          studentId,
          conceptId,
          confidence: 0.85,
          band: "green",
          evidenceType: "poll",
          attempts: 1,
          version: 2,
        } satisfies MasteryUpdatedEvent,
      );
      expect(result).toEqual({
        responseId,
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Correct scalar relationship." },
        newConfidence: 0.85,
        newBand: "green",
      } satisfies PollResponseResult);
    });

    it("marks evaluation failed and throws 502 BAD_GATEWAY when AI evaluation fails", async () => {
      const pendingResponse: StoredPollResponse = {
        id: responseId,
        questionId: pollId,
        studentId,
        answer: rawAnswer,
        status: "pending",
        evaluation: null,
        answeredAt: mockTime,
      };

      mockPolls.ingestResponse = vi.fn().mockResolvedValue({
        response: pendingResponse,
        inserted: true,
      });
      mockAi.evaluatePollResponse = vi.fn().mockRejectedValue(new Error("AI rate limit / timeout"));

      const service = createService();
      await expect(
        service.respondToPoll(studentActor, pollId, studentId, rawAnswer),
      ).rejects.toMatchObject({
        statusCode: 502,
      });

      expect(mockPolls.markEvaluationFailed).toHaveBeenCalledWith(responseId, studentId);
      expect(mockEvidence.applyResponse).not.toHaveBeenCalled();
      expect(mockPublisher.emitToStudent).not.toHaveBeenCalled();
    });

    it("returns cached result on replay without calling AI, evidence, or broadcasting", async () => {
      const cachedResponse: StoredPollResponse = {
        id: responseId,
        questionId: pollId,
        studentId,
        answer: rawAnswer,
        status: "evaluated",
        evaluation: {
          outcome: "correct",
          feedback: "Previously evaluated.",
          mastery: {
            confidence: 0.85,
            band: "green",
            attempts: 1,
            version: 2,
          },
        },
        answeredAt: mockTime,
      };

      mockPolls.ingestResponse = vi.fn().mockResolvedValue({
        response: cachedResponse,
        inserted: false,
      });

      const service = createService();
      const result = await service.respondToPoll(studentActor, pollId, studentId, rawAnswer);

      expect(mockAi.evaluatePollResponse).not.toHaveBeenCalled();
      expect(mockEvidence.applyResponse).not.toHaveBeenCalled();
      expect(mockPublisher.emitToStudent).not.toHaveBeenCalled();
      expect(result).toEqual({
        responseId,
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Previously evaluated." },
        newConfidence: 0.85,
        newBand: "green",
      });
    });

    it("throws 409 POLL_RESPONSE_PENDING when replaying while evaluation is pending", async () => {
      const pendingResponse: StoredPollResponse = {
        id: responseId,
        questionId: pollId,
        studentId,
        answer: rawAnswer,
        status: "pending",
        evaluation: null,
        answeredAt: mockTime,
      };

      mockPolls.ingestResponse = vi.fn().mockResolvedValue({
        response: pendingResponse,
        inserted: false,
      });

      const service = createService();
      await expect(
        service.respondToPoll(studentActor, pollId, studentId, rawAnswer),
      ).rejects.toMatchObject({
        code: "POLL_RESPONSE_PENDING",
        statusCode: 409,
      });
    });

    it("throws 503 SERVICE_UNAVAILABLE when replaying a failed evaluation", async () => {
      const failedResponse: StoredPollResponse = {
        id: responseId,
        questionId: pollId,
        studentId,
        answer: rawAnswer,
        status: "failed",
        evaluation: null,
        answeredAt: mockTime,
      };

      mockPolls.ingestResponse = vi.fn().mockResolvedValue({
        response: failedResponse,
        inserted: false,
      });

      const service = createService();
      await expect(
        service.respondToPoll(studentActor, pollId, studentId, rawAnswer),
      ).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining("failed"),
      });
    });
  });
});
