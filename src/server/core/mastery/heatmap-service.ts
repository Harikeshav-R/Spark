import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
  MasteryBand,
} from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import type { CourseService as CourseServicePort } from "../../../contracts/course.js";
import type {
  ClassHeatmapItem,
  MasteryService as MasteryServicePort,
  CourseHeatmapSnapshot,
} from "../../../contracts/mastery.js";
import {
  confidenceSchema,
  confidenceToBand,
} from "../../../contracts/mastery.js";
import type { RealtimePublisher } from "../../../contracts/realtime.js";
import { heatmapUpdatedEventSchema } from "../../../contracts/realtime.js";
import { AppError } from "../../../contracts/errors.js";


export interface HeatmapServiceDependencies {
  client: Pick<SupabaseClient, "from">;
  courses: Pick<CourseServicePort, "getCourse">;
  publisher: Pick<RealtimePublisher, "emitToTeacher">;
  clock: Clock;
  ids: Pick<IdGenerator, "generateId">;
}

interface CacheEntry {
  snapshot: CourseHeatmapSnapshot;
  expiresAt: number;
}

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

const conceptNodeRowSchema = z.object({
  id: uuidSchema,
  label: z.string().min(1),
  category: z.string().min(1),
});

const studentMasteryRowSchema = z.object({
  id: uuidSchema,
  concept_id: uuidSchema,
  confidence: confidenceSchema,
  concept: z.object({
    course_id: uuidSchema,
  }),
  student: z.object({
    course_id: uuidSchema,
  }),
});

const lectureSessionRowSchema = z.object({
  id: uuidSchema,
});

const studentEnrollmentRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
});

const CACHE_TTL_MS = 5000;
const MAX_CACHE_ENTRIES = 128;
const PAGE_SIZE = 500;

function mapPostgrestError(errUnknown: unknown, contextMessage: string): AppError {
  if (errUnknown instanceof AppError) {
    return errUnknown;
  }
  const err = (errUnknown ?? {}) as PostgrestErrorLike;
  const code = typeof err.code === "string" ? err.code : "";

  if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") {
    return new AppError({
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      message: contextMessage,
      cause: errUnknown,
    });
  }
  if (code === "42501") {
    return new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: `${contextMessage}: Permission denied`,
      cause: errUnknown,
    });
  }

  return new AppError({
    code: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
    message: `${contextMessage}: ${err.message ?? "Unexpected database error"}`,
    cause: errUnknown,
  });
}

function cloneSnapshot(snapshot: CourseHeatmapSnapshot): CourseHeatmapSnapshot {
  return {
    courseId: snapshot.courseId,
    totalStudents: snapshot.totalStudents,
    concepts: snapshot.concepts.map((c) => ({
      conceptId: c.conceptId,
      label: c.label,
      category: c.category,
      distribution: {
        gray: c.distribution.gray,
        red: c.distribution.red,
        yellow: c.distribution.yellow,
        green: c.distribution.green,
      },
      averageConfidence: c.averageConfidence,
    })),
  };
}

export class HeatmapService implements Pick<MasteryServicePort, "getClassHeatmap"> {
  private readonly cache = new Map<UUID, CacheEntry>();
  private readonly activeRevisions = new Map<UUID, number>();
  private readonly refreshChains = new Map<UUID, Promise<void>>();

  constructor(private readonly dependencies: HeatmapServiceDependencies) {}

