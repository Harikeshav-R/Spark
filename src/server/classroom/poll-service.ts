import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type {
  PollQuestion,
  PollResponseResult,
  ClassroomService,
} from "../../contracts/classroom.js";
import {
  pollResponseResultSchema,
} from "../../contracts/classroom.js";
import {
  pollNewQuestionEventSchema,
  pollClosedEventSchema,
  pollResponseCountEventSchema,
  type PollNewQuestionEvent,
  type PollClosedEvent,
  type PollResponseCountEvent,
  type RealtimePublisher,
} from "../../contracts/realtime.js";
import {
  masteryUpdatedEventSchema,
  type MasteryUpdatedEvent,
} from "../../contracts/mastery.js";
import {
  evaluatedPollResponseSchema,
  type EvaluatedPollResponse,
  type AiService,
} from "../../contracts/ai.js";
import { AppError } from "../../contracts/errors.js";
import type { RoomAuthorizer, PresenceTracker } from "../realtime/index.js";
import type { PollEvidenceService } from "../core/index.js";
import type { PollRepository, StoredPollMastery } from "./poll-repository.js";

export interface PollServiceDependencies {
  polls: Pick<
    PollRepository,
    | "getPoll"
    | "transitionPoll"
    | "ingestResponse"
    | "storeEvaluation"
    | "markEvaluationFailed"
    | "storeMasteryResult"
    | "getResponseCount"
  >;
  rooms: Pick<RoomAuthorizer, "authorizeRoom">;
  presence: Pick<PresenceTracker, "getAttendingStudentIds">;
  ai: Pick<AiService, "evaluatePollResponse">;
  evidence: Pick<PollEvidenceService, "applyResponse">;
  publisher: Pick<RealtimePublisher, "emitToLecture" | "emitToStudent" | "emitToTeacher">;
  ids: Pick<IdGenerator, "generateId">;
  clock: Clock;
}

