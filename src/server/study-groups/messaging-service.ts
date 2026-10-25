import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../contracts/common.js";
import {
  isoTimestampSchema,
  uuidSchema,
} from "../../contracts/common.js";
import type {
  StudyGroupMessage,
  StudyGroupService as StudyGroupServicePort,
} from "../../contracts/classroom.js";
import { studyGroupMessageSchema } from "../../contracts/classroom.js";
import {
  type RealtimePublisher,
  studyGroupMessageEventSchema,
} from "../../contracts/realtime.js";
import { AppError } from "../../contracts/errors.js";
import type { MessagingRepository } from "./messaging-repository.js";

export interface MessagingServiceDependencies {
  repository: Pick<
    MessagingRepository,
    "requireMatchMember" | "insertMessage" | "getMessagesForMatch"
  >;
  publisher: Pick<RealtimePublisher, "emitToStudyGroup">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

export class MessagingService
  implements Pick<StudyGroupServicePort, "sendMessage" | "getMatchMessages">
{
  private readonly repository: MessagingServiceDependencies["repository"];
  private readonly publisher: MessagingServiceDependencies["publisher"];
  private readonly clock: Clock;
  private readonly ids: Pick<IdGenerator, "generateId">;

  constructor(dependencies: MessagingServiceDependencies) {
    this.repository = dependencies.repository;
    this.publisher = dependencies.publisher;
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
  }

  async getMatchMessages(
    actor: ActorContext,
    matchId: UUID,
  ): Promise<StudyGroupMessage[]> {
    await this.repository.requireMatchMember(actor, matchId);
    return this.repository.getMessagesForMatch(matchId);
  }

  async sendMessage(
    actor: ActorContext,
    matchId: UUID,
    content: string,
  ): Promise<StudyGroupMessage> {
    const member = await this.repository.requireMatchMember(actor, matchId);

    const contentParse = studyGroupMessageSchema.shape.content.safeParse(content);
    if (!contentParse.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Message content must be a non-empty string",
        cause: contentParse.error,
      });
    }

    const messageId = this.ids.generateId();
    const createdAt = this.clock.nowISO();

    if (
      !uuidSchema.safeParse(messageId).success ||
      !isoTimestampSchema.safeParse(createdAt).success
    ) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to generate valid message metadata",
      });
    }

    const saved = await this.repository.insertMessage({
      id: messageId,
      matchId,
      senderId: member.studentId,
      content: contentParse.data,
      createdAt,
    });

    const eventId = this.ids.generateId();
    if (!uuidSchema.safeParse(eventId).success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to generate valid event metadata",
      });
    }

    const rawEvent = {
      eventId,
      occurredAt: saved.createdAt,
      messageId: saved.id,
      matchId,
      senderId: saved.senderId,
      content: saved.content,
    };

    const eventParse = studyGroupMessageEventSchema.safeParse(rawEvent);
    if (!eventParse.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to validate message event",
        cause: eventParse.error,
      });
    }

    await this.publisher.emitToStudyGroup(
      matchId,
      "study-group:message",
      eventParse.data,
    );

    return saved;
  }
}
