import {
  type UUID,
  type ISOTimestamp,
  type LectureSession,
  type TranscriptChunk,
  type PollQuestion,
  type PollNewQuestionEvent,
  type PollClosedEvent,
  type TranscriptChunkEvent,
  type ConceptDetectedEvent,
  type LectureEndedEvent,
  type MasteryUpdatedEvent,
  type ClassroomService,
  type RealtimePublisher,
  type LectureSnapshot,
  type PollResponseResult,
  type ActorContext,
  applyMasteryEvidence,
  AppError,
  DomainErrorCode,
} from "../../src/contracts/index.js";

export const FIXTURE_COURSE_ID: UUID = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_TEACHER_ID: UUID = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_STUDENT_ID: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const FIXTURE_CONCEPT_ID_1: UUID = "33333333-3333-4333-8333-333333333316";
export const FIXTURE_CONCEPT_ID_2: UUID = "33333333-3333-4333-8333-333333333317";
export const FIXTURE_CHUNK_ID: UUID = "55555555-5555-4555-8555-555555555555";
export const FIXTURE_POLL_ID: UUID = "77777777-7777-4777-8777-777777777777";
export const FIXTURE_LECTURE_ID: UUID = "88888888-8888-4888-8888-888888888888";
export const FIXTURE_MATCH_ID: UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

export const FIXTURE_LIVE_LECTURE: LectureSession = {
  id: FIXTURE_LECTURE_ID,
  courseId: FIXTURE_COURSE_ID,
  title: "Lecture 4: Gradient Descent & Loss Optimization",
  status: "live",
  startedAt: "2026-10-20T14:00:00.000Z",
};

export const FIXTURE_COMPLETED_LECTURE: LectureSession = {
  id: "88888888-8888-4888-8888-888888888889",
  courseId: FIXTURE_COURSE_ID,
  title: "Lecture 3: Neural Network Fundamentals",
  status: "completed",
  startedAt: "2026-10-18T14:00:00.000Z",
  endedAt: "2026-10-18T15:20:00.000Z",
};

export const FIXTURE_DRAFT_POLL: PollQuestion = {
  id: "77777777-7777-4777-8777-777777777776",
  lectureId: FIXTURE_LECTURE_ID,
  conceptId: FIXTURE_CONCEPT_ID_1,
  question: "How does batch size affect gradient variance in stochastic gradient descent?",
  expectedAnswer: "Smaller batch sizes increase gradient noise and variance, providing regularization.",
  status: "draft",
  generatedAt: "2026-10-20T14:20:00.000Z",
};

export const FIXTURE_ACTIVE_POLL: PollQuestion = {
  id: FIXTURE_POLL_ID,
  lectureId: FIXTURE_LECTURE_ID,
  conceptId: FIXTURE_CONCEPT_ID_2,
  question:
    "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
  expectedAnswer:
    "An excessively large learning rate causes the parameters to overshoot the local minimum, oscillate wildly, or diverge.",
  status: "active",
  generatedAt: "2026-10-20T14:34:00.000Z",
  activatedAt: "2026-10-20T14:35:09.500Z",
};

export const FIXTURE_CLOSED_POLL: PollQuestion = {
  id: "77777777-7777-4777-8777-777777777778",
  lectureId: FIXTURE_LECTURE_ID,
  conceptId: FIXTURE_CONCEPT_ID_2,
  question: "What is the primary stopping condition for early stopping in iterative training?",
  expectedAnswer: "Validation loss fails to improve for a pre-defined patience window of epochs.",
  status: "closed",
  generatedAt: "2026-10-20T14:10:00.000Z",
  activatedAt: "2026-10-20T14:11:00.000Z",
  closedAt: "2026-10-20T14:15:00.000Z",
};

export const FIXTURE_TRANSCRIPT_CHUNKS: TranscriptChunk[] = [
  {
    id: FIXTURE_CHUNK_ID,
    lectureId: FIXTURE_LECTURE_ID,
    text: "When optimizing deep networks, selecting the proper learning rate is paramount.",
    timestampSec: 120,
    speakerName: "Dr. Smith",
    detectedConceptIds: [FIXTURE_CONCEPT_ID_1, FIXTURE_CONCEPT_ID_2],
    createdAt: "2026-10-20T14:02:00.000Z",
  },
];

