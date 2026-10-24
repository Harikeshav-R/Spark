import { z } from "zod";
import {
  type UUID,
  type ActorContext,
  type MasteryBand,
  uuidSchema,
  isoTimestampSchema,
  masteryBandSchema,
} from "./common.js";

// ============================================================================
// 1. Tutoring Entities & Schemas
// ============================================================================

export const tutoringSessionStatusSchema = z.enum(["active", "completed"]);
export type TutoringSessionStatus = z.infer<typeof tutoringSessionStatusSchema>;

export const tutoringMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type TutoringMessageRole = z.infer<typeof tutoringMessageRoleSchema>;

export const tutoringSessionSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  targetConcepts: z.array(uuidSchema),
  status: tutoringSessionStatusSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type TutoringSession = z.infer<typeof tutoringSessionSchema>;

export const tutoringMessageSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  role: tutoringMessageRoleSchema,
  content: z.string().min(1),
  conceptId: uuidSchema.nullable().optional(),
  understandingDetected: z.boolean(),
  createdAt: isoTimestampSchema,
});
export type TutoringMessage = z.infer<typeof tutoringMessageSchema>;

export const createTutoringSessionRequestSchema = z.object({
  studentId: uuidSchema,
  conceptIds: z.array(uuidSchema).min(1),
});
export type CreateTutoringSessionRequest = z.infer<typeof createTutoringSessionRequestSchema>;

export const createTutoringSessionResponseSchema = z.object({
  sessionId: uuidSchema,
});
export type CreateTutoringSessionResponse = z.infer<typeof createTutoringSessionResponseSchema>;

export const submitTutoringMessageRequestSchema = z.object({
  content: z.string().min(1).max(2000),
  conceptId: uuidSchema.optional(),
});
export type SubmitTutoringMessageRequest = z.infer<typeof submitTutoringMessageRequestSchema>;

export const submitTutoringMessageResponseSchema = z.object({
  assistantContent: z.string(),
  understandingDetected: z.boolean(),
  masteryUpdated: z
    .object({
      confidence: z.number().min(0).max(1),
      band: masteryBandSchema,
    })
    .optional(),
});
export type SubmitTutoringMessageResponse = z.infer<typeof submitTutoringMessageResponseSchema>;

// ============================================================================
// 2. Learning Page Entities & Schemas
// ============================================================================

export const conceptLearningPageSchema = z.object({
  id: uuidSchema,
  conceptId: uuidSchema,
  content: z.string(),
  createdAt: isoTimestampSchema,
});
export type ConceptLearningPage = z.infer<typeof conceptLearningPageSchema>;

export const getLearningPageResponseSchema = z.object({
  conceptId: uuidSchema,
  content: z.string(),
});
export type GetLearningPageResponse = z.infer<typeof getLearningPageResponseSchema>;

// ============================================================================
// 3. Quiz Entities & Schemas
// ============================================================================

export const conceptQuizQuestionSchema = z.object({
  id: uuidSchema,
  conceptId: uuidSchema,
  question: z.string().min(1),
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  optionC: z.string().min(1),
  optionD: z.string().min(1),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  questionOrder: z.number().int().nonnegative(),
  createdAt: isoTimestampSchema,
});
export type ConceptQuizQuestion = z.infer<typeof conceptQuizQuestionSchema>;

export const studentQuizQuestionSchema = z.object({
  id: uuidSchema,
  question: z.string().min(1),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  questionOrder: z.number().int().nonnegative(),
});
export type StudentQuizQuestion = z.infer<typeof studentQuizQuestionSchema>;

export const getQuizResponseSchema = z.object({
  conceptId: uuidSchema,
  questions: z.array(studentQuizQuestionSchema).length(5),
});
export type GetQuizResponse = z.infer<typeof getQuizResponseSchema>;

export const submitQuizAnswerSchema = z.object({
  questionId: uuidSchema,
  selectedOption: z.number().int().min(0).max(3),
});
export type SubmitQuizAnswer = z.infer<typeof submitQuizAnswerSchema>;

export const submitQuizRequestSchema = z.object({
  studentId: uuidSchema,
  conceptId: uuidSchema,
  answers: z.array(submitQuizAnswerSchema).min(1).max(5),
});
export type SubmitQuizRequest = z.infer<typeof submitQuizRequestSchema>;

export const submitQuizResponseSchema = z.object({
  attemptId: uuidSchema,
  score: z.number().min(0).max(1),
  correctCount: z.number().int().min(0).max(5),
  totalQuestions: z.number().int().positive(),
  newConfidence: z.number().min(0).max(1),
  newBand: masteryBandSchema,
});
export type SubmitQuizResponse = z.infer<typeof submitQuizResponseSchema>;

// ============================================================================
// 4. Learning Service Port Interface (Lane C)
// ============================================================================

export interface LearningService {
  createTutoringSession(
    actor: ActorContext,
    studentId: UUID,
    conceptIds: UUID[]
  ): Promise<{ sessionId: UUID }>;

  submitTutoringMessage(
    actor: ActorContext,
    sessionId: UUID,
    content: string,
    conceptId?: UUID
  ): Promise<{
    assistantContent: string;
    understandingDetected: boolean;
    masteryUpdated?: { confidence: number; band: MasteryBand };
  }>;

  getLearningPage(actor: ActorContext, conceptId: UUID): Promise<string>;

  getQuiz(
    actor: ActorContext,
    conceptId: UUID
  ): Promise<{
    id: UUID;
    question: string;
    options: [string, string, string, string];
    questionOrder: number;
  }[]>;

  submitQuiz(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    answers: { questionId: UUID; selectedOption: number }[]
  ): Promise<{
    attemptId: UUID;
    score: number;
    correctCount: number;
    totalQuestions: number;
    newConfidence: number;
    newBand: MasteryBand;
  }>;
}
