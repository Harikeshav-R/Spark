import type {
  DetectConceptsCandidate,
  SummarizedLecture,
} from "../../contracts/ai.js";
import type { LectureSession } from "../../contracts/classroom.js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError, DomainErrorCode } from "../../contracts/errors.js";
import type { RealtimePublisher } from "../../contracts/realtime.js";
import { lectureSummaryReadyEventSchema } from "../../contracts/realtime.js";
import type { RoomAuthorizer } from "../realtime/index.js";
import type {
  LectureSummaryRecord,
  LectureSummaryRepository,
} from "./lecture-summary-repository.js";

export interface LectureSummaryServiceDependencies {
  classroom: {
    getLecture(lectureId: UUID): Promise<LectureSession>;
    getLectureTranscript(
      lectureId: UUID
    ): Promise<{ text: string; timestampSec: number }[]>;
    getCandidateConcepts(courseId: UUID): Promise<DetectConceptsCandidate[]>;
  };
  rooms: Pick<RoomAuthorizer, "authorizeRoom">;
  repository: Pick<LectureSummaryRepository, "get" | "insert">;
  summarizer: {
    summarizeLecture(
      transcriptChunks: { text: string; timestampSec: number }[],
      candidateConcepts?: DetectConceptsCandidate[]
    ): Promise<SummarizedLecture>;
  };
  publisher: Pick<RealtimePublisher, "emitToLecture">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

export class LectureSummaryService {
  constructor(
    private readonly dependencies: LectureSummaryServiceDependencies
  ) {}

  async generateForLecture(
    actor: ActorContext,
    lectureId: UUID
  ): Promise<LectureSummaryRecord> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Only teachers can generate lecture summaries",
      });
    }

    await this.dependencies.rooms.authorizeRoom(
      actor,
      `professor:${lectureId}`
    );

    const lecture = await this.dependencies.classroom.getLecture(lectureId);
    if (lecture.status !== "completed") {
      throw new AppError({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
        message: "Lecture must be completed before summarization",
      });
    }

    const existing = await this.dependencies.repository.get(lectureId);
    if (existing) {
      return existing;
    }

    const [chunks, candidateConcepts] = await Promise.all([
      this.dependencies.classroom.getLectureTranscript(lectureId),
      this.dependencies.classroom.getCandidateConcepts(lecture.courseId),
    ]);

    const generated = await this.dependencies.summarizer.summarizeLecture(
      chunks,
      candidateConcepts
    );

    const generatedAt = this.dependencies.clock.nowISO();
    const record: LectureSummaryRecord = {
      lectureId,
      summary: generated.summary,
      keyConceptsCovered: generated.keyConceptsCovered,
      timelineHighlights: generated.timelineHighlights,
      generatedAt,
    };

    const insertResult = await this.dependencies.repository.insert(record);

    if (insertResult.inserted) {
      const eventPayload = lectureSummaryReadyEventSchema.parse({
        eventId: this.dependencies.ids.generateId(),
        occurredAt: this.dependencies.clock.nowISO(),
        lectureId,
        summary: insertResult.record.summary,
        keyConceptsCovered: insertResult.record.keyConceptsCovered,
      });

      await this.dependencies.publisher.emitToLecture(
        lectureId,
        "lecture:summary-ready",
        eventPayload
      );
    }

    return insertResult.record;
  }

  async getSummary(
    actor: ActorContext,
    lectureId: UUID
  ): Promise<LectureSummaryRecord> {
    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    await this.dependencies.rooms.authorizeRoom(actor, `lecture:${lectureId}`);

    const summary = await this.dependencies.repository.get(lectureId);
    if (!summary) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Lecture summary is not available",
      });
    }

    return summary;
  }
}