/**
 * Socket event payloads matching docs/contracts/examples.md verbatim
 */
export const FIXTURE_POLL_NEW_QUESTION_PAYLOAD = {
  eventId: "66666666-6666-4666-8666-666666666601",
  occurredAt: "2026-10-20T14:35:10.000Z",
  pollId: "77777777-7777-4777-8777-777777777777",
  lectureId: "88888888-8888-4888-8888-888888888888",
  conceptId: "33333333-3333-4333-8333-333333333317",
  question:
    "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
  status: "active" as const,
  activatedAt: "2026-10-20T14:35:09.500Z",
};

export const FIXTURE_MASTERY_UPDATED_PAYLOAD = {
  eventId: "66666666-6666-4666-8666-666666666602",
  occurredAt: "2026-10-20T14:36:02.120Z",
  studentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  conceptId: "33333333-3333-4333-8333-333333333317",
  confidence: 0.85,
  band: "green" as const,
  evidenceType: "poll" as const,
  attempts: 1,
  version: 2,
};

export const FIXTURE_STUDY_GROUP_UPDATED_PAYLOAD = {
  eventId: "66666666-6666-4666-8666-666666666603",
  occurredAt: "2026-10-20T16:12:45.000Z",
  matchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  schedulingStatus: "accepted" as const,
  proposedSlot: {
    startsAt: "2026-10-21T15:00:00.000Z",
    endsAt: "2026-10-21T15:30:00.000Z",
  },
  student1Accepted: true,
  student2Accepted: true,
  zoomLink: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
  meetingStatus: "created" as const,
};

export const FIXTURE_TRANSCRIPT_INGEST_RESPONSE = {
  chunkId: "55555555-5555-4555-8555-555555555555",
  detectedConceptIds: [
    "33333333-3333-4333-8333-333333333316",
    "33333333-3333-4333-8333-333333333317",
  ],
};

export const FIXTURE_POLL_RESPOND_RESPONSE = {
  responseId: "99999999-9999-4999-8999-999999999999",
  status: "evaluated" as const,
  evaluation: {
    outcome: "correct" as const,
    feedback:
      "Excellent reasoning. You correctly identified that an excessively large learning rate causes the parameters to overshoot the local minimum and diverge.",
  },
  newConfidence: 0.85,
  newBand: "green" as const,
};

export const FIXTURE_STUDY_GROUP_OPT_IN_RESPONSE = {
  status: "matched" as const,
  matchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  expiresAt: "2026-10-20T16:05:00.000Z",
};

/**
 * Asserts that a poll payload omits expectedAnswer and rubric (SC-08)
 */
export function assertPollOmitsExpectedAnswer(payload: unknown): void {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Payload must be a non-null object");
  }
  const obj = payload as Record<string, unknown>;
  if ("expectedAnswer" in obj) {
    throw new Error(
      "SC-08 Privacy Violation: Poll payload leaked 'expectedAnswer' to client"
    );
  }
  if ("rubric" in obj) {
    throw new Error(
      "SC-08 Privacy Violation: Poll payload leaked 'rubric' to client"
    );
  }
}

/**
 * Transforms a PollQuestion into a client-safe PollNewQuestionEvent omitting expectedAnswer
 */
export function toPollNewQuestionEvent(
  poll: PollQuestion,
  eventId?: UUID,
  occurredAt?: ISOTimestamp
): PollNewQuestionEvent {
  const event: PollNewQuestionEvent = {
    eventId: eventId ?? (crypto.randomUUID ? crypto.randomUUID() : "66666666-6666-4666-8666-666666666601"),
    occurredAt: occurredAt ?? (poll.activatedAt ?? new Date().toISOString()),
    pollId: poll.id,
    lectureId: poll.lectureId,
    conceptId: poll.conceptId,
    question: poll.question,
    status: "active",
    activatedAt: poll.activatedAt ?? new Date().toISOString(),
  };
  assertPollOmitsExpectedAnswer(event);
  return event;
}