export class PollService
  implements Pick<ClassroomService, "activatePoll" | "respondToPoll" | "closePoll">
{
  constructor(private readonly deps: PollServiceDependencies) {}

  async activatePoll(actor: ActorContext, pollId: UUID): Promise<PollQuestion> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only authorized teachers can activate lecture polls",
      });
    }

    const idResult = uuidSchema.safeParse(pollId);
    if (!idResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid poll ID format",
      });
    }

    const context = await this.deps.polls.getPoll(actor, pollId);
    await this.deps.rooms.authorizeRoom(actor, `professor:${context.poll.lectureId}`);

    const now = this.deps.clock.nowISO ? this.deps.clock.nowISO() : this.deps.clock.now().toISOString();
    const activePoll = await this.deps.polls.transitionPoll(
      actor,
      pollId,
      "active",
      now,
    );

    const eventPayload: PollNewQuestionEvent = {
      eventId: this.deps.ids.generateId(),
      occurredAt: now,
      pollId: activePoll.id,
      lectureId: activePoll.lectureId,
      conceptId: activePoll.conceptId,
      question: activePoll.question,
      status: "active",
      activatedAt: activePoll.activatedAt!,
    };

    const validEvent = pollNewQuestionEventSchema.parse(eventPayload);
    await this.deps.publisher.emitToLecture(activePoll.lectureId, "poll:new-question", validEvent);

    return activePoll;
  }

  async closePoll(actor: ActorContext, pollId: UUID): Promise<PollQuestion> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only authorized teachers can close lecture polls",
      });
    }

    const idResult = uuidSchema.safeParse(pollId);
    if (!idResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid poll ID format",
      });
    }

    const context = await this.deps.polls.getPoll(actor, pollId);
    await this.deps.rooms.authorizeRoom(actor, `professor:${context.poll.lectureId}`);

    const now = this.deps.clock.nowISO ? this.deps.clock.nowISO() : this.deps.clock.now().toISOString();
    const closedPoll = await this.deps.polls.transitionPoll(
      actor,
      pollId,
      "closed",
      now,
    );

    const eventPayload: PollClosedEvent = {
      eventId: this.deps.ids.generateId(),
      occurredAt: now,
      pollId: closedPoll.id,
      lectureId: closedPoll.lectureId,
      status: "closed",
      closedAt: closedPoll.closedAt!,
    };

    const validEvent = pollClosedEventSchema.parse(eventPayload);
    await this.deps.publisher.emitToLecture(closedPoll.lectureId, "poll:closed", validEvent);

    return closedPoll;
  }

  async respondToPoll(
    actor: ActorContext,
    pollId: UUID,
    studentId: UUID,
    answer: string,
  ): Promise<PollResponseResult> {
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can respond to lecture polls",
      });
    }

    const pollIdParsed = uuidSchema.safeParse(pollId);
    const studentIdParsed = uuidSchema.safeParse(studentId);
    if (!pollIdParsed.success || !studentIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid poll ID or student ID format",
      });
    }

    if (!answer || answer.trim() === "") {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Poll response answer cannot be blank or whitespace-only",
      });
    }

    const context = await this.deps.polls.getPoll(actor, pollId);

    const enrollment = actor.enrolledCourses?.find((e) => e.courseId === context.courseId);
    if (!enrollment || enrollment.studentId !== studentId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Student enrollment not verified for this course",
      });
    }

    await this.deps.rooms.authorizeRoom(actor, `lecture:${context.poll.lectureId}`);

    const attendingStudentIds = await Promise.resolve(
      this.deps.presence.getAttendingStudentIds(context.poll.lectureId),
    );
    if (!attendingStudentIds.includes(studentId)) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Student is not attending this lecture session",
      });
    }

    const responseId = this.deps.ids.generateId();
    const answeredAt = this.deps.clock.nowISO ? this.deps.clock.nowISO() : this.deps.clock.now().toISOString();
    const { response, inserted } = await this.deps.polls.ingestResponse(
      actor,
      pollId,
      responseId,
      answer,
      answeredAt,
    );

    try {
      const responseCount = await this.deps.polls.getResponseCount(actor, pollId);
      const countEventPayload: PollResponseCountEvent = {
        eventId: this.deps.ids.generateId(),
        occurredAt: this.deps.clock.nowISO ? this.deps.clock.nowISO() : this.deps.clock.now().toISOString(),
        lectureId: context.poll.lectureId,
        pollId,
        responseCount,
      };
      const validCountEvent = pollResponseCountEventSchema.parse(countEventPayload);
      await this.deps.publisher.emitToTeacher(context.poll.lectureId, "poll:response-count", validCountEvent);
    } catch (countErr) {
      console.error(
        `Failed to publish poll:response-count for lectureId=${context.poll.lectureId} pollId=${pollId}:`,
        countErr
      );
    }

    if (!inserted) {
      if (response.status === "pending") {
        throw new AppError({
          code: "POLL_RESPONSE_PENDING",
          statusCode: 409,
          message: "Poll response evaluation is currently pending",
        });
      }

      if (response.status === "failed") {
        throw new AppError({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Poll response evaluation failed",
        });
      }

      if (response.status === "evaluated" && response.evaluation?.mastery) {
        return pollResponseResultSchema.parse({
          responseId: response.id,
          status: "evaluated",
          evaluation: {
            outcome: response.evaluation.outcome,
            feedback: response.evaluation.feedback,
          },
          newConfidence: response.evaluation.mastery.confidence,
          newBand: response.evaluation.mastery.band,
        });
      }
    }

    let evaluation: EvaluatedPollResponse;
    if (inserted || response.status === "pending") {
      try {
        evaluation = await this.deps.ai.evaluatePollResponse(
          context.poll.question,
          context.poll.expectedAnswer,
          response.answer,
        );
        evaluatedPollResponseSchema.parse(evaluation);
      } catch (aiErr) {
        try {
          await this.deps.polls.markEvaluationFailed(response.id, studentId);
        } catch {
          // preserve upstream failure
        }

        if (aiErr instanceof AppError) {
          throw aiErr;
        }

        throw new AppError({
          code: "BAD_GATEWAY",
          statusCode: 502,
          message: `Poll evaluation AI failure: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`,
          cause: aiErr,
        });
      }

      await this.deps.polls.storeEvaluation(response.id, studentId, evaluation);
    } else {
      evaluation = response.evaluation!;
    }

    const evidenceResult = await this.deps.evidence.applyResponse(
      actor,
      context.courseId,
      response.id,
    );

    const masteryToStore: StoredPollMastery = {
      confidence: evidenceResult.confidence,
      band: evidenceResult.band,
      attempts: evidenceResult.attempts,
      version: evidenceResult.version,
    };

    const { response: finalResponse, stored } = await this.deps.polls.storeMasteryResult(
      response.id,
      studentId,
      evaluation,
      masteryToStore,
    );

    if (stored) {
      const masteryEvent: MasteryUpdatedEvent = {
        eventId: this.deps.ids.generateId(),
        occurredAt: this.deps.clock.nowISO ? this.deps.clock.nowISO() : this.deps.clock.now().toISOString(),
        studentId,
        conceptId: context.poll.conceptId,
        confidence: finalResponse.evaluation!.mastery!.confidence,
        band: finalResponse.evaluation!.mastery!.band,
        evidenceType: "poll",
        attempts: finalResponse.evaluation!.mastery!.attempts,
        version: finalResponse.evaluation!.mastery!.version,
      };

      const validMasteryEvent = masteryUpdatedEventSchema.parse(masteryEvent);
      await this.deps.publisher.emitToStudent(studentId, "mastery:updated", validMasteryEvent);
    }

    return pollResponseResultSchema.parse({
      responseId: finalResponse.id,
      status: "evaluated",
      evaluation: {
        outcome: finalResponse.evaluation!.outcome,
        feedback: finalResponse.evaluation!.feedback,
      },
      newConfidence: finalResponse.evaluation!.mastery!.confidence,
      newBand: finalResponse.evaluation!.mastery!.band,
    });
  }
}
