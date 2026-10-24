import { z } from "zod";
import {
  type UUID,
  type ISOTimestamp,
  type ActorContext,
  type MasteryBand,
  uuidSchema,
  isoTimestampSchema,
  masteryBandSchema,
} from "./common.js";

export interface StudentMastery {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  confidence: number;
  attempts: number;
  version: number;
  lastUpdated: ISOTimestamp;
}

export type MasteryEvidence =
  | { type: "poll"; outcome: "correct" | "partial" | "wrong"; sourceId: UUID }
  | { type: "tutor"; sourceId: UUID }
  | { type: "quiz"; score: number; sourceId: UUID }
  | { type: "attendance"; sourceId: UUID };

export interface MasteryUpdatedEvent {
  eventId: UUID;
  occurredAt: ISOTimestamp;
  studentId: UUID;
  conceptId: UUID;
  confidence: number;
  band: MasteryBand;
  evidenceType: "poll" | "tutor" | "quiz" | "attendance";
  attempts: number;
  version: number;
}

export interface ClassHeatmapItem {
  conceptId: UUID;
  distribution: Record<MasteryBand, number>;
  averageConfidence: number;
}

export interface MasteryService {
  getMastery(actor: ActorContext, studentId: UUID): Promise<StudentMastery[]>;
  applyEvidence(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    evidence: MasteryEvidence
  ): Promise<{
    confidence: number;
    band: MasteryBand;
    attempts: number;
    version: number;
  }>;
  getClassHeatmap(actor: ActorContext, courseId: UUID): Promise<ClassHeatmapItem[]>;
  initializeStudentMastery(studentId: UUID, courseId: UUID): Promise<number>;
}

export const confidenceSchema = z
  .number()
  .min(0.0)
  .max(1.0)
  .refine(Number.isFinite, {
    message: "Confidence must be a finite number between 0.0 and 1.0",
  });

export function confidenceToBand(c: number): MasteryBand {
  const validC = confidenceSchema.parse(c);
  if (validC === 0.0) return "gray";
  if (validC < 0.4) return "red";
  if (validC < 0.7) return "yellow";
  return "green";
}

export function applyMasteryEvidence(
  current: number,
  evidence: MasteryEvidence
): { confidence: number; band: MasteryBand } {
  const validCurrent = confidenceSchema.parse(current);
  const validEvidence = masteryEvidenceSchema.parse(evidence);
  let newConfidence: number;

  switch (validEvidence.type) {
    case "poll": {
      if (validEvidence.outcome === "correct") {
        newConfidence = Math.max(validCurrent, 0.85);
      } else if (validEvidence.outcome === "partial") {
        newConfidence = Math.max(validCurrent, 0.5);
      } else {
        newConfidence = validCurrent === 0.0 ? 0.2 : Math.min(validCurrent, 0.2);
      }
      break;
    }
    case "tutor": {
      newConfidence = Math.min(validCurrent + 0.2, 1.0);
      break;
    }
    case "quiz": {
      let delta: number;
      if (validEvidence.score >= 0.8) {
        delta = 0.15;
      } else if (validEvidence.score >= 0.6) {
        delta = 0.1;
      } else if (validEvidence.score >= 0.4) {
        delta = 0.05;
      } else {
        delta = 0.02;
      }
      newConfidence = Math.min(validCurrent + delta, 1.0);
      break;
    }
    case "attendance": {
      newConfidence = validCurrent < 0.3 ? Math.min(validCurrent + 0.05, 0.3) : validCurrent;
      break;
    }
  }

  // Round to 3 decimal places to avoid floating point precision artifacts
  newConfidence = Math.round(newConfidence * 1000) / 1000;

  return {
    confidence: newConfidence,
    band: confidenceToBand(newConfidence),
  };
}

export const studentMasterySchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  conceptId: uuidSchema,
  confidence: confidenceSchema,
  attempts: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  lastUpdated: isoTimestampSchema,
});

export const pollEvidenceSchema = z.object({
  type: z.literal("poll"),
  outcome: z.enum(["correct", "partial", "wrong"]),
  sourceId: uuidSchema,
});

export const tutorEvidenceSchema = z.object({
  type: z.literal("tutor"),
  sourceId: uuidSchema,
});

export const quizEvidenceSchema = z.object({
  type: z.literal("quiz"),
  score: z.number().min(0.0).max(1.0).refine(Number.isFinite),
  sourceId: uuidSchema,
});

export const attendanceEvidenceSchema = z.object({
  type: z.literal("attendance"),
  sourceId: uuidSchema,
});

export const masteryEvidenceSchema = z.discriminatedUnion("type", [
  pollEvidenceSchema,
  tutorEvidenceSchema,
  quizEvidenceSchema,
  attendanceEvidenceSchema,
]);

export const masteryUpdatedEventSchema = z.object({
  eventId: uuidSchema,
  occurredAt: isoTimestampSchema,
  studentId: uuidSchema,
  conceptId: uuidSchema,
  confidence: confidenceSchema,
  band: masteryBandSchema,
  evidenceType: z.enum(["poll", "tutor", "quiz", "attendance"]),
  attempts: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});

export const classHeatmapItemSchema = z.object({
  conceptId: uuidSchema,
  distribution: z.object({
    gray: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    green: z.number().int().nonnegative(),
  }),
  averageConfidence: confidenceSchema,
});