export class FakeRealtimePublisher implements RealtimePublisher {
  public readonly lectureEmissions: Array<{ lectureId: UUID; event: string; payload: unknown }> = [];
  public readonly teacherEmissions: Array<{ lectureId: UUID; event: string; payload: unknown }> = [];
  public readonly studentEmissions: Array<{ studentId: UUID; event: string; payload: unknown }> = [];
  public readonly studyGroupEmissions: Array<{ matchId: UUID; event: string; payload: unknown }> = [];

  async emitToLecture(lectureId: UUID, event: string, payload: unknown): Promise<void> {
    this.lectureEmissions.push({ lectureId, event, payload });
  }

  async emitToTeacher(lectureId: UUID, event: string, payload: unknown): Promise<void> {
    this.teacherEmissions.push({ lectureId, event, payload });
  }

  async emitToStudent(studentId: UUID, event: string, payload: unknown): Promise<void> {
    this.studentEmissions.push({ studentId, event, payload });
  }

  async emitToStudyGroup(matchId: UUID, event: string, payload: unknown): Promise<void> {
    this.studyGroupEmissions.push({ matchId, event, payload });
  }

  clear(): void {
    this.lectureEmissions.length = 0;
    this.teacherEmissions.length = 0;
    this.studentEmissions.length = 0;
    this.studyGroupEmissions.length = 0;
  }
}

export class FakeClassroomService implements ClassroomService {
  private lectures = new Map<UUID, LectureSession>();
  private chunks = new Map<UUID, TranscriptChunk[]>();
  private polls = new Map<UUID, PollQuestion>();
  private pollResponses = new Map<string, { studentId: UUID; answer: string; outcome: "correct" | "partial" | "wrong" }>();
  private studentMastery = new Map<string, number>();

  constructor(private publisher?: RealtimePublisher) {
    // Seed initial fixtures
    this.lectures.set(FIXTURE_LIVE_LECTURE.id, { ...FIXTURE_LIVE_LECTURE });
    this.chunks.set(FIXTURE_LIVE_LECTURE.id, [...FIXTURE_TRANSCRIPT_CHUNKS]);
    this.polls.set(FIXTURE_ACTIVE_POLL.id, { ...FIXTURE_ACTIVE_POLL });
  }

  async startLecture(
    _actor: ActorContext,
    courseId: UUID,
    title: string
  ): Promise<LectureSession> {
    const lectureId = crypto.randomUUID ? crypto.randomUUID() : "88888888-8888-4888-8888-888888888899";
    const lecture: LectureSession = {
      id: lectureId,
      courseId,
      title,
      status: "live",
      startedAt: new Date().toISOString(),
    };
    this.lectures.set(lecture.id, lecture);
    this.chunks.set(lecture.id, []);
    return lecture;
  }