  private async authorizeTeacherCourseAccess(actor: ActorContext, courseId: UUID): Promise<void> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only the owning teacher can view course heatmaps",
      });
    }

    const course = await this.dependencies.courses.getCourse(actor, courseId);
    if (course.teacherId !== actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only the owning teacher can view course heatmaps",
      });
    }
  }

  private cleanExpiredCache(): void {
    const now = this.dependencies.clock.now().getTime();
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  private invalidateCache(courseId: UUID): void {
    this.activeRevisions.set(courseId, (this.activeRevisions.get(courseId) ?? 0) + 1);
    this.cache.delete(courseId);
  }

  private async loadCourseSnapshot(courseId: UUID, bypassCache: boolean): Promise<CourseHeatmapSnapshot> {
    const now = this.dependencies.clock.now().getTime();
    if (!bypassCache) {
      this.cleanExpiredCache();
      const cached = this.cache.get(courseId);
      if (cached && now < cached.expiresAt) {
        return cloneSnapshot(cached.snapshot);
      }
    }

    const startRevision = this.activeRevisions.get(courseId) ?? 0;

    // 1. Fetch concepts in course
    let conceptData: unknown;
    try {
      const conceptResult = await this.dependencies.client
        .from("concept_nodes")
        .select("id,label,category")
        .eq("course_id", courseId)
        .order("id");

      if (conceptResult.error) {
        throw mapPostgrestError(conceptResult.error, "Failed to load course heatmap");
      }
      conceptData = conceptResult.data;
    } catch (err) {
      throw mapPostgrestError(err, "Failed to load course heatmap");
    }

    const parsedConcepts = z.array(conceptNodeRowSchema).safeParse(conceptData);
    if (!parsedConcepts.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid course heatmap data",
        cause: parsedConcepts.error,
      });
    }
    const conceptsList = parsedConcepts.data;

    // 2. Fetch total students enrolled in course
    let studentCount: number | null;
    try {
      const studentResult = await this.dependencies.client
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("course_id", courseId);

      if (studentResult.error) {
        throw mapPostgrestError(studentResult.error, "Failed to load course heatmap");
      }
      studentCount = studentResult.count;
    } catch (err) {
      throw mapPostgrestError(err, "Failed to load course heatmap");
    }

    if (
      studentCount === null ||
      typeof studentCount !== "number" ||
      !Number.isInteger(studentCount) ||
      studentCount < 0
    ) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid course heatmap data",
      });
    }

    const totalStudents = studentCount;

    // Zero concepts -> empty array, preserving totalStudents
    if (conceptsList.length === 0) {
      const snapshot: CourseHeatmapSnapshot = {
        courseId,
        totalStudents,
        concepts: [],
      };
      this.setCache(courseId, snapshot, startRevision);
      return cloneSnapshot(snapshot);
    }

    // Zero students -> all concepts have zero counts and mean 0
    if (totalStudents === 0) {
      const snapshot: CourseHeatmapSnapshot = {
        courseId,
        totalStudents: 0,
        concepts: conceptsList.map((c) => ({
          conceptId: c.id,
          label: c.label,
          category: c.category,
          distribution: {
            gray: 0,
            red: 0,
            yellow: 0,
            green: 0,
          },
          averageConfidence: 0,
        })),
      };
      this.setCache(courseId, snapshot, startRevision);
      return cloneSnapshot(snapshot);
    }

    // 3. Aggregate mastery rows
    interface ConceptAccumulator {
      conceptId: UUID;
      label: string;
      category: string;
      distribution: Record<MasteryBand, number>;
      sumConfidence: number;
      persistedRows: number;
    }

    const accumulatorMap = new Map<UUID, ConceptAccumulator>();
    for (const c of conceptsList) {
      accumulatorMap.set(c.id, {
        conceptId: c.id,
        label: c.label,
        category: c.category,
        distribution: {
          gray: totalStudents,
          red: 0,
          yellow: 0,
          green: 0,
        },
        sumConfidence: 0,
        persistedRows: 0,
      });
    }

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let pageData: unknown;
      try {
        const pageResult = await this.dependencies.client
          .from("student_mastery")
          .select(
            "id,concept_id,confidence," +
              "concept:concept_nodes!inner(course_id)," +
              "student:students!inner(course_id)"
          )
          .eq("concept.course_id", courseId)
          .eq("student.course_id", courseId)
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (pageResult.error) {
          throw mapPostgrestError(pageResult.error, "Failed to load course heatmap");
        }
        pageData = pageResult.data;
      } catch (err) {
        throw mapPostgrestError(err, "Failed to load course heatmap");
      }

      const parsedPage = z.array(studentMasteryRowSchema).safeParse(pageData);
      if (!parsedPage.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid course heatmap data",
          cause: parsedPage.error,
        });
      }

      const rows = parsedPage.data;
      for (const row of rows) {
        const acc = accumulatorMap.get(row.concept_id);
        if (!acc) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned invalid course heatmap data",
          });
        }

        acc.persistedRows += 1;
        if (acc.persistedRows > totalStudents) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned invalid course heatmap data",
          });
        }

        const band = confidenceToBand(row.confidence);
        if (band !== "gray") {
          acc.distribution.gray -= 1;
          acc.distribution[band] += 1;
        }
        acc.sumConfidence += row.confidence;
      }

      if (rows.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
      }
    }

    const conceptsResult: Array<ClassHeatmapItem & { label: string; category: string }> = conceptsList.map((c) => {
      const acc = accumulatorMap.get(c.id)!;
      const averageConfidence = totalStudents === 0 ? 0 : acc.sumConfidence / totalStudents;
      return {
        conceptId: acc.conceptId,
        label: acc.label,
        category: acc.category,
        distribution: {
          gray: acc.distribution.gray,
          red: acc.distribution.red,
          yellow: acc.distribution.yellow,
          green: acc.distribution.green,
        },
        averageConfidence,
      };
    });

    const snapshot: CourseHeatmapSnapshot = {
      courseId,
      totalStudents,
      concepts: conceptsResult,
    };

    this.setCache(courseId, snapshot, startRevision);
    return cloneSnapshot(snapshot);
  }

  private setCache(courseId: UUID, snapshot: CourseHeatmapSnapshot, startRevision: number): void {
    const currentRevision = this.activeRevisions.get(courseId) ?? 0;
    if (currentRevision !== startRevision) {
      return;
    }

    this.cleanExpiredCache();
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const expiresAt = this.dependencies.clock.now().getTime() + CACHE_TTL_MS;
    this.cache.set(courseId, { snapshot: cloneSnapshot(snapshot), expiresAt });
  }

  async getClassHeatmap(actor: ActorContext, courseId: UUID): Promise<ClassHeatmapItem[]> {
    const snapshot = await this.getCourseSnapshot(actor, courseId);
    return snapshot.concepts.map((c) => ({
      conceptId: c.conceptId,
      distribution: {
        gray: c.distribution.gray,
        red: c.distribution.red,
        yellow: c.distribution.yellow,
        green: c.distribution.green,
      },
      averageConfidence: c.averageConfidence,
    }));
  }

  async getCourseSnapshot(actor: ActorContext, courseId: UUID): Promise<CourseHeatmapSnapshot> {
    const parsedCourseId = uuidSchema.safeParse(courseId);
    if (!parsedCourseId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
        cause: parsedCourseId.error,
      });
    }

    await this.authorizeTeacherCourseAccess(actor, parsedCourseId.data);

    return this.loadCourseSnapshot(parsedCourseId.data, false);
  }

  async afterEvidenceApplied(actor: ActorContext, studentId: UUID, conceptId: UUID): Promise<void> {
    // 1. Derive courseId from persisted student enrollment
    let query = this.dependencies.client
      .from("students")
      .select("id,course_id")
      .eq("id", studentId);

    if (actor.role === "student") {
      query = query.eq("auth_id", actor.authId);
    }

    let studentResult: { data: unknown; error: unknown };
    try {
      studentResult = await query.maybeSingle();
      if (studentResult.error) {
        throw mapPostgrestError(studentResult.error, "Failed to resolve student course for heatmap refresh");
      }
    } catch (err) {
      throw mapPostgrestError(err, "Failed to resolve student course for heatmap refresh");
    }

    if (!studentResult.data) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Student enrollment not found for heatmap refresh",
      });
    }

    const parsedEnrollment = studentEnrollmentRowSchema.safeParse(studentResult.data);
    if (!parsedEnrollment.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Invalid student enrollment record in database",
        cause: parsedEnrollment.error,
      });
    }

    const courseId = parsedEnrollment.data.course_id;

    // 3. Verify course authorization
    await this.dependencies.courses.getCourse(actor, courseId);

    // Invalidate cached state and advance revision for target course
    this.invalidateCache(courseId);

    // 4. Queue and serialize refresh operations per course
    const previousPromise = this.refreshChains.get(courseId) ?? Promise.resolve();
    const currentPromise = previousPromise
      .catch(() => {})
      .then(async () => {
        await this.runCourseRefresh(courseId, conceptId);
      });

    this.refreshChains.set(courseId, currentPromise);

    try {
      await currentPromise;
    } finally {
      if (this.refreshChains.get(courseId) === currentPromise) {
        this.refreshChains.delete(courseId);
      }
    }
  }

  private async runCourseRefresh(courseId: UUID, conceptId: UUID): Promise<void> {
    // Reload course snapshot bypassing cache
    const snapshot = await this.loadCourseSnapshot(courseId, true);

    const changedConcept = snapshot.concepts.find((c) => c.conceptId === conceptId);
    if (!changedConcept) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Concept not found in course knowledge graph during heatmap refresh",
      });
    }

    // Query live lectures in course
    let offset = 0;
    let hasMore = true;
    const liveLectureIds: UUID[] = [];

    while (hasMore) {
      let lectureData: unknown;
      try {
        const lectureResult = await this.dependencies.client
          .from("lecture_sessions")
          .select("id")
          .eq("course_id", courseId)
          .eq("status", "live")
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1);

        if (lectureResult.error) {
          throw mapPostgrestError(lectureResult.error, "Failed to load live lectures for heatmap refresh");
        }
        lectureData = lectureResult.data;
      } catch (err) {
        throw mapPostgrestError(err, "Failed to load live lectures for heatmap refresh");
      }

      const parsedLectures = z.array(lectureSessionRowSchema).safeParse(lectureData);
      if (!parsedLectures.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid lecture sessions data",
          cause: parsedLectures.error,
        });
      }

      const rows = parsedLectures.data;
      for (const row of rows) {
        liveLectureIds.push(row.id);
      }

      if (rows.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
      }
    }

    if (liveLectureIds.length === 0) {
      return;
    }

    const eventPayload = heatmapUpdatedEventSchema.parse({
      eventId: this.dependencies.ids.generateId(),
      occurredAt: this.dependencies.clock.nowISO(),
      courseId,
      totalStudents: snapshot.totalStudents,
      conceptId,
      distribution: changedConcept.distribution,
      averageConfidence: changedConcept.averageConfidence,
    });

    for (const lectureId of liveLectureIds) {
      await this.dependencies.publisher.emitToTeacher(lectureId, "heatmap:updated", eventPayload);
    }
  }
}
