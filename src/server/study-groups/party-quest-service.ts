import type {
  ActorContext,
  UUID,
} from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type {
  PartyQuestItem,
  PartyQuestProgressItem,
} from "../../contracts/classroom.js";
import type { PartyQuestUpdatedEvent } from "../../contracts/realtime.js";
import { AppError } from "../../contracts/errors.js";
import type { PartyQuestEncounterPort } from "../../contracts/game.js";
import type { PartyQuestRepository } from "./party-quest-repository.js";
import type { MessagingRepository } from "./messaging-repository.js";
import type {
  ClockPort,
  IdGeneratorPort,
} from "./invitations-service.js";

export interface StudyGroupRealtimePublisherPort {
  emitToStudyGroup(matchId: UUID, event: string, payload: unknown): Promise<void>;
}

export interface PartyQuestServiceDependencies {
  questsRepo: Pick<
    PartyQuestRepository,
    | "createPartyQuest"
    | "getMatchById"
    | "getQuestsForMatch"
    | "getProgressForQuest"
    | "getQuestWithMatch"
    | "recordPartyProgressRpc"
  >;
  membership: Pick<MessagingRepository, "requireMatchMember">;
  publisher: StudyGroupRealtimePublisherPort;
  clock: ClockPort;
  ids: IdGeneratorPort;
}

export class PartyQuestService implements PartyQuestEncounterPort {
  private readonly questsRepo: Pick<
    PartyQuestRepository,
    | "createPartyQuest"
    | "getMatchById"
    | "getQuestsForMatch"
    | "getProgressForQuest"
    | "getQuestWithMatch"
    | "recordPartyProgressRpc"
  >;
  private readonly membership: Pick<MessagingRepository, "requireMatchMember">;
  private readonly publisher: StudyGroupRealtimePublisherPort;
  private readonly clock: ClockPort;
  private readonly ids: IdGeneratorPort;

  constructor(dependencies: PartyQuestServiceDependencies) {
    this.questsRepo = dependencies.questsRepo;
    this.membership = dependencies.membership;
    this.publisher = dependencies.publisher;
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
  }

  async createPartyQuest(
    actor: ActorContext,
    matchId: UUID,
    conceptIds: UUID[],
  ): Promise<{ partyQuestId: UUID; status: "active"; conceptIds: UUID[] }> {
    if (!uuidSchema.safeParse(matchId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid match ID format",
      });
    }

    if (
      !Array.isArray(conceptIds) ||
      conceptIds.length < 1 ||
      conceptIds.length > 3 ||
      new Set(conceptIds).size !== conceptIds.length
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Party quest requires between 1 and 3 distinct concepts",
      });
    }

    for (const c of conceptIds) {
      if (!uuidSchema.safeParse(c).success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid concept ID format",
        });
      }
    }

    await this.membership.requireMatchMember(actor, matchId);

    const match = await this.questsRepo.getMatchById(matchId);
    if (!match) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Study group match not found",
      });
    }

    if (match.status !== "active") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Study group match is not active",
      });
    }

    const matchConceptSet = new Set(match.concept_ids);
    for (const c of conceptIds) {
      if (!matchConceptSet.has(c)) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message:
            "Selected concepts must be contained within the study group match concepts",
        });
      }
    }

    const created = await this.questsRepo.createPartyQuest(matchId, conceptIds);

    const event: PartyQuestUpdatedEvent = {
      eventId: this.ids.generateId(),
      occurredAt: this.clock.nowISO(),
      matchId,
      partyQuestId: created.partyQuestId,
      version: 1,
      status: "active",
      completedPairs: 0,
      totalPairs: 2 * conceptIds.length,
    };

    try {
      await this.publisher.emitToStudyGroup(
        matchId,
        "party:quest-updated",
        event,
      );
    } catch (err) {
      console.error(
        `[PartyQuestService] Failed to publish party:quest-updated event for quest ${created.partyQuestId}:`,
        err,
      );
    }

    return created;
  }

  async getPartyQuests(
    actor: ActorContext,
    matchId: UUID,
  ): Promise<PartyQuestItem[]> {
    if (!uuidSchema.safeParse(matchId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid match ID format",
      });
    }

    await this.membership.requireMatchMember(actor, matchId);

    const match = await this.questsRepo.getMatchById(matchId);
    if (!match) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Study group match not found",
      });
    }

    const quests = await this.questsRepo.getQuestsForMatch(matchId);
    if (quests.length === 0) {
      return [];
    }

    const peerIds = [match.student1_id, match.student2_id].sort();

    const results: PartyQuestItem[] = [];
    for (const quest of quests) {
      const progressRows = await this.questsRepo.getProgressForQuest(quest.id);

      const pairs: PartyQuestProgressItem[] = [];
      for (const studentId of peerIds) {
        for (const conceptId of quest.concept_ids) {
          const completed = progressRows.some(
            (p) => p.student_id === studentId && p.concept_id === conceptId,
          );
          pairs.push({
            studentId,
            conceptId,
            completed,
          });
        }
      }

      results.push({
        partyQuestId: quest.id,
        conceptIds: quest.concept_ids,
        status: quest.status,
        progress: pairs,
      });
    }

    return results;
  }

  async authorizePartyEncounter(
    actor: ActorContext,
    courseId: UUID,
    studentId: UUID,
    partyQuestId: UUID,
    conceptId: UUID,
  ): Promise<void> {
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only students can participate in party quests",
      });
    }

    const enrollment = actor.enrolledCourses.find(
      (e) => e.studentId === studentId && e.courseId === courseId,
    );
    if (!enrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Actor is not enrolled in the specified course as target student",
      });
    }

    const questWithMatch =
      await this.questsRepo.getQuestWithMatch(partyQuestId);
    if (!questWithMatch) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Party quest not found",
      });
    }

    const { quest, match } = questWithMatch;

    if (match.course_id !== courseId) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Party quest not found",
      });
    }

    if (match.student1_id !== studentId && match.student2_id !== studentId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Student is not a member of the study group match",
      });
    }

    if (quest.status !== "active") {
      throw new AppError({
        code: "CONFLICT",
        statusCode: 409,
        message: "Party quest is not active",
      });
    }

    if (!quest.concept_ids.includes(conceptId)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Concept is not included in the party quest",
      });
    }
  }

  async recordPartyEncounterCompletion(
    actor: ActorContext,
    partyQuestId: UUID,
    attemptId: UUID,
  ): Promise<void> {
    const outcome = await this.questsRepo.recordPartyProgressRpc(
      actor.authId,
      partyQuestId,
      attemptId,
    );

    if (outcome.changed) {
      const event: PartyQuestUpdatedEvent = {
        eventId: this.ids.generateId(),
        occurredAt: outcome.occurredAt,
        matchId: outcome.matchId,
        partyQuestId: outcome.partyQuestId,
        version: outcome.version,
        status: outcome.status,
        completedPairs: outcome.completedPairs,
        totalPairs: outcome.totalPairs,
      };

      try {
        await this.publisher.emitToStudyGroup(
          outcome.matchId,
          "party:quest-updated",
          event,
        );
      } catch (err) {
        console.error(
          `[PartyQuestService] Failed to publish party:quest-updated event for quest ${partyQuestId}:`,
          err,
        );
      }
    }
  }
}