  async endLecture(
    _actor: ActorContext,
    lectureId: UUID
  ): Promise<LectureSession> {
    const lecture = this.lectures.get(lectureId);
    if (!lecture) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Lecture session ${lectureId} not found`,
      });
    }

    if (lecture.status === "completed") {
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: `Lecture session ${lectureId} is already completed`,
      });
    }

    const endedAt = new Date().toISOString();
    const updated: LectureSession = {
      ...lecture,
      status: "completed",
      endedAt,
    };
    this.lectures.set(lectureId, updated);

    if (this.publisher) {
      const payload: LectureEndedEvent = {
        eventId: crypto.randomUUID ? crypto.randomUUID() : "66666666-6666-4666-8666-666666666614",
        occurredAt: endedAt,
        lectureId,
        endedAt,
      };
      await this.publisher.emitToLecture(lectureId, "lecture:ended", payload);
    }

    return updated;
  }

  async getLectureSnapshot(
    _actor: ActorContext,
    lectureId: UUID
  ): Promise<LectureSnapshot> {
    const lecture = this.lectures.get(lectureId);
    if (!lecture) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Lecture session ${lectureId} not found`,
      });
    }

    const lecturePolls = Array.from(this.polls.values()).filter(
      (p) => p.lectureId === lectureId
    );
    const activePoll = lecturePolls.find((p) => p.status === "active") ?? null;
    const recentChunks = this.chunks.get(lectureId) ?? [];

    const activeConceptIdsSet = new Set<UUID>();
    for (const chunk of recentChunks) {
      for (const conceptId of chunk.detectedConceptIds) {
        activeConceptIdsSet.add(conceptId);
      }
    }
    if (activePoll) {
      activeConceptIdsSet.add(activePoll.conceptId);
    }

    return {
      lecture,
      activePoll,
      recentChunks,
      activeConceptIds: Array.from(activeConceptIdsSet),
    };
  }

  async ingestTranscriptChunk(
    _actor: ActorContext,
    lectureId: UUID,
    text: string,
    timestampSec: number,
    speakerName?: string,
    provenance?: { isSimulated: boolean }
  ): Promise<TranscriptChunk> {
    const lecture = this.lectures.get(lectureId);
    if (!lecture) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Lecture session ${lectureId} not found`,
      });
    }

    if (lecture.status !== "live") {
      throw new AppError({
        code: DomainErrorCode.BAD_REQUEST,
        statusCode: 400,
        message: "Cannot ingest transcript chunks into an inactive lecture",
      });
    }

    const chunkId = crypto.randomUUID ? crypto.randomUUID() : "55555555-5555-4555-8555-555555555599";
    const detectedConceptIds: UUID[] = [FIXTURE_CONCEPT_ID_1];
    if (text.toLowerCase().includes("gradient") || text.toLowerCase().includes("rate")) {
      detectedConceptIds.push(FIXTURE_CONCEPT_ID_2);
    }

    const createdAt = new Date().toISOString();
    const chunk: TranscriptChunk = {
      id: chunkId,
      lectureId,
      text,
      timestampSec,
      speakerName,
      detectedConceptIds,
      createdAt,
    };
    if (provenance?.isSimulated !== undefined) {
      chunk.isSimulated = provenance.isSimulated;
    }

    const existing = this.chunks.get(lectureId) ?? [];
    existing.push(chunk);
    this.chunks.set(lectureId, existing);

    if (this.publisher) {
      const chunkPayload: TranscriptChunkEvent = {
        eventId: crypto.randomUUID ? crypto.randomUUID() : "66666666-6666-4666-8666-666666666610",
        occurredAt: createdAt,
        chunkId,
        lectureId,
        text,
        timestampSec,
        speakerName,
      };
      if (chunk.isSimulated !== undefined) {
        chunkPayload.isSimulated = chunk.isSimulated;
      }
      await this.publisher.emitToLecture(lectureId, "transcript:chunk", chunkPayload);

      const conceptPayload: ConceptDetectedEvent = {
        eventId: crypto.randomUUID ? crypto.randomUUID() : "66666666-6666-4666-8666-666666666611",
        occurredAt: createdAt,
        lectureId,
        conceptIds: detectedConceptIds,
      };
      await this.publisher.emitToLecture(lectureId, "lecture:concept-detected", conceptPayload);
    }

    return chunk;
  }

  async generatePoll(
    _actor: ActorContext,
    lectureId: UUID,
    conceptId?: UUID
  ): Promise<PollQuestion> {
    const lecture = this.lectures.get(lectureId);
    if (!lecture) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Lecture session ${lectureId} not found`,
      });
    }

    const pollId = crypto.randomUUID ? crypto.randomUUID() : "77777777-7777-4777-8777-777777777799";
    const poll: PollQuestion = {
      id: pollId,
      lectureId,
      conceptId: conceptId ?? FIXTURE_CONCEPT_ID_2,
      question:
        "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
      expectedAnswer:
        "An excessively large learning rate causes parameters to overshoot the local minimum and diverge.",
      status: "draft",
      generatedAt: new Date().toISOString(),
    };
    this.polls.set(poll.id, poll);
    return poll;
  }

  async activatePoll(
    _actor: ActorContext,
    pollId: UUID
  ): Promise<PollQuestion> {
    const poll = this.polls.get(pollId);
    if (!poll) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Poll question ${pollId} not found`,
      });
    }

    const existingActive = Array.from(this.polls.values()).find(
      (p) => p.lectureId === poll.lectureId && p.status === "active" && p.id !== pollId
    );
    if (existingActive) {
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: `An active poll (${existingActive.id}) already exists in lecture ${poll.lectureId}`,
      });
    }

    const activatedAt = new Date().toISOString();
    const updated: PollQuestion = {
      ...poll,
      status: "active",
      activatedAt,
    };
    this.polls.set(pollId, updated);

    if (this.publisher) {
      const broadcastEvent = toPollNewQuestionEvent(updated);
      assertPollOmitsExpectedAnswer(broadcastEvent);
      await this.publisher.emitToLecture(
        updated.lectureId,
        "poll:new-question",
        broadcastEvent
      );
    }

    return updated;
  }

  async respondToPoll(
    _actor: ActorContext,
    pollId: UUID,
    studentId: UUID,
    answer: string
  ): Promise<PollResponseResult> {
    const poll = this.polls.get(pollId);
    if (!poll) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Poll question ${pollId} not found`,
      });
    }

    if (poll.status !== "active") {
      throw new AppError({
        code: DomainErrorCode.BAD_REQUEST,
        statusCode: 400,
        message: `Cannot respond to poll ${pollId} with status '${poll.status}'`,
      });
    }

    const responseKey = `${pollId}:${studentId}`;
    if (this.pollResponses.has(responseKey)) {
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: `Student ${studentId} has already submitted a response for poll ${pollId}`,
      });
    }

    const lower = answer.toLowerCase();
    let outcome: "correct" | "partial" | "wrong";
    let feedback: string;

    if (lower.includes("overshoot") || lower.includes("diverge")) {
      outcome = "correct";
      feedback =
        "Excellent reasoning. You correctly identified that an excessively large learning rate causes the parameters to overshoot the local minimum and diverge.";
    } else if (lower.includes("oscillat") || lower.includes("bounce")) {
      outcome = "partial";
      feedback =
        "Good intuition regarding oscillation, but remember that severe overshoot leads to divergent parameter updates.";
    } else {
      outcome = "wrong";
      feedback =
        "Incorrect. A large learning rate destabilizes gradient descent rather than speeding convergence.";
    }

    this.pollResponses.set(responseKey, { studentId, answer, outcome });

    const masteryKey = `${studentId}:${poll.conceptId}`;
    const currentConfidence = this.studentMastery.get(masteryKey) ?? 0.0;
    const { confidence: newConfidence, band: newBand } = applyMasteryEvidence(
      currentConfidence,
      {
        type: "poll",
        outcome,
        sourceId: pollId,
      }
    );
    this.studentMastery.set(masteryKey, newConfidence);

    const responseId = crypto.randomUUID ? crypto.randomUUID() : "99999999-9999-4999-8999-999999999999";

    if (this.publisher) {
      const masteryEvent: MasteryUpdatedEvent = {
        eventId: crypto.randomUUID ? crypto.randomUUID() : "66666666-6666-4666-8666-666666666602",
        occurredAt: new Date().toISOString(),
        studentId,
        conceptId: poll.conceptId,
        confidence: newConfidence,
        band: newBand,
        evidenceType: "poll",
        attempts: 1,
        version: 2,
      };
      await this.publisher.emitToStudent(studentId, "mastery:updated", masteryEvent);
    }

    return {
      responseId,
      status: "evaluated",
      evaluation: {
        outcome,
        feedback,
      },
      newConfidence,
      newBand,
    };
  }

  async closePoll(
    _actor: ActorContext,
    pollId: UUID
  ): Promise<PollQuestion> {
    const poll = this.polls.get(pollId);
    if (!poll) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: `Poll question ${pollId} not found`,
      });
    }

    const closedAt = new Date().toISOString();
    const updated: PollQuestion = {
      ...poll,
      status: "closed",
      closedAt,
    };
    this.polls.set(pollId, updated);

    if (this.publisher) {
      const closedEvent: PollClosedEvent = {
        eventId: crypto.randomUUID ? crypto.randomUUID() : "66666666-6666-4666-8666-666666666612",
        occurredAt: closedAt,
        pollId,
        lectureId: poll.lectureId,
        status: "closed",
        closedAt,
      };
      await this.publisher.emitToLecture(poll.lectureId, "poll:closed", closedEvent);
    }

    return updated;
  }
}
