import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  ActorContext,
  MasteryBand,
  UUID,
} from "../../../contracts/common.js";
import { uuidSchema } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import type {
  CourseEffortDTO,
  GameService,
} from "../../../contracts/game.js";
import { courseEffortSchema } from "../../../contracts/game.js";
import type {
  CourseHeatmapSnapshot,
} from "../../../contracts/mastery.js";
import {
  confidenceSchema,
  confidenceToBand,
} from "../../../contracts/mastery.js";
import { AppError } from "../../../contracts/errors.js";
import type { HeatmapService } from "../mastery/heatmap-service.js";

const PAGE_SIZE = 500;

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

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

const conceptNodeRowSchema = z.object({
  id: uuidSchema,
});

const studentRowSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  course_id: uuidSchema,
});

const xpEventRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  amount: z.number().int().positive(),
  student: z.object({
    course_id: uuidSchema,
  }),
});

const studentMasteryRowSchema = z.object({
  id: uuidSchema,
  student_id: uuidSchema,
  concept_id: uuidSchema,
  confidence: confidenceSchema,
  concept: z.object({
    course_id: uuidSchema,
  }),
  student: z.object({
    course_id: uuidSchema,
  }),
});

const transcriptChunkRowSchema = z.object({
  id: uuidSchema,
  lecture: z.object({
    course_id: uuidSchema,
  }),
  transcript_concepts: z.array(
    z.object({
      concept_id: uuidSchema,
    }),
  ),
});

export interface CourseEffortServiceDependencies {
  client: Pick<SupabaseClient, "from">;
  courses: Pick<CourseService, "getCourse">;
  heatmap: Pick<HeatmapService, "getCourseSnapshot">;
}

export type ClassSkyConcept = CourseHeatmapSnapshot["concepts"][number] & {
  band: MasteryBand;
  taught: boolean;
};

export interface ClassSkySnapshot {
  courseId: UUID;
  totalStudents: number;
  concepts: ClassSkyConcept[];
}

export class CourseEffortService implements Pick<GameService, "getCourseEffort"> {
  constructor(private readonly dependencies: CourseEffortServiceDependencies) {}

