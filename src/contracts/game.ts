import { z } from "zod";
import {
  type UUID,
  type ActorContext,
  uuidSchema,
  isoTimestampSchema,
  masteryBandSchema,
} from "./common.js";
import {
  confidenceSchema,
  courseHeatmapConceptSchema,
  courseHeatmapSnapshotSchema,
} from "./mastery.js";
// ============================================================================
// 1. Enums and Primitives
// ============================================================================

export const sparkFormSchema = z.enum(["ember", "spark", "glow", "nova"]);
export type SparkForm = z.infer<typeof sparkFormSchema>;

export const encounterSourceSchema = z.enum(["star", "daily", "eclipse", "party"]);
export type EncounterSource = z.infer<typeof encounterSourceSchema>;

export const hintLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type HintLevel = z.infer<typeof hintLevelSchema>;

// ============================================================================
// 2. Daily Quests
// ============================================================================

export const dailyQuestItemSchema = z.object({
  conceptId: uuidSchema,
  confidence: confidenceSchema,
  band: masteryBandSchema,
  reviewState: z.enum(["unreviewed", "overdue", "current"]),
  completed: z.boolean(),
});
export type DailyQuestItemDTO = z.infer<typeof dailyQuestItemSchema>;

export const dailyQuestSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  date: z.iso.date(),
  items: z.array(dailyQuestItemSchema).min(0).max(3),
  clearedAt: isoTimestampSchema.nullable(),
  version: z.number().int().positive(),
});
export type DailyQuestDTO = z.infer<typeof dailyQuestSchema>;

// ============================================================================
// 3. Game Summary & Progression
// ============================================================================

export const gameSummarySchema = z.object({
  studentId: uuidSchema,
  courseId: uuidSchema,
  xp: z.number().int().nonnegative(),
  streakDays: z.number().int().nonnegative(),
  skyBrightness: z.number().min(0.0).max(1.0).refine(Number.isFinite, {
    message: "skyBrightness must be a finite number between 0.0 and 1.0",
  }),
  form: sparkFormSchema,
  formProgress: z.number().min(0.0).max(1.0).refine(Number.isFinite, {
    message: "formProgress must be a finite number between 0.0 and 1.0",
  }),
  updatedAt: isoTimestampSchema,
});
export type GameSummaryDTO = z.infer<typeof gameSummarySchema>;

// ============================================================================
// 4. Eclipse Review Pressure
// ============================================================================

export const eclipseTargetSchema = z.object({
  conceptId: uuidSchema,
  confidence: confidenceSchema,
  band: masteryBandSchema,
});
export type EclipseTargetDTO = z.infer<typeof eclipseTargetSchema>;

export const eclipseSchema = z.object({
  studentId: uuidSchema,
  strength: z.number().int().min(0).max(100),
  targets: z.array(eclipseTargetSchema).min(0).max(3),
  examAt: isoTimestampSchema.nullable(),
});
export type EclipseDTO = z.infer<typeof eclipseSchema>;

// ============================================================================
// 5. Encounters
// ============================================================================

export const createEncounterInputSchema = z.discriminatedUnion("source", [
  z.strictObject({ conceptId: uuidSchema, source: z.literal("star") }),
  z.strictObject({ conceptId: uuidSchema, source: z.literal("eclipse") }),
  z.strictObject({ conceptId: uuidSchema, source: z.literal("daily"), questId: uuidSchema }),
  z.strictObject({ conceptId: uuidSchema, source: z.literal("party"), partyQuestId: uuidSchema }),
]);
export type CreateEncounterInput = z.infer<typeof createEncounterInputSchema>;

export const encounterQuestionSchema = z.object({
  questionId: uuidSchema,
  question: z.string().min(1),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  hintsUsed: z.number().int().min(0).max(3),
});
export type EncounterQuestionDTO = z.infer<typeof encounterQuestionSchema>;

