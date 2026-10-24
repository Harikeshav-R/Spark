import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActorContext, UUID, Clock, IdGenerator, MasteryBand } from "../../../src/contracts/common.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import type { TutoringMessage } from "../../../src/contracts/learning.js";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import { applyMasteryEvidence } from "../../../src/contracts/mastery.js";
import {
  TutoringService,
  TutoringRepository,
  type TutoringRepositoryPort,
  type TutoringSessionRecord,
} from "../../../src/server/learning/index.js";
import { SocraticTutorAi } from "../../../src/server/ai/index.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";

// Canonical test fixtures
const FIXTURE_COURSE_ID: UUID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_OTHER_COURSE_ID: UUID = "99999999-9999-4999-8999-999999999999";
const FIXTURE_STUDENT_ID: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIXTURE_STUDENT_AUTH_ID: UUID = "12121212-1212-4212-8212-121212121212";
const FIXTURE_CONCEPT_1: UUID = "33333333-3333-4333-8333-333333333301";
const FIXTURE_CONCEPT_2: UUID = "33333333-3333-4333-8333-333333333302";
const FIXTURE_CROSS_COURSE_CONCEPT: UUID = "44444444-4444-4444-8444-444444444401";

function createStudentActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    userId: FIXTURE_STUDENT_ID,
    authId: FIXTURE_STUDENT_AUTH_ID,
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "student",
    enrolledCourses: [
      {
        studentId: FIXTURE_STUDENT_ID,
        courseId: FIXTURE_COURSE_ID,
      },
    ],
    ...overrides,
  };
}

function createTeacherActor(): ActorContext {
  return {
    userId: "22222222-2222-4222-8222-222222222222",
    authId: "77777777-7777-4777-8777-777777777777",
    name: "Professor Babbage",
    email: "prof@example.com",
    role: "teacher",
    enrolledCourses: [],
  };
}

class InMemoryTutoringRepository implements TutoringRepositoryPort {
  sessions = new Map<UUID, TutoringSessionRecord>();
  messages = new Map<UUID, TutoringMessage[]>();
  concepts = new Map<UUID, ConceptNode>();

  constructor() {
    this.concepts.set(FIXTURE_CONCEPT_1, {
      id: FIXTURE_CONCEPT_1,
      courseId: FIXTURE_COURSE_ID,
      label: "Backpropagation",
      description: "Gradient computation via chain rule through network layers",
      category: "Optimization",
      difficulty: 4,
      createdAt: "2026-10-20T10:00:00.000Z",
    });
    this.concepts.set(FIXTURE_CONCEPT_2, {
      id: FIXTURE_CONCEPT_2,
      courseId: FIXTURE_COURSE_ID,
      label: "Gradient Descent",
      description: "Iterative optimization moving parameters along negative gradient",
      category: "Optimization",
      difficulty: 2,
      createdAt: "2026-10-20T10:00:00.000Z",
    });
    this.concepts.set(FIXTURE_CROSS_COURSE_CONCEPT, {
      id: FIXTURE_CROSS_COURSE_CONCEPT,
      courseId: FIXTURE_OTHER_COURSE_ID,
      label: "Foreign Concept",
      description: "Concept from a different course",
      category: "Foreign",
      difficulty: 3,
      createdAt: "2026-10-20T10:00:00.000Z",
    });
  }

  async createSession(
    actor: ActorContext,
    sessionId: UUID,
    studentId: UUID,
    conceptIds: UUID[],
    startedAt: string
  ): Promise<TutoringSessionRecord> {
    if (actor.role !== "student") {
      throw new AppError({ code: DomainErrorCode.FORBIDDEN, statusCode: 403, message: "Forbidden" });
    }
    const enrollment = actor.enrolledCourses.find((e) => e.studentId === studentId);
    if (!enrollment) {
      throw new AppError({ code: DomainErrorCode.FORBIDDEN, statusCode: 403, message: "Not enrolled" });
    }
    for (const cid of conceptIds) {
      const c = this.concepts.get(cid);
      if (!c || c.courseId !== enrollment.courseId) {
        throw new AppError({
          code: DomainErrorCode.NOT_FOUND,
          statusCode: 404,
          message: "Target concept not found in course",
        });
      }
    }
    const record: TutoringSessionRecord = {
      id: sessionId,
      studentId,
      courseId: enrollment.courseId,
      targetConcepts: Array.from(new Set(conceptIds)),
      startedAt,
      endedAt: null,
    };
    this.sessions.set(sessionId, record);
    this.messages.set(sessionId, []);
    return record;
  }

