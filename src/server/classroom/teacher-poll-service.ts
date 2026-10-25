import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type {
  PollQuestion,
  PollDraftInput,
  TeacherPollSnapshot,
  TeacherPollService as TeacherPollServicePort,
} from "../../contracts/classroom.js";
import {
  generatedPollQuestionSchema,
  type AiService,
} from "../../contracts/ai.js";
import type { ConceptNode } from "../../contracts/course.js";
import { AppError } from "../../contracts/errors.js";
import type { RoomAuthorizer } from "../realtime/index.js";
import type { LectureRepository } from "./lecture-repository.js";
import type { TranscriptRepository } from "./transcript-repository.js";
import type { PollRepository } from "./poll-repository.js";

export interface TeacherPollServiceDependencies {
  lectures: Pick<LectureRepository, "getLecture">;
  rooms: Pick<RoomAuthorizer, "authorizeRoom">;
  graph: {
    getTopology(
      actor: ActorContext,
      courseId: UUID
    ): Promise<{ nodes: Array<ConceptNode> }>;
  };
  transcripts: Pick<
    TranscriptRepository,
    "getRecentChunks" | "getRecentTranscriptText"
  >;
  ai: Pick<AiService, "generatePollQuestion">;
  polls: Pick<PollRepository, "insertDraft" | "updateDraft" | "getLatestPolls">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

export class TeacherPollService implements TeacherPollServicePort {
  constructor(private readonly deps: TeacherPollServiceDependencies) {}

  async generatePoll(
    actor: ActorContext,
    lectureId: UUID,
    conceptId?: UUID
  ): Promise<PollQuestion> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can generate polls",
      });
    }

    const idResult = uuidSchema.safeParse(lectureId);
    if (!idResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (conceptId !== undefined) {
      const conceptIdResult = uuidSchema.safeParse(conceptId);
      if (!conceptIdResult.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid concept ID format",
        });
      }
    }

    await this.deps.rooms.authorizeRoom(actor, `professor:${lectureId}`);

    const lecture = await this.deps.lectures.getLecture(lectureId);
    if (lecture.status !== "live") {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Lecture is not live",
      });
    }

    const topology = await this.deps.graph.getTopology(actor, lecture.courseId);
    const courseNodes = topology.nodes;

    let targetConcept: ConceptNode;
    let newestTimestamp = 0;

    const chunks = await this.deps.transcripts.getRecentChunks(lectureId, 50);
    if (chunks.length > 0) {
      newestTimestamp = chunks[chunks.length - 1]!.timestampSec;
    }

    if (conceptId) {
      const found = courseNodes.find((n) => n.id === conceptId);
      if (!found) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Concept does not belong to this course",
        });
      }
      targetConcept = found;
    } else {
      let detectedConceptId: UUID | null = null;
      for (let i = chunks.length - 1; i >= 0; i--) {
        const chunk = chunks[i]!;
        if (chunk.detectedConceptIds && chunk.detectedConceptIds.length > 0) {
          const sortedDetections = [...chunk.detectedConceptIds].sort((a, b) =>
            a.localeCompare(b)
          );
          detectedConceptId = sortedDetections[0]!;
          break;
        }
      }

      if (!detectedConceptId) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Select a concept or wait for lecture concept detection.",
        });
      }

      const found = courseNodes.find((n) => n.id === detectedConceptId);
      if (!found) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Detected concept does not belong to this course",
        });
      }
      targetConcept = found;
    }

    const recentTranscript =
      await this.deps.transcripts.getRecentTranscriptText(
        lectureId,
        newestTimestamp
      );

    let generated;
    try {
      generated = await this.deps.ai.generatePollQuestion(
        targetConcept,
        recentTranscript
      );
      generatedPollQuestionSchema.parse(generated);
    } catch (aiErr) {
      if (aiErr instanceof AppError) {
        throw aiErr;
      }
      throw new AppError({
        code: "BAD_GATEWAY",
        statusCode: 502,
        message: `Poll generation AI failure: ${
          aiErr instanceof Error ? aiErr.message : String(aiErr)
        }`,
        cause: aiErr,
      });
    }

    // Recheck lecture status after AI completes
    const recheckLecture = await this.deps.lectures.getLecture(lectureId);
    if (recheckLecture.status !== "live") {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Lecture ended before poll draft could be generated",
      });
    }

    const now = this.deps.clock.nowISO();

    const draftPoll: PollQuestion = {
      id: this.deps.ids.generateId(),
      lectureId,
      conceptId: targetConcept.id,
      question: generated.question,
      expectedAnswer: generated.expectedAnswer,
      status: "draft",
      generatedAt: now,
    };

    return await this.deps.polls.insertDraft(actor, draftPoll);
  }

  async editDraft(
    actor: ActorContext,
    pollId: UUID,
    input: PollDraftInput
  ): Promise<PollQuestion> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can edit poll drafts",
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

    return await this.deps.polls.updateDraft(actor, pollId, input);
  }

  async getSnapshot(
    actor: ActorContext,
    lectureId: UUID
  ): Promise<TeacherPollSnapshot> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can view teacher poll snapshot",
      });
    }

    const idResult = uuidSchema.safeParse(lectureId);
    if (!idResult.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    await this.deps.rooms.authorizeRoom(actor, `professor:${lectureId}`);
    return await this.deps.polls.getLatestPolls(actor, lectureId);
  }
}