export const encounterSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  conceptId: uuidSchema,
  source: encounterSourceSchema,
  questId: uuidSchema.nullable(),
  partyQuestId: uuidSchema.nullable(),
  status: z.enum(["active", "completed", "abandoned"]),
  questions: z.array(encounterQuestionSchema).length(5),
  version: z.number().int().positive(),
});
export type EncounterDTO = z.infer<typeof encounterSchema>;

export const encounterFeedbackItemSchema = z.object({
  questionId: uuidSchema,
  correct: z.boolean(),
  correctOption: z.number().int().min(0).max(3),
  explanation: z.string(),
});
export type EncounterFeedbackItemDTO = z.infer<typeof encounterFeedbackItemSchema>;

export const encounterResultSchema = z.object({
  encounterId: uuidSchema,
  attemptId: uuidSchema,
  score: z.number().min(0.0).max(1.0).refine(Number.isFinite, {
    message: "score must be a finite number between 0.0 and 1.0",
  }),
  correctCount: z.number().int().min(0).max(5),
  totalQuestions: z.literal(5),
  newConfidence: confidenceSchema,
  newBand: masteryBandSchema,
  feedback: z.array(encounterFeedbackItemSchema).length(5),
  xpAwarded: z.number().int().nonnegative(),
  summary: gameSummarySchema,
  dailyQuest: dailyQuestSchema.nullable(),
});
export type EncounterResultDTO = z.infer<typeof encounterResultSchema>;

export const encounterHintResponseSchema = z.object({
  questionId: uuidSchema,
  level: hintLevelSchema,
  text: z.string().min(1),
});
export type EncounterHintResponse = z.infer<typeof encounterHintResponseSchema>;

// ============================================================================
// 6. Course Effort (Teacher View)
// ============================================================================

export const courseEffortSchema = z.object({
  studentId: uuidSchema,
  name: z.string().min(1),
  xp: z.number().int().nonnegative(),
  averageConfidence: confidenceSchema,
  flag: z.literal("high_effort_low_mastery").nullable(),
  unassessed: z.boolean(),
});
export type CourseEffortDTO = z.infer<typeof courseEffortSchema>;

export const classSkyConceptSchema = courseHeatmapConceptSchema.extend({
  band: masteryBandSchema,
  taught: z.boolean(),
});
export type ClassSkyConcept = z.infer<typeof classSkyConceptSchema>;

export const classSkySnapshotSchema = courseHeatmapSnapshotSchema.safeExtend({
  concepts: z.array(classSkyConceptSchema),
});
export type ClassSkySnapshot = z.infer<typeof classSkySnapshotSchema>;
// ============================================================================
// 7. Service Interfaces
// ============================================================================

export interface GameService {
  getDailyQuest(actor: ActorContext, studentId: UUID): Promise<DailyQuestDTO>;
  getSummary(actor: ActorContext, studentId: UUID): Promise<GameSummaryDTO>;
  getEclipse(actor: ActorContext, studentId: UUID): Promise<EclipseDTO>;
  getCourseEffort(actor: ActorContext, courseId: UUID): Promise<CourseEffortDTO[]>;
  getClassSky(actor: ActorContext, courseId: UUID): Promise<ClassSkySnapshot>;
}

export interface EncounterService {
  createEncounter(
    actor: ActorContext,
    studentId: UUID,
    input: CreateEncounterInput
  ): Promise<EncounterDTO>;
  getEncounter(
    actor: ActorContext,
    encounterId: UUID
  ): Promise<{ encounter: EncounterDTO; result: EncounterResultDTO | null }>;
  getHint(
    actor: ActorContext,
    encounterId: UUID,
    questionId: UUID,
    level: HintLevel
  ): Promise<{ questionId: UUID; level: HintLevel; text: string }>;
  submitEncounter(
    actor: ActorContext,
    encounterId: UUID,
    answers: { questionId: UUID; selectedOption: number }[]
  ): Promise<EncounterResultDTO>;
}
