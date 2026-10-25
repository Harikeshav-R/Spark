import { z } from "zod";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import { AppError } from "../../../contracts/errors.js";
import type {
  ClassSkySnapshot,
  CourseEffortDTO,
  DailyQuestDTO,
  EclipseDTO,
  GameService,
  GameSummaryDTO,
  SparkForm,
} from "../../../contracts/game.js";
import {
  dailyQuestSchema,
  eclipseSchema,
  gameSummarySchema,
} from "../../../contracts/game.js";
import type { MasteryService } from "../../../contracts/mastery.js";
import type { RealtimePublisher } from "../../../contracts/realtime.js";
import { gameUpdatedEventSchema } from "../../../contracts/realtime.js";
import type { GraphRepository } from "../graph/graph-repository.js";
import { calculateNodeImportance } from "../graph/importance-calculator.js";
import {
  hydrateDailyQuestItems,
  selectDailyQuestCandidates,
} from "./daily-quest-generator.js";
import { calculateEclipse } from "./eclipse-service.js";
import type {
  DailyQuestRecord,
  GameRepository,
  StudentRecord,
} from "./game-repository.js";

export interface GameServiceDependencies {
  repository: GameRepository;
  courses: Pick<CourseService, "getCourse">;
  graph: Pick<GraphRepository, "getTopology">;
  mastery: Pick<MasteryService, "getMastery">;
  courseEffort: Pick<GameService, "getCourseEffort" | "getClassSky">;
  publisher: Pick<RealtimePublisher, "emitToStudent">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

export interface PracticeRewardResult {
  xpAwarded: number;
  summary: GameSummaryDTO;
  dailyQuest: DailyQuestDTO | null;
}

const practiceAnswerItemSchema = z.object({
  correct: z.boolean(),
  hintsUsed: z.number().int().min(0).max(3),
});

const practiceAnswersSchema = z.array(practiceAnswerItemSchema).length(5);

export function calculateStreakDays(
  clearedQuests: readonly { questDate: string; conceptIds: readonly string[] }[],
): number {
  const nonEmptyClears = clearedQuests.filter((q) => q.conceptIds.length > 0);
  if (nonEmptyClears.length === 0) {
    return 0;
  }

  // Deduplicate UTC dates and sort ascending
  const uniqueDates = Array.from(
    new Set(nonEmptyClears.map((q) => q.questDate.slice(0, 10))),
  ).sort();

  if (uniqueDates.length === 0) {
    return 0;
  }

  const parseUtcMidnight = (dateStr: string): number => {
    const parts = dateStr.split("-").map(Number);
    const y = parts[0] ?? 1970;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    return Date.UTC(y, m - 1, d);
  };

  let streak = 1;
  for (let i = uniqueDates.length - 1; i > 0; i--) {
    const currentDate = uniqueDates[i];
    const prevDate = uniqueDates[i - 1];
    if (!currentDate || !prevDate) {
      break;
    }
    const current = parseUtcMidnight(currentDate);
    const prev = parseUtcMidnight(prevDate);
    const diffDays = Math.round((current - prev) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

export function calculateMascotEvolution(skyBrightness: number): {
  form: SparkForm;
  formProgress: number;
} {
  let form: SparkForm;
  let formProgress: number;

  if (skyBrightness < 0.25) {
    form = "ember";
    formProgress = skyBrightness / 0.25;
  } else if (skyBrightness < 0.55) {
    form = "spark";
    formProgress = (skyBrightness - 0.25) / 0.3;
  } else if (skyBrightness < 0.75) {
    form = "glow";
    formProgress = (skyBrightness - 0.55) / 0.2;
  } else {
    form = "nova";
    formProgress = 1.0;
  }

  const clampedProgress = Math.max(
    0.0,
    Math.min(1.0, Math.round(formProgress * 1000) / 1000),
  );

  return { form, formProgress: clampedProgress };
}

export class ConcreteGameService implements GameService {
  constructor(private readonly dependencies: GameServiceDependencies) {}

  private async authorizeStudent(
    actor: ActorContext,
    studentId: UUID,
  ): Promise<StudentRecord> {
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can access personal game progression",
      });
    }

    const student = await this.dependencies.repository.getStudent(studentId);

    if (student.authId !== actor.authId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Cannot access progression for another student",
      });
    }