  async getSession(actor: ActorContext, sessionId: UUID): Promise<TutoringSessionRecord> {
    if (actor.role !== "student") {
      throw new AppError({ code: DomainErrorCode.FORBIDDEN, statusCode: 403, message: "Forbidden" });
    }
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new AppError({ code: DomainErrorCode.NOT_FOUND, statusCode: 404, message: "Session not found" });
    }
    const enrollment = actor.enrolledCourses.find((e) => e.studentId === record.studentId);
    if (!enrollment || enrollment.courseId !== record.courseId) {
      throw new AppError({ code: DomainErrorCode.NOT_FOUND, statusCode: 404, message: "Session not found" });
    }
    return record;
  }

  async getConcept(actor: ActorContext, studentId: UUID, conceptId: UUID): Promise<ConceptNode> {
    if (actor.role !== "student") {
      throw new AppError({ code: DomainErrorCode.FORBIDDEN, statusCode: 403, message: "Forbidden" });
    }
    const enrollment = actor.enrolledCourses.find((e) => e.studentId === studentId);
    if (!enrollment) {
      throw new AppError({ code: DomainErrorCode.FORBIDDEN, statusCode: 403, message: "Not enrolled" });
    }
    const concept = this.concepts.get(conceptId);
    if (!concept || concept.courseId !== enrollment.courseId) {
      throw new AppError({ code: DomainErrorCode.NOT_FOUND, statusCode: 404, message: "Concept not found" });
    }
    return concept;
  }

  async listMessages(actor: ActorContext, sessionId: UUID): Promise<TutoringMessage[]> {
    await this.getSession(actor, sessionId);
    return [...(this.messages.get(sessionId) ?? [])];
  }

  async insertMessage(actor: ActorContext, message: TutoringMessage): Promise<TutoringMessage> {
    const session = await this.getSession(actor, message.sessionId);
    if (message.conceptId && !session.targetConcepts.includes(message.conceptId)) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Concept not in session targets",
      });
    }
    const list = this.messages.get(message.sessionId) ?? [];
    const existing = list.find((m) => m.id === message.id);
    if (existing) {
      if (
        existing.sessionId === message.sessionId &&
        existing.role === message.role &&
        existing.content === message.content &&
        existing.conceptId === message.conceptId &&
        existing.understandingDetected === message.understandingDetected
      ) {
        return existing;
      }
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: "Message already exists with different content",
      });
    }
    list.push(message);
    this.messages.set(message.sessionId, list);
    return message;
  }

  async getMessage(actor: ActorContext, sessionId: UUID, messageId: UUID): Promise<TutoringMessage> {
    await this.getSession(actor, sessionId);
    const list = this.messages.get(sessionId) ?? [];
    const message = list.find((m) => m.id === messageId);
    if (!message) {
      throw new AppError({ code: DomainErrorCode.NOT_FOUND, statusCode: 404, message: "Message not found" });
    }
    return message;
  }
}

class TestMasteryService {
  state: { confidence: number; band: MasteryBand; attempts: number; version: number };
  seenEvidenceKeys = new Set<string>();

  constructor(initialConfidence = 0.2) {
    this.state = {
      confidence: initialConfidence,
      band: initialConfidence < 0.4 ? "red" : initialConfidence < 0.7 ? "yellow" : "green",
      attempts: 1,
      version: 1,
    };
  }

  async applyEvidence(
    _actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    evidence: { type: "tutor"; sourceId: UUID }
  ): Promise<{ confidence: number; band: MasteryBand; attempts: number; version: number }> {
    const key = `${evidence.type}:${evidence.sourceId}:${studentId}:${conceptId}`;
    if (this.seenEvidenceKeys.has(key)) {
      // Idempotent duplicate: return current state without incrementing attempts, version, or modifying confidence
      return { ...this.state };
    }

    this.seenEvidenceKeys.add(key);
    const computed = applyMasteryEvidence(this.state.confidence, evidence);
    this.state = {
      confidence: computed.confidence,
      band: computed.band,
      attempts: this.state.attempts, // Tutoring breakthrough does not increase practice attempts
      version: this.state.version + 1,
    };
    return { ...this.state };
  }
}