  private async authorizeTeacherCourseAccess(actor: ActorContext, courseId: UUID): Promise<void> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only the owning teacher can view course effort",
      });
    }

    const course = await this.dependencies.courses.getCourse(actor, courseId);
    if (course.teacherId !== actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only the owning teacher can view course effort",
      });
    }
  }

  async getCourseEffort(actor: ActorContext, courseId: UUID): Promise<CourseEffortDTO[]> {
    const parsedCourseId = uuidSchema.safeParse(courseId);
    if (!parsedCourseId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
        cause: parsedCourseId.error,
      });
    }
    const validCourseId = parsedCourseId.data;

    await this.authorizeTeacherCourseAccess(actor, validCourseId);

    // 1. Fetch course concept IDs (bounded at 40)
    let conceptResult: { data: unknown; error: unknown };
    try {
      conceptResult = await this.dependencies.client
        .from("concept_nodes")
        .select("id")
        .eq("course_id", validCourseId)
        .order("id");
    } catch (err) {
      throw mapPostgrestError(err, "Failed to load course effort");
    }

    if (conceptResult.error) {
      throw mapPostgrestError(conceptResult.error, "Failed to load course effort");
    }

    const parsedConcepts = z.array(conceptNodeRowSchema).safeParse(conceptResult.data);
    if (!parsedConcepts.success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned invalid course effort data",
        cause: parsedConcepts.error,
      });
    }
    const conceptIds = new Set<UUID>(parsedConcepts.data.map((c) => c.id));

    // 2. Fetch all enrolled students
    const students: Array<{ id: UUID; name: string }> = [];
    const studentIds = new Set<UUID>();
    let studentOffset = 0;

    while (true) {
      let pageResult: { data: unknown; error: unknown };
      try {
        pageResult = await this.dependencies.client
          .from("students")
          .select("id,name,course_id")
          .eq("course_id", validCourseId)
          .order("id")
          .range(studentOffset, studentOffset + PAGE_SIZE - 1);
      } catch (err) {
        throw mapPostgrestError(err, "Failed to load course effort");
      }

      if (pageResult.error) {
        throw mapPostgrestError(pageResult.error, "Failed to load course effort");
      }

      const parsedPage = z.array(studentRowSchema).safeParse(pageResult.data);
      if (!parsedPage.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid course effort data",
          cause: parsedPage.error,
        });
      }

      for (const row of parsedPage.data) {
        if (row.course_id !== validCourseId) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned invalid course effort data",
          });
        }
        students.push({ id: row.id, name: row.name });
        studentIds.add(row.id);
      }

      if (parsedPage.data.length < PAGE_SIZE) {
        break;
      }
      studentOffset += PAGE_SIZE;
    }

    if (students.length === 0) {
      return [];
    }

    // 3. Fetch XP events
    const xpByStudent = new Map<UUID, number>();
    let xpOffset = 0;

    while (true) {
      let pageResult: { data: unknown; error: unknown };
      try {
        pageResult = await this.dependencies.client
          .from("xp_events")
          .select("id,student_id,amount,student:students!inner(course_id)")
          .eq("student.course_id", validCourseId)
          .order("id")
          .range(xpOffset, xpOffset + PAGE_SIZE - 1);
      } catch (err) {
        throw mapPostgrestError(err, "Failed to load course effort");
      }

      if (pageResult.error) {
        throw mapPostgrestError(pageResult.error, "Failed to load course effort");
      }

      const parsedPage = z.array(xpEventRowSchema).safeParse(pageResult.data);
      if (!parsedPage.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid course effort data",
          cause: parsedPage.error,
        });
      }

      for (const row of parsedPage.data) {
        if (row.student.course_id !== validCourseId || !studentIds.has(row.student_id)) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned invalid course effort data",
          });
        }
        const currentXp = xpByStudent.get(row.student_id) ?? 0;
        xpByStudent.set(row.student_id, currentXp + row.amount);
      }

      if (parsedPage.data.length < PAGE_SIZE) {
        break;
      }
      xpOffset += PAGE_SIZE;
    }

    // 4. Fetch mastery records (only if course has concepts)
    const masterySumByStudent = new Map<UUID, number>();
    if (conceptIds.size > 0) {
      let masteryOffset = 0;
      while (true) {
        let pageResult: { data: unknown; error: unknown };
        try {
          pageResult = await this.dependencies.client
            .from("student_mastery")
            .select("id,student_id,concept_id,confidence,concept:concept_nodes!inner(course_id),student:students!inner(course_id)")
            .eq("concept.course_id", validCourseId)
            .eq("student.course_id", validCourseId)
            .order("id")
            .range(masteryOffset, masteryOffset + PAGE_SIZE - 1);
        } catch (err) {
          throw mapPostgrestError(err, "Failed to load course effort");
        }

        if (pageResult.error) {
          throw mapPostgrestError(pageResult.error, "Failed to load course effort");
        }

        const parsedPage = z.array(studentMasteryRowSchema).safeParse(pageResult.data);
        if (!parsedPage.success) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned invalid course effort data",
            cause: parsedPage.error,
          });
        }

        for (const row of parsedPage.data) {
          if (
            row.concept.course_id !== validCourseId ||
            row.student.course_id !== validCourseId ||
            !studentIds.has(row.student_id) ||
            !conceptIds.has(row.concept_id)
          ) {
            throw new AppError({
              code: "INTERNAL_SERVER_ERROR",
              statusCode: 500,
              message: "Database returned invalid course effort data",
            });
          }
          const currentSum = masterySumByStudent.get(row.student_id) ?? 0;
          masterySumByStudent.set(row.student_id, currentSum + row.confidence);
        }

        if (parsedPage.data.length < PAGE_SIZE) {
          break;
        }
        masteryOffset += PAGE_SIZE;
      }
    }

    // 5. Aggregate metrics per student
    const studentMetrics = students.map((s) => {
      const xp = xpByStudent.get(s.id) ?? 0;
      const masterySum = masterySumByStudent.get(s.id) ?? 0;
      const averageConfidence = conceptIds.size > 0 ? masterySum / conceptIds.size : 0;
      return {
        studentId: s.id,
        name: s.name,
        xp,
        averageConfidence,
      };
    });

    // 6. Tied-rank percentiles
    const computeRanks = (values: number[]): Map<number, number> => {
      const sorted = values.toSorted((a, b) => a - b);
      const ranks = new Map<number, number>();
      for (let i = 0; i < sorted.length; i += 1) {
        const value = sorted[i]!;
        if (!ranks.has(value)) {
          ranks.set(value, Math.round((100 * i) / Math.max(1, sorted.length - 1)));
        }
      }
      return ranks;
    };

    const xpRanks = computeRanks(studentMetrics.map((m) => m.xp));
    const confRanks = computeRanks(studentMetrics.map((m) => m.averageConfidence));

    const result: CourseEffortDTO[] = studentMetrics.map((s) => {
      const xpRank = xpRanks.get(s.xp);
      const confRank = confRanks.get(s.averageConfidence);
      if (xpRank === undefined || confRank === undefined) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid course effort data",
        });
      }

      const flag = conceptIds.size > 0 && xpRank >= 75 && confRank <= 40 ? "high_effort_low_mastery" : null;
      return {
        studentId: s.studentId,
        name: s.name,
        xp: s.xp,
        averageConfidence: s.averageConfidence,
        flag,
      };
    });

    result.sort((a, b) => a.studentId.localeCompare(b.studentId));

    for (const item of result) {
      courseEffortSchema.parse(item);
    }

    return result;
  }

  async getClassSky(actor: ActorContext, courseId: UUID): Promise<ClassSkySnapshot> {
    const parsedCourseId = uuidSchema.safeParse(courseId);
    if (!parsedCourseId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
        cause: parsedCourseId.error,
      });
    }
    const validCourseId = parsedCourseId.data;

    await this.authorizeTeacherCourseAccess(actor, validCourseId);

    const snapshot = await this.dependencies.heatmap.getCourseSnapshot(actor, validCourseId);

    if (snapshot.concepts.length === 0) {
      return {
        courseId: validCourseId,
        totalStudents: snapshot.totalStudents,
        concepts: [],
      };
    }

    const validConceptIds = new Set(snapshot.concepts.map((c) => c.conceptId));
    const taughtConceptIds = new Set<UUID>();
    let chunkOffset = 0;

    while (true) {
      let pageResult: { data: unknown; error: unknown };
      try {
        pageResult = await this.dependencies.client
          .from("transcript_chunks")
          .select("id,lecture:lecture_sessions!inner(course_id),transcript_concepts(concept_id)")
          .eq("lecture.course_id", validCourseId)
          .order("id", { ascending: true })
          .range(chunkOffset, chunkOffset + PAGE_SIZE - 1);
      } catch (err) {
        throw mapPostgrestError(err, "Failed to load class sky");
      }

      if (pageResult.error) {
        throw mapPostgrestError(pageResult.error, "Failed to load class sky");
      }

      const parsedPage = z.array(transcriptChunkRowSchema).safeParse(pageResult.data);
      if (!parsedPage.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned invalid class sky data",
          cause: parsedPage.error,
        });
      }

      for (const row of parsedPage.data) {
        if (row.lecture.course_id !== validCourseId) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database returned invalid class sky data",
          });
        }
        for (const tc of row.transcript_concepts) {
          if (validConceptIds.has(tc.concept_id)) {
            taughtConceptIds.add(tc.concept_id);
          }
        }
      }

      if (parsedPage.data.length < PAGE_SIZE) {
        break;
      }
      chunkOffset += PAGE_SIZE;
    }

    return {
      courseId: validCourseId,
      totalStudents: snapshot.totalStudents,
      concepts: snapshot.concepts.map((c) => ({
        ...c,
        band: confidenceToBand(c.averageConfidence),
        taught: taughtConceptIds.has(c.conceptId),
      })),
    };
  }
}
