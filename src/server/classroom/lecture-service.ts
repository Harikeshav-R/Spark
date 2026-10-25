import { z } from "zod";
import type {
  ClassroomService,
  LectureSession,
} from "../../contracts/classroom.js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { RealtimePublisher } from "../../contracts/realtime.js";
import { lectureEndedEventSchema } from "../../contracts/realtime.js";
import type { RoomAuthorizer } from "../realtime/index.js";
import type { LectureRepository } from "./lecture-repository.js";

export interface LectureCompletionDependencies {
  rooms: Pick<RoomAuthorizer, "authorizeRoom">;
  publisher: Pick<RealtimePublisher, "emitToLecture">;
  summarize: (actor: ActorContext, lectureId: UUID) => Promise<void>;
}
export class LectureService
  implements Pick<ClassroomService, "startLecture" | "endLecture">
{
  constructor(
    private readonly repository: Pick<
      LectureRepository,
      "insertLecture" | "getLecture" | "updateLectureStatus"
    >,
    private readonly ids: Pick<IdGenerator, "generateId">,
    private readonly clock: Clock,
    private readonly completion: LectureCompletionDependencies,
  ) {}

  async startLecture(
    actor: ActorContext,
    courseId: UUID,
    title: string,
  ): Promise<LectureSession> {
    if (actor.role !== "teacher") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can start lectures",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const titleParse = z.string().trim().min(1).max(255).safeParse(title);
    if (!titleParse.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Lecture title must be between 1 and 255 characters",
      });
    }

    const lecture: LectureSession = {
      id: this.ids.generateId(),
      courseId,
      title: titleParse.data,
      status: "live",
      startedAt: this.clock.nowISO(),
    };

    return this.repository.insertLecture(lecture);
  }

  async endLecture(
    actor: ActorContext,
    lectureId: UUID,
  ): Promise<LectureSession> {
    if (actor.role !== "teacher") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can end lectures",
      });
    }

    if (!uuidSchema.safeParse(lectureId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid lecture ID format",
      });
    }

    await this.completion.rooms.authorizeRoom(
      actor,
      `professor:${lectureId}`
    );

    const current = await this.repository.getLecture(lectureId);

    if (current.status === "completed") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Lecture session is already completed",
      });
    }

    const endedAt = this.clock.nowISO();
    const completed = await this.repository.updateLectureStatus(
      lectureId,
      "completed",
      endedAt
    );

    const endedEvent = lectureEndedEventSchema.parse({
      eventId: this.ids.generateId(),
      occurredAt: this.clock.nowISO(),
      lectureId,
      endedAt: completed.endedAt ?? endedAt,
    });

    await this.completion.publisher.emitToLecture(
      lectureId,
      "lecture:ended",
      endedEvent
    );

    await this.completion.summarize(actor, lectureId);

    return completed;
  }

  async getLecture(lectureId: UUID): Promise<LectureSession> {
    return this.repository.getLecture(lectureId);
  }
}
