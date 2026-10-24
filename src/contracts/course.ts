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

export interface Course {
  id: UUID;
  teacherId: UUID;
  name: string;
  description?: string;
  joinCode: string;
  pdfCacheHash?: string;
  createdAt: ISOTimestamp;
}

export interface Student {
  id: UUID;
  authId: UUID;
  courseId: UUID;
  name: string;
  email: string;
  createdAt: ISOTimestamp;
}

export interface ConceptNode {
  id: UUID;
  courseId: UUID;
  label: string;
  description: string;
  category: string;
  difficulty: number;
  x?: number;
  y?: number;
  createdAt: ISOTimestamp;
}

export interface ConceptEdge {
  id: UUID;
  courseId: UUID;
  sourceId: UUID;
  targetId: UUID;
  relationship: "prerequisite";
  createdAt: ISOTimestamp;
}

export interface CourseService {
  createCourse(actor: ActorContext, name: string, description?: string): Promise<Course>;
  getCourse(actor: ActorContext, courseId: UUID): Promise<Course>;
  listCourses(actor: ActorContext): Promise<Course[]>;
  enrollStudent(actor: ActorContext, joinCode: string): Promise<Student>;
  listEnrolledStudents(actor: ActorContext, courseId: UUID): Promise<Student[]>;
}

export interface GraphService {
  validateGraph(
    nodes: Omit<ConceptNode, "id" | "courseId" | "createdAt">[],
    edges: [string, string][]
  ): Promise<boolean>;
  commitKnowledgeGraph(
    actor: ActorContext,
    courseId: UUID,
    nodes: Omit<ConceptNode, "id" | "courseId" | "createdAt">[],
    edges: [string, string][]
  ): Promise<{ nodeCount: number; edgeCount: number }>;
  getCourseGraph(
    actor: ActorContext,
    courseId: UUID
  ): Promise<{
    nodes: (ConceptNode & { importance: number; confidence?: number; band?: MasteryBand })[];
    edges: ConceptEdge[];
  }>;
  calculateImportance(courseId: UUID): Promise<Map<UUID, number>>;
}

export const courseSchema = z.object({
  id: uuidSchema,
  teacherId: uuidSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  joinCode: z.string().min(1),
  pdfCacheHash: z.string().optional(),
  createdAt: isoTimestampSchema,
});

export const studentSchema = z.object({
  id: uuidSchema,
  authId: uuidSchema,
  courseId: uuidSchema,
  name: z.string().min(1),
  email: z.email(),
  createdAt: isoTimestampSchema,
});

export const conceptNodeSchema = z.object({
  id: uuidSchema,
  courseId: uuidSchema,
  label: z.string().min(1),
  description: z.string(),
  category: z.string(),
  difficulty: z.number().int().min(1).max(5),
  x: z.number().optional(),
  y: z.number().optional(),
  createdAt: isoTimestampSchema,
});

export const conceptEdgeSchema = z.object({
  id: uuidSchema,
  courseId: uuidSchema,
  sourceId: uuidSchema,
  targetId: uuidSchema,
  relationship: z.literal("prerequisite"),
  createdAt: isoTimestampSchema,
});

export const rawConceptSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
  category: z.string(),
  difficulty: z.number().int().min(1).max(5),
});

export const rawEdgeSchema = z.tuple([z.string().min(1), z.string().min(1)]);

export const syllabusPreviewSchema = z.object({
  concepts: z.array(rawConceptSchema).min(1).max(40),
  edges: z.array(rawEdgeSchema),
});

export const syllabusUploadPreviewResponseSchema = z.object({
  courseId: uuidSchema,
  totalPages: z.number().int().nonnegative(),
  processedPages: z.number().int().nonnegative(),
  truncated: z.boolean(),
  preview: syllabusPreviewSchema,
});

export const graphNodeResponseSchema = z.object({
  id: uuidSchema,
  label: z.string().min(1),
  description: z.string(),
  category: z.string(),
  difficulty: z.number().int().min(1).max(5),
  importance: z.number(),
  confidence: z.number().min(0.0).max(1.0).optional(),
  band: masteryBandSchema.optional(),
});

export const graphEdgeResponseSchema = z.object({
  id: uuidSchema,
  source: uuidSchema,
  target: uuidSchema,
  relationship: z.literal("prerequisite"),
});

export const courseGraphResponseSchema = z.object({
  nodes: z.array(graphNodeResponseSchema),
  edges: z.array(graphEdgeResponseSchema),
});
