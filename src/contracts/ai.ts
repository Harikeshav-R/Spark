import { z } from "zod";
import { type UUID, uuidSchema } from "./common.js";
import { type ConceptNode } from "./course.js";
import { pollResponseOutcomeSchema, type PollResponseOutcome } from "./classroom.js";

// ============================================================================
// 1. Pipeline 2.1: extractPrerequisiteGraph
// ============================================================================

export const extractedPrerequisiteConceptSchema = z.object({
  label: z.string().min(1).max(100),
  description: z.string().min(10).max(500),
  category: z.string().min(1).max(50),
  difficulty: z.number().int().min(1).max(5),
});
export type ExtractedPrerequisiteConcept = z.infer<typeof extractedPrerequisiteConceptSchema>;

export const extractedPrerequisiteGraphSchema = z.object({
  concepts: z.array(extractedPrerequisiteConceptSchema).min(1).max(40),
  edges: z.array(z.tuple([z.string(), z.string()])),
});
export type ExtractedPrerequisiteGraph = z.infer<typeof extractedPrerequisiteGraphSchema>;

export const prerequisiteGraphExtractionResultSchema = z.object({
  totalPages: z.number().int().nonnegative(),
  processedPages: z.number().int().nonnegative(),
  truncated: z.boolean(),
  concepts: z.array(extractedPrerequisiteConceptSchema).min(1).max(40),
  edges: z.array(z.tuple([z.string(), z.string()])),
});
export type PrerequisiteGraphExtractionResult = z.infer<typeof prerequisiteGraphExtractionResultSchema>;

// ============================================================================
// 2. Pipeline 2.2: detectConcepts
// ============================================================================

export const detectConceptsCandidateSchema = z.object({
  id: uuidSchema,
  label: z.string().min(1),
});
export type DetectConceptsCandidate = z.infer<typeof detectConceptsCandidateSchema>;

export const detectedConceptsSchema = z.object({
  conceptIds: z.array(uuidSchema),
});
export type DetectedConcepts = z.infer<typeof detectedConceptsSchema>;

// ============================================================================
// 3. Pipeline 2.3: generatePollQuestion
// ============================================================================

export const generatedPollQuestionSchema = z.object({
  question: z.string().min(15).max(500),
  expectedAnswer: z.string().min(15).max(1000),
});
export type GeneratedPollQuestion = z.infer<typeof generatedPollQuestionSchema>;

// ============================================================================
// 4. Pipeline 2.4: evaluatePollResponse
// ============================================================================

export const evaluatedPollResponseSchema = z.object({
  outcome: pollResponseOutcomeSchema,
  feedback: z.string().min(5).max(500),
});
export type EvaluatedPollResponse = z.infer<typeof evaluatedPollResponseSchema>;

// ============================================================================
// 5. Pipeline 2.5: socraticTutorTurn
// ============================================================================

export const tutorConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});
export type TutorConversationMessage = z.infer<typeof tutorConversationMessageSchema>;

export const socraticTutorTurnResponseSchema = z.object({
  assistantResponse: z.string().min(10).max(1500),
  understandingDetected: z.boolean(),
});
export type SocraticTutorTurnResponse = z.infer<typeof socraticTutorTurnResponseSchema>;

// ============================================================================
// 6. Pipeline 2.6: checkUnderstanding
// ============================================================================

export const checkUnderstandingResponseSchema = z.object({
  understandingConfirmed: z.boolean(),
  rationale: z.string().max(250),
});
export type CheckUnderstandingResponse = z.infer<typeof checkUnderstandingResponseSchema>;

// ============================================================================
// 7. Pipeline 2.7: summarizeMisconceptions
// ============================================================================

export const misconceptionRecommendationSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().min(10).max(300),
  actionablePrompt: z.string().min(10).max(300),
});
export type MisconceptionRecommendation = z.infer<typeof misconceptionRecommendationSchema>;

export const summarizedMisconceptionsSchema = z.object({
  misconceptions: z.array(z.string().min(5).max(200)),
  recommendations: z.array(misconceptionRecommendationSchema),
});
export type SummarizedMisconceptions = z.infer<typeof summarizedMisconceptionsSchema>;

// ============================================================================
// 8. Pipeline 2.8: summarizeLecture
// ============================================================================

export const lectureTimelineHighlightSchema = z.object({
  timestampSec: z.number().nonnegative(),
  conceptLabel: z.string(),
  description: z.string(),
});
export type LectureTimelineHighlight = z.infer<typeof lectureTimelineHighlightSchema>;

export const summarizedLectureSchema = z.object({
  summary: z.string().min(100).max(3000),
  keyConceptsCovered: z.array(uuidSchema),
  timelineHighlights: z.array(lectureTimelineHighlightSchema),
});
export type SummarizedLecture = z.infer<typeof summarizedLectureSchema>;

// ============================================================================
// 9. Pipeline 2.9: suggestInterventions
// ============================================================================