    const enrollment = actor.enrolledCourses?.find(
      (e) => e.studentId === studentId && e.courseId === student.courseId,
    );

    if (!enrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Student enrollment not found in actor session",
      });
    }

    // Authorize course through CourseService
    await this.dependencies.courses.getCourse(actor, student.courseId);

    return student;
  }

  private formatDailyQuestDTO(
    questRecord: DailyQuestRecord,
    masteryMap: ReadonlyMap<UUID, number>,
    latestReviews: ReadonlyMap<UUID, Date>,
    now: Date,
  ): DailyQuestDTO {
    const items = hydrateDailyQuestItems(
      questRecord.conceptIds,
      questRecord.completedIds,
      masteryMap,
      latestReviews,
      now,
    );

    return dailyQuestSchema.parse({
      id: questRecord.id,
      studentId: questRecord.studentId,
      date: questRecord.questDate,
      items,
      clearedAt: questRecord.clearedAt,
      version: questRecord.version,
    });
  }

  async getDailyQuest(
    actor: ActorContext,
    studentId: UUID,
  ): Promise<DailyQuestDTO> {
    const parsedId = uuidSchema.safeParse(studentId);
    if (!parsedId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
        cause: parsedId.error,
      });
    }

    const student = await this.authorizeStudent(actor, parsedId.data);
    const now = this.dependencies.clock.now();
    const todayUtc = now.toISOString().slice(0, 10);

    const [topology, masteries, latestReviews] = await Promise.all([
      this.dependencies.graph.getTopology(actor, student.courseId),
      this.dependencies.mastery.getMastery(actor, student.id),
      this.dependencies.repository.getLatestCommittedReviews(student.id),
    ]);

    const masteryMap = new Map(masteries.map((m) => [m.conceptId, m.confidence]));

    let questRecord = await this.dependencies.repository.getDailyQuestRow(
      student.id,
      todayUtc,
    );

    if (!questRecord) {
      const importanceMap = calculateNodeImportance(
        topology.nodes,
        topology.edges,
      );

      const candidateIds = selectDailyQuestCandidates(
        topology.nodes,
        topology.edges,
        masteryMap,
        latestReviews,
        importanceMap,
        now,
      );

      questRecord = await this.dependencies.repository.persistDailyQuestQueue(
        student.id,
        todayUtc,
        candidateIds,
      );
    }

    return this.formatDailyQuestDTO(
      questRecord,
      masteryMap,
      latestReviews,
      now,
    );
  }

  async getSummary(
    actor: ActorContext,
    studentId: UUID,
  ): Promise<GameSummaryDTO> {
    const parsedId = uuidSchema.safeParse(studentId);
    if (!parsedId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
        cause: parsedId.error,
      });
    }

    const student = await this.authorizeStudent(actor, parsedId.data);

    const [topology, masteries, xpInfo, clearedQuests, latestQuestTimestamp] =
      await Promise.all([
        this.dependencies.graph.getTopology(actor, student.courseId),
        this.dependencies.mastery.getMastery(actor, student.id),
        this.dependencies.repository.getTotalXpAndLatestTimestamp(student.id),
        this.dependencies.repository.getAllClearedQuests(student.id),
        this.dependencies.repository.getLatestQuestTimestamp(student.id),
      ]);

    const masteryMap = new Map(masteries.map((m) => [m.conceptId, m.confidence]));

    // Sky brightness across all |V| concepts (INV-XP08)
    const totalConfidence = topology.nodes.reduce(
      (sum, node) => sum + (masteryMap.get(node.id) ?? 0.0),
      0,
    );
    const rawSkyBrightness =
      topology.nodes.length > 0 ? totalConfidence / topology.nodes.length : 0.0;
    const skyBrightness = Math.round(rawSkyBrightness * 1000) / 1000;

    const { form, formProgress } = calculateMascotEvolution(skyBrightness);
    const streakDays = calculateStreakDays(clearedQuests);

    // Summary updatedAt is maximum persisted timestamp among entities used
    const candidateTimestamps: number[] = [
      new Date(student.createdAt).getTime(),
    ];

    if (xpInfo.latestXpTimestamp) {
      candidateTimestamps.push(new Date(xpInfo.latestXpTimestamp).getTime());
    }

    if (latestQuestTimestamp) {
      candidateTimestamps.push(new Date(latestQuestTimestamp).getTime());
    }

    for (const m of masteries) {
      candidateTimestamps.push(new Date(m.lastUpdated).getTime());
    }

    for (const n of topology.nodes) {
      candidateTimestamps.push(new Date(n.createdAt).getTime());
    }

    const maxTimestamp = Math.max(...candidateTimestamps);
    const updatedAt = new Date(maxTimestamp).toISOString();

    const summary: GameSummaryDTO = {
      studentId: student.id,
      courseId: student.courseId,
      xp: xpInfo.totalXp,
      streakDays,
      skyBrightness,
      form,
      formProgress,
      updatedAt,
    };

    return gameSummarySchema.parse(summary);
  }

  async getEclipse(
    actor: ActorContext,
    studentId: UUID,
  ): Promise<EclipseDTO> {
    const parsedId = uuidSchema.safeParse(studentId);
    if (!parsedId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student ID format",
        cause: parsedId.error,
      });
    }

    const student = await this.authorizeStudent(actor, parsedId.data);

    const [topology, masteries, examAt] = await Promise.all([
      this.dependencies.graph.getTopology(actor, student.courseId),
      this.dependencies.mastery.getMastery(actor, student.id),
      this.dependencies.repository.getCourseExamAt(student.courseId),
    ]);

    const masteryMap = new Map(masteries.map((m) => [m.conceptId, m.confidence]));

    const eclipse = calculateEclipse({
      studentId: student.id,
      nodes: topology.nodes,
      edges: topology.edges,
      masteries: masteryMap,
      examAt,
    });

    return eclipseSchema.parse(eclipse);
  }

  async getCourseEffort(
    actor: ActorContext,
    courseId: UUID,
  ): Promise<CourseEffortDTO[]> {
    return this.dependencies.courseEffort.getCourseEffort(actor, courseId);
  }

  async getClassSky(
    actor: ActorContext,
    courseId: UUID,
  ): Promise<ClassSkySnapshot> {
    return this.dependencies.courseEffort.getClassSky(actor, courseId);
  }

  async recordPracticeReward(
    actor: ActorContext,
    studentId: UUID,
    attemptId: UUID,
    answers: readonly { correct: boolean; hintsUsed: number }[],
  ): Promise<PracticeRewardResult> {
    const parsedStudentId = uuidSchema.safeParse(studentId);
    const parsedAttemptId = uuidSchema.safeParse(attemptId);
    const parsedAnswers = practiceAnswersSchema.safeParse(answers);

    if (!parsedStudentId.success || !parsedAttemptId.success || !parsedAnswers.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid parameters provided for practice reward",
      });
    }

    const student = await this.authorizeStudent(actor, parsedStudentId.data);
    const now = this.dependencies.clock.now();

    const rpcResult = await this.dependencies.repository.callRecordPracticeReward(
      actor.authId,
      student.id,
      parsedAttemptId.data,
      parsedAnswers.data,
      now,
    );

    const summary = await this.getSummary(actor, student.id);

    let dailyQuest: DailyQuestDTO | null = null;
    if (rpcResult.quest) {
      const [masteries, latestReviews] = await Promise.all([
        this.dependencies.mastery.getMastery(actor, student.id),
        this.dependencies.repository.getLatestCommittedReviews(student.id),
      ]);
      const masteryMap = new Map(masteries.map((m) => [m.conceptId, m.confidence]));
      dailyQuest = this.formatDailyQuestDTO(
        rpcResult.quest,
        masteryMap,
        latestReviews,
        now,
      );
    }

    // Publish event only if state changed (new XP or quest completion)
    if (rpcResult.changed) {
      const eventPayload = {
        eventId: this.dependencies.ids.generateId(),
        occurredAt: now.toISOString(),
        studentId: student.id,
        updatedAt: rpcResult.updatedAt,
        summary,
        dailyQuest,
      };

      const validatedEvent = gameUpdatedEventSchema.parse(eventPayload);

      try {
        await this.dependencies.publisher.emitToStudent(
          student.id,
          "game:updated",
          validatedEvent,
        );
      } catch (pubErr) {
        console.error(
          `Failed to publish game:updated event for student ${student.id}, attempt ${attemptId}:`,
          pubErr,
        );
      }
    }

    return {
      xpAwarded: rpcResult.xpAwarded,
      summary,
      dailyQuest,
    };
  }
}