class SequentialIdGenerator implements IdGenerator {
  private count = 0;
  generateId(): UUID {
    this.count++;
    const hex = this.count.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  }
  generateJoinCode(): string {
    return "ABC12345";
  }
}

class FrozenClock implements Clock {
  constructor(private fixedDate: Date = new Date("2026-10-21T12:00:00.000Z")) {}
  now(): Date {
    return this.fixedDate;
  }
  nowISO(): string {
    return this.fixedDate.toISOString();
  }
}

describe("P1-C-02: Persistent Socratic Tutoring Engine", () => {
  let repository: InMemoryTutoringRepository;
  let mastery: TestMasteryService;
  let openRouterClient: OpenRouterClient;
  let ai: SocraticTutorAi;
  let ids: SequentialIdGenerator;
  let clock: FrozenClock;
  let service: TutoringService;
  let studentActor: ActorContext;

  beforeEach(() => {
    repository = new InMemoryTutoringRepository();
    mastery = new TestMasteryService(0.2); // Start at 0.20 confidence
    openRouterClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    ai = new SocraticTutorAi(openRouterClient);
    ids = new SequentialIdGenerator();
    clock = new FrozenClock();
    service = new TutoringService({ repository, ai, mastery, ids, clock });
    studentActor = createStudentActor();
  });

  describe("1. Authorization, Boundaries & Input Validation", () => {
    it("rejects teacher actor from creating tutoring session with 403 FORBIDDEN", async () => {
      const teacher = createTeacherActor();
      await expect(
        service.createTutoringSession(teacher, FIXTURE_STUDENT_ID, [FIXTURE_CONCEPT_1])
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(403);
        expect((err as AppError).code).toBe(DomainErrorCode.FORBIDDEN);
        return true;
      });
    });

    it("rejects non-enrolled student from creating tutoring session with 403 FORBIDDEN", async () => {
      const unEnrolledStudent = createStudentActor({ enrolledCourses: [] });
      await expect(
        service.createTutoringSession(unEnrolledStudent, FIXTURE_STUDENT_ID, [FIXTURE_CONCEPT_1])
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(403);
        return true;
      });
    });

    it("rejects cross-course concept in session creation with 404 NOT_FOUND", async () => {
      await expect(
        service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [FIXTURE_CROSS_COURSE_CONCEPT])
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(404);
        return true;
      });
    });

    it("rejects empty target concepts with 400 VALIDATION_ERROR", async () => {
      await expect(
        service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [])
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        return true;
      });
    });

    it("rejects whitespace-only message content with 400 VALIDATION_ERROR without altering DB", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      await expect(
        service.submitTutoringMessage(studentActor, sessionId, "    \n\t   ")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        return true;
      });

      const messages = await repository.listMessages(studentActor, sessionId);
      expect(messages).toHaveLength(0);
    });

    it("rejects message to unknown session ID with 404 NOT_FOUND", async () => {
      const randomSessionId: UUID = "99999999-9999-4999-8999-000000000000";
      await expect(
        service.submitTutoringMessage(studentActor, randomSessionId, "Hello")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(404);
        return true;
      });
    });

    it("rejects message submitted to ended session with 409 CONFLICT", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      const session = repository.sessions.get(sessionId);
      if (session) {
        session.endedAt = "2026-10-21T12:05:00.000Z";
      }

      await expect(
        service.submitTutoringMessage(studentActor, sessionId, "Can you help me?")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe(DomainErrorCode.CONFLICT);
        return true;
      });
    });
  });

  describe("2. Socratic Turn Dialogue & Mastery Progression", () => {
    it("first turn 'I am unsure' persists user and assistant messages with NO mastery evidence", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      const response = await service.submitTutoringMessage(studentActor, sessionId, "I am unsure");

      expect(response.understandingDetected).toBe(false);
      expect(response.masteryUpdated).toBeUndefined();
      expect(response.assistantContent).toContain("Backpropagation");

      // Verify repository contains 2 messages: user and assistant
      const messages = await repository.listMessages(studentActor, sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("I am unsure");
      expect(messages[0].understandingDetected).toBe(false);
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBe(response.assistantContent);
      expect(messages[1].understandingDetected).toBe(false);

      // Verify mastery state was NOT updated
      expect(mastery.state.confidence).toBe(0.2);
      expect(mastery.state.version).toBe(1);
      expect(mastery.seenEvidenceKeys.size).toBe(0);
    });

    it("second turn breakthrough advances mastery from 0.20 to 0.40/yellow and passes prior history exactly once", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      // Turn 1: student unsure
      await service.submitTutoringMessage(studentActor, sessionId, "I am unsure");

      // Spy on AI turn to observe exact conversation history passed to prompt
      const aiSpy = vi.spyOn(ai, "socraticTutorTurn");

      // Turn 2: conceptual breakthrough
      const breakthroughText = "The chain rule combines local gradients through intermediate activations";
      const response = await service.submitTutoringMessage(studentActor, sessionId, breakthroughText);

      expect(response.understandingDetected).toBe(true);
      expect(response.masteryUpdated).toEqual({
        confidence: 0.4,
        band: "yellow",
      });
      expect(response.assistantContent).toContain("Outstanding breakthrough");

      // Verify AI spy received prior history exactly once
      expect(aiSpy).toHaveBeenCalledTimes(1);
      const callArgs = aiSpy.mock.calls[0];
      const conceptArg = callArgs[0];
      const historyArg = callArgs[1];
      const newMsgArg = callArgs[2];

      expect(conceptArg.id).toBe(FIXTURE_CONCEPT_1);
      expect(newMsgArg).toBe(breakthroughText);
      expect(historyArg).toHaveLength(2); // exactly turn 1's user and assistant messages
      expect(historyArg[0].role).toBe("user");
      expect(historyArg[0].content).toBe("I am unsure");
      expect(historyArg[1].role).toBe("assistant");

      // Verify repository now has 4 ordered messages
      const allMessages = await repository.listMessages(studentActor, sessionId);
      expect(allMessages).toHaveLength(4);
      expect(allMessages[2].role).toBe("user");
      expect(allMessages[2].content).toBe(breakthroughText);
      expect(allMessages[3].role).toBe("assistant");
      expect(allMessages[3].understandingDetected).toBe(true);

      // Verify mastery service was updated: 0.20 -> 0.40 (yellow), version incremented to 2, attempts unchanged
      expect(mastery.state.confidence).toBe(0.4);
      expect(mastery.state.band).toBe("yellow");
      expect(mastery.state.version).toBe(2);
      expect(mastery.state.attempts).toBe(1);
      expect(mastery.seenEvidenceKeys.size).toBe(1);
    });

    it("advances 0.90 to 1.00/green on breakthrough", async () => {
      const highMastery = new TestMasteryService(0.9);
      const customService = new TutoringService({
        repository,
        ai,
        mastery: highMastery,
        ids,
        clock,
      });

      const { sessionId } = await customService.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      const response = await customService.submitTutoringMessage(
        studentActor,
        sessionId,
        "The chain rule propagates local gradients through intermediate activations"
      );

      expect(response.understandingDetected).toBe(true);
      expect(response.masteryUpdated).toEqual({
        confidence: 1.0,
        band: "green",
      });
      expect(highMastery.state.confidence).toBe(1.0);
      expect(highMastery.state.band).toBe("green");
    });
  });

  describe("3. Idempotent Replay & Same-Message-ID Invariant", () => {
    it("replaying the same persisted assistant message UUID preserves confidence and version across service instances", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      const response = await service.submitTutoringMessage(
        studentActor,
        sessionId,
        "The chain rule combines intermediate activations"
      );
      expect(response.understandingDetected).toBe(true);
      expect(mastery.state.confidence).toBe(0.4);
      expect(mastery.state.version).toBe(2);

      const messages = await repository.listMessages(studentActor, sessionId);
      const assistantMessage = messages[messages.length - 1];
      expect(assistantMessage.role).toBe("assistant");

      // Replay 1 via applyUnderstandingEvidence on same service
      const replay1 = await service.applyUnderstandingEvidence(
        studentActor,
        sessionId,
        assistantMessage.id
      );
      expect(replay1.confidence).toBe(0.4);
      expect(replay1.band).toBe("yellow");
      expect(mastery.state.confidence).toBe(0.4);
      expect(mastery.state.version).toBe(2); // NOT incremented
      expect(mastery.seenEvidenceKeys.size).toBe(1);

      // Replay 2 via fresh service instance sharing underlying repository & mastery stores
      const freshService = new TutoringService({
        repository,
        ai,
        mastery,
        ids: new SequentialIdGenerator(),
        clock: new FrozenClock(),
      });

      const replay2 = await freshService.applyUnderstandingEvidence(
        studentActor,
        sessionId,
        assistantMessage.id
      );
      expect(replay2.confidence).toBe(0.4);
      expect(replay2.band).toBe("yellow");
      expect(mastery.state.confidence).toBe(0.4);
      expect(mastery.state.version).toBe(2);
      expect(mastery.seenEvidenceKeys.size).toBe(1);
    });

    it("rejects applyUnderstandingEvidence on non-assistant or non-understanding message", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      await service.submitTutoringMessage(studentActor, sessionId, "I am unsure");
      const messages = await repository.listMessages(studentActor, sessionId);
      const userMessage = messages[0];
      const assistantMessage = messages[1]; // understandingDetected: false

      // On user message -> 400
      await expect(
        service.applyUnderstandingEvidence(studentActor, sessionId, userMessage.id)
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        return true;
      });

      // On assistant message without understanding -> 400
      await expect(
        service.applyUnderstandingEvidence(studentActor, sessionId, assistantMessage.id)
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        return true;
      });
    });
  });

  describe("4. Monotonic Timestamps Under Frozen Clock", () => {
    it("generates strictly monotonically increasing timestamps for turns even under frozen clock", async () => {
      const { sessionId } = await service.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      await service.submitTutoringMessage(studentActor, sessionId, "Turn 1");
      await service.submitTutoringMessage(studentActor, sessionId, "Turn 2");

      const messages = await repository.listMessages(studentActor, sessionId);
      expect(messages).toHaveLength(4);

      const t0 = new Date(messages[0].createdAt).getTime();
      const t1 = new Date(messages[1].createdAt).getTime();
      const t2 = new Date(messages[2].createdAt).getTime();
      const t3 = new Date(messages[3].createdAt).getTime();

      expect(t1).toBeGreaterThan(t0);
      expect(t2).toBeGreaterThan(t1);
      expect(t3).toBeGreaterThan(t2);
    });
  });

  describe("5. Failure Isolation & Atomicity", () => {
    it("AI provider failure leaves user message committed without assistant message or mastery modification", async () => {
      const failingAi = {
        socraticTutorTurn: vi.fn().mockRejectedValue(
          new AppError({
            code: DomainErrorCode.GATEWAY_TIMEOUT,
            statusCode: 504,
            message: "Provider timeout",
          })
        ),
      };

      const customService = new TutoringService({
        repository,
        ai: failingAi,
        mastery,
        ids,
        clock,
      });

      const { sessionId } = await customService.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      await expect(
        customService.submitTutoringMessage(studentActor, sessionId, "Student inquiry")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(504);
        return true;
      });

      // User message is committed; no assistant message or mastery mutation
      const messages = await repository.listMessages(studentActor, sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Student inquiry");

      expect(mastery.state.confidence).toBe(0.2);
      expect(mastery.seenEvidenceKeys.size).toBe(0);
    });

    it("mastery writer failure leaves assistant message persisted for subsequent recovery", async () => {
      const failingMastery = {
        applyEvidence: vi.fn().mockRejectedValue(
          new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Database transaction failed",
          })
        ),
      };

      const customService = new TutoringService({
        repository,
        ai,
        mastery: failingMastery,
        ids,
        clock,
      });

      const { sessionId } = await customService.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_1,
      ]);

      await expect(
        customService.submitTutoringMessage(
          studentActor,
          sessionId,
          "The chain rule combines intermediate activations"
        )
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(500);
        return true;
      });

      // Assistant message is already persisted and can be recovered
      const messages = await repository.listMessages(studentActor, sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].understandingDetected).toBe(true);

      // Now recover by calling applyUnderstandingEvidence with working mastery service
      const workingService = new TutoringService({
        repository,
        ai,
        mastery,
        ids,
        clock,
      });

      const recovery = await workingService.applyUnderstandingEvidence(
        studentActor,
        sessionId,
        messages[1].id
      );
      expect(recovery.confidence).toBe(0.4);
      expect(recovery.band).toBe("yellow");
      expect(mastery.state.confidence).toBe(0.4);
    });
  });

  describe("6. Concrete TutoringRepository Behavior", () => {
    it("handles pagination for messages exceeding 1000 rows without silent truncation", async () => {
      let callCount = 0;
      const sessionId: UUID = "00000000-0000-4000-8000-000000000001";
      const fakeClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "students") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: FIXTURE_STUDENT_ID,
                        auth_id: FIXTURE_STUDENT_AUTH_ID,
                        course_id: FIXTURE_COURSE_ID,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "tutoring_sessions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: sessionId,
                        student_id: FIXTURE_STUDENT_ID,
                        target_concepts: [FIXTURE_CONCEPT_1],
                        started_at: "2026-10-21T12:00:00.000Z",
                        ended_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "tutoring_messages") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      range: vi.fn().mockImplementation((from: number) => {
                        callCount++;
                        const count = callCount === 1 ? 1000 : 50;
                        const rows = Array.from({ length: count }, (_, i) => ({
                          id: `00000000-0000-4000-8000-${(from + i).toString(16).padStart(12, "0")}`,
                          session_id: sessionId,
                          role: "user",
                          content: `Message ${from + i}`,
                          concept_id: FIXTURE_CONCEPT_1,
                          understanding_detected: false,
                          created_at: "2026-10-21T12:00:00.000Z",
                        }));
                        return Promise.resolve({ data: rows, error: null });
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const concreteRepo = new TutoringRepository(fakeClient);
      const messages = await concreteRepo.listMessages(studentActor, sessionId);

      expect(messages).toHaveLength(1050);
      expect(callCount).toBe(2);
    });

    it("rejects duplicate message PK with conflicting attributes with 409 CONFLICT", async () => {
      const sessionId: UUID = "00000000-0000-4000-8000-000000000001";
      const messageId: UUID = "00000000-0000-4000-8000-000000000099";

      interface FluentQueryMock {
        eq: (col: string, val: unknown) => FluentQueryMock;
        in: (col: string, vals: unknown[]) => FluentQueryMock;
        order: () => FluentQueryMock;
        range: () => FluentQueryMock;
        select: () => FluentQueryMock;
        single: () => Promise<{ data: unknown; error: unknown }>;
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        then: <TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) => Promise<TResult1 | TResult2>;
      }

      function createFluent(singleData: unknown, listData?: unknown[]): FluentQueryMock {
        const b: FluentQueryMock = {
          eq: () => b,
          in: () => b,
          order: () => b,
          range: () => b,
          select: () => b,
          single: () => Promise.resolve({ data: singleData, error: null }),
          maybeSingle: () => Promise.resolve({ data: singleData, error: null }),
          then: (onfulfilled, onrejected) =>
            Promise.resolve({ data: listData ?? singleData, error: null }).then(onfulfilled, onrejected),
        };
        return b;
      }

      const studentObj = {
        id: FIXTURE_STUDENT_ID,
        auth_id: FIXTURE_STUDENT_AUTH_ID,
        course_id: FIXTURE_COURSE_ID,
      };

      const fakeClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "students") {
            return {
              select: () => createFluent(studentObj, [studentObj]),
            };
          }
          if (table === "tutoring_sessions") {
            return {
              select: () =>
                createFluent({
                  id: sessionId,
                  student_id: FIXTURE_STUDENT_ID,
                  target_concepts: [FIXTURE_CONCEPT_1],
                  started_at: "2026-10-21T12:00:00.000Z",
                  ended_at: null,
                }),
            };
          }
          if (table === "concept_nodes") {
            return {
              select: () =>
                createFluent({
                  id: FIXTURE_CONCEPT_1,
                  course_id: FIXTURE_COURSE_ID,
                  label: "Backpropagation",
                  description: "Gradients",
                  category: "Optimization",
                  difficulty: 3,
                  created_at: "2026-10-20T10:00:00.000Z",
                }),
            };
          }
          if (table === "tutoring_messages") {
            return {
              select: () =>
                createFluent({
                  id: messageId,
                  session_id: sessionId,
                  role: "user",
                  content: "Original message",
                  concept_id: FIXTURE_CONCEPT_1,
                  understanding_detected: false,
                  created_at: "2026-10-21T12:00:00.000Z",
                }),
              insert: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: null,
                      error: { code: "23505", message: "duplicate key value violates unique constraint" },
                    }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const concreteRepo = new TutoringRepository(fakeClient);

      await expect(
        concreteRepo.insertMessage(studentActor, {
          id: messageId,
          sessionId,
          role: "user",
          content: "Conflicting different content",
          conceptId: FIXTURE_CONCEPT_1,
          understandingDetected: false,
          createdAt: "2026-10-21T12:00:00.000Z",
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe(DomainErrorCode.CONFLICT);
        return true;
      });
    });
  });
});