export const interventionRecommendationSchema = z.object({
  title: z.string(),
  description: z.string(),
  actionablePrompt: z.string(),
});
export type InterventionRecommendation = z.infer<typeof interventionRecommendationSchema>;

export const suggestedInterventionsSchema = z.object({
  misconceptions: z.array(z.string()),
  recommendations: z.array(interventionRecommendationSchema),
});
export type SuggestedInterventions = z.infer<typeof suggestedInterventionsSchema>;

// ============================================================================
// 10. Pipeline 2.10: generateLearningPage
// ============================================================================

export const generatedLearningPageSchema = z.object({
  content: z.string().min(500).max(15000),
});
export type GeneratedLearningPage = z.infer<typeof generatedLearningPageSchema>;

// ============================================================================
// 11. Pipeline 2.11: generateQuizQuestions
// ============================================================================

export const generatedQuizQuestionSchema = z.object({
  question: z.string().min(10).max(500),
  optionA: z.string().min(1).max(200),
  optionB: z.string().min(1).max(200),
  optionC: z.string().min(1).max(200),
  optionD: z.string().min(1).max(200),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().min(10).max(500),
});
export type GeneratedQuizQuestion = z.infer<typeof generatedQuizQuestionSchema>;

export const generatedQuizQuestionsSchema = z.object({
  questions: z.array(generatedQuizQuestionSchema).length(5),
});
export type GeneratedQuizQuestions = z.infer<typeof generatedQuizQuestionsSchema>;

// ============================================================================
// 12. Pipeline 2.12: searchAcademicResources
// ============================================================================

export const academicResourceSchema = z.object({
  title: z.string(),
  url: z.url(),
  snippet: z.string(),
  citationNumber: z.number().int().positive(),
});
export type AcademicResource = z.infer<typeof academicResourceSchema>;

export const academicResourcesSchema = z.object({
  resources: z.array(academicResourceSchema),
});
export type AcademicResources = z.infer<typeof academicResourcesSchema>;

// ============================================================================
// 13. Pipeline 2.13: answerResourceQuestion
// ============================================================================

export const resourceCitationSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
});
export type ResourceCitation = z.infer<typeof resourceCitationSchema>;

export const answeredResourceQuestionSchema = z.object({
  answer: z.string().min(10),
  citations: z.array(resourceCitationSchema),
});
export type AnsweredResourceQuestion = z.infer<typeof answeredResourceQuestionSchema>;

// ============================================================================
// AI Service Port Interface (Lane C)
// ============================================================================

export interface AiService {
  extractPrerequisiteGraph(pdfBytes: Buffer): Promise<{
    totalPages: number;
    processedPages: number;
    truncated: boolean;
    concepts: { label: string; description: string; category: string; difficulty: number }[];
    edges: [string, string][];
  }>;

  detectConcepts(
    chunkText: string,
    candidateConcepts: { id: UUID; label: string }[]
  ): Promise<UUID[]>;

  generatePollQuestion(
    concept: ConceptNode,
    recentTranscript: string
  ): Promise<{ question: string; expectedAnswer: string }>;

  evaluatePollResponse(
    question: string,
    expectedAnswer: string,
    studentAnswer: string
  ): Promise<{
    outcome: PollResponseOutcome;
    feedback: string;
  }>;

  socraticTutorTurn(
    concept: ConceptNode,
    messageHistory: { role: "user" | "assistant"; content: string }[],
    newStudentMessage: string
  ): Promise<{
    assistantResponse: string;
    understandingDetected: boolean;
  }>;

  checkUnderstanding?(
    concept: ConceptNode,
    tutorQuestion: string,
    studentAnswer: string
  ): Promise<{
    understandingConfirmed: boolean;
    rationale: string;
  }>;

  summarizeMisconceptions(
    pollId: UUID,
    responses: { answer: string; outcome: string }[]
  ): Promise<{
    misconceptions: string[];
    recommendations: { title: string; description: string; actionablePrompt: string }[];
  }>;

  summarizeLecture?(
    transcriptChunks: { text: string; timestampSec: number }[]
  ): Promise<{
    summary: string;
    keyConceptsCovered: UUID[];
    timelineHighlights: { timestampSec: number; conceptLabel: string; description: string }[];
  }>;

  suggestInterventions?(
    lectureId: UUID,
    pollResponses: { answer: string; outcome: string }[]
  ): Promise<{
    misconceptions: string[];
    recommendations: { title: string; description: string; actionablePrompt: string }[];
  }>;

  generateLearningPage(concept: ConceptNode): Promise<string>;

  generateQuizQuestions(concept: ConceptNode): Promise<{
    question: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: number;
    explanation: string;
  }[]>;

  searchAcademicResources(
    conceptLabel: string,
    query?: string
  ): Promise<{
    title: string;
    url: string;
    snippet: string;
    citationNumber: number;
  }[]>;

  answerResourceQuestion?(
    concept: ConceptNode,
    studentInquiry: string
  ): Promise<{
    answer: string;
    citations: { number: number; title: string; url: string }[];
  }>;
}
