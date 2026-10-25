import type { ActorContext, UUID, Clock, IdGenerator, MasteryBand } from "../../../../src/contracts/common.js";
import type { ConceptNode } from "../../../../src/contracts/course.js";
import type { TutoringMessage } from "../../../../src/contracts/learning.js";
import { AppError, DomainErrorCode } from "../../../../src/contracts/errors.js";
import { applyMasteryEvidence } from "../../../../src/contracts/mastery.js";
import type {
  TutoringRepositoryPort,
  TutoringSessionRecord,
} from "../../../../src/server/learning/index.js";

// Canonical test fixtures
export const FIXTURE_COURSE_ID: UUID = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_OTHER_COURSE_ID: UUID = "99999999-9999-4999-8999-999999999999";
export const FIXTURE_STUDENT_ID: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const FIXTURE_STUDENT_AUTH_ID: UUID = "12121212-1212-4212-8212-121212121212";
export const FIXTURE_CONCEPT_1: UUID = "33333333-3333-4333-8333-333333333301";
export const FIXTURE_CONCEPT_2: UUID = "33333333-3333-4333-8333-333333333302";
export const FIXTURE_CROSS_COURSE_CONCEPT: UUID = "44444444-4444-4444-8444-444444444401";

export function createStudentActor(overrides?: Partial<ActorContext>): ActorContext {
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

export function createTeacherActor(): ActorContext {
  return {
    userId: "22222222-2222-4222-8222-222222222222",
    authId: "77777777-7777-4777-8777-777777777777",
    name: "Professor Babbage",
    email: "prof@example.com",
    role: "teacher",
    enrolledCourses: [],
  };
}

export class InMemoryTutoringRepository implements TutoringRepositoryPort {
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

export class TestMasteryService {
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

export class SequentialIdGenerator implements IdGenerator {
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

export class FrozenClock implements Clock {
  constructor(private fixedDate: Date = new Date("2026-10-21T12:00:00.000Z")) {}
  now(): Date {
    return this.fixedDate;
  }
  nowISO(): string {
    return this.fixedDate.toISOString();
  }
}
