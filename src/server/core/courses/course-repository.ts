import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Course } from "../../../contracts/course";
import { courseSchema } from "../../../contracts/course";
import type { ActorContext, UUID } from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";

export class JoinCodeCollisionError extends Error {
  constructor(message = "Join code collision detected") {
    super(message);
    this.name = "JoinCodeCollisionError";
  }
}

const courseRowSchema = z.object({
  id: uuidSchema,
  teacher_id: uuidSchema,
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  join_code: z.string().min(1),
  pdf_cache_hash: z.string().nullable().optional(),
  created_at: z.string().min(1),
});

function mapCourseRow(row: z.infer<typeof courseRowSchema>): Course {
  const course: Course = {
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    joinCode: row.join_code,
    createdAt: new Date(row.created_at).toISOString(),
  };
  if (typeof row.description === "string" && row.description.length > 0) {
    course.description = row.description;
  }
  if (
    typeof row.pdf_cache_hash === "string" &&
    row.pdf_cache_hash.length > 0
  ) {
    course.pdfCacheHash = row.pdf_cache_hash;
  }
  return courseSchema.parse(course);
}

// Structural builder interfaces to permit typed testing and real SupabaseClient
interface SelectBuilder {
  eq(column: string, value: string): FilterBuilder;
  single(): Promise<{ data: unknown; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

interface FilterBuilder {
  eq(column: string, value: string): FilterBuilder;
  single(): Promise<{ data: unknown; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

interface InsertBuilder {
  select(columns?: string): {
    single(): Promise<{ data: unknown; error: unknown }>;
  };
}

export interface CourseDatabaseClientPort {
  from(table: string): {
    select(columns?: string): SelectBuilder;
    insert(values: unknown): InsertBuilder;
  };
}

export class CourseRepository {
  private readonly client: CourseDatabaseClientPort;

  constructor(
    client: SupabaseClient | Pick<SupabaseClient, "from"> | CourseDatabaseClientPort,
  ) {
    this.client = client as unknown as CourseDatabaseClientPort;
  }

  async insertCourse(actor: ActorContext, course: Course): Promise<Course> {
    if (
      actor.role !== "teacher" ||
      !actor.teacherId ||
      course.teacherId !== actor.teacherId
    ) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only the owning teacher can create a course",
      });
    }

    let teacherCheck;
    try {
      teacherCheck = await this.client
        .from("teachers")
        .select("id")
        .eq("id", actor.teacherId)
        .eq("auth_id", actor.authId)
        .maybeSingle();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to verify teacher authorization",
        cause: err,
      });
    }

    if (teacherCheck.error) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error verifying teacher authorization",
        cause: teacherCheck.error,
      });
    }

    if (!teacherCheck.data) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Teacher authorization record not found",
      });
    }

    const insertPayload = {
      id: course.id,
      teacher_id: course.teacherId,
      name: course.name,
      description: course.description ?? null,
      join_code: course.joinCode,
      created_at: course.createdAt,
    };

    let insertResult;
    try {
      insertResult = await this.client
        .from("courses")
        .insert(insertPayload)
        .select(
          "id,teacher_id,name,description,join_code,pdf_cache_hash,created_at",
        )
        .single();
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Failed to insert course",
        cause: err,
      });
    }

    if (insertResult.error) {
      const errObj = insertResult.error as {
        code?: string;
        message?: string;
        details?: string;
      };
      if (
        errObj.code === "23505" &&
        (errObj.message?.includes("courses_join_code_key") ||
          errObj.details?.includes("courses_join_code_key") ||
          errObj.details?.includes("join_code") ||
          errObj.message?.includes("join_code"))
      ) {
        throw new JoinCodeCollisionError(errObj.message);
      }
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database error inserting course",
        cause: insertResult.error,
      });
    }

    let parsedRow: z.infer<typeof courseRowSchema>;
    try {
      parsedRow = courseRowSchema.parse(insertResult.data);
    } catch (err) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Database returned malformed course row",
        cause: err,
      });
    }

    return mapCourseRow(parsedRow);
  }

  async getCourse(actor: ActorContext, courseId: UUID): Promise<Course> {
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    if (actor.role === "student") {
      const enrollment = actor.enrolledCourses.find(
        (e) => e.courseId === courseId,
      );
      if (!enrollment) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Student is not enrolled in this course",
        });
      }

      let studentCheck;
      try {
        studentCheck = await this.client
          .from("students")
          .select("id")
          .eq("id", enrollment.studentId)
          .eq("auth_id", actor.authId)
          .eq("course_id", courseId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to verify student enrollment",
          cause: err,
        });
      }

      if (studentCheck.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error verifying student enrollment",
          cause: studentCheck.error,
        });
      }

      if (!studentCheck.data) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Student enrollment is no longer valid",
        });
      }

      let courseResult;
      try {
        courseResult = await this.client
          .from("courses")
          .select(
            "id,teacher_id,name,description,join_code,pdf_cache_hash,created_at",
          )
          .eq("id", courseId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to retrieve course",
          cause: err,
        });
      }

      if (courseResult.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error retrieving course",
          cause: courseResult.error,
        });
      }

      if (!courseResult.data) {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found",
        });
      }

      let parsed: z.infer<typeof courseRowSchema>;
      try {
        parsed = courseRowSchema.parse(courseResult.data);
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned malformed course row",
          cause: err,
        });
      }

      return mapCourseRow(parsed);
    }

    if (actor.role === "teacher") {
      if (!actor.teacherId) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher context missing teacher ID",
        });
      }

      let teacherAuthCheck;
      try {
        teacherAuthCheck = await this.client
          .from("teachers")
          .select("id")
          .eq("id", actor.teacherId)
          .eq("auth_id", actor.authId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to verify teacher authorization",
          cause: err,
        });
      }

      if (teacherAuthCheck.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error verifying teacher authorization",
          cause: teacherAuthCheck.error,
        });
      }

      if (!teacherAuthCheck.data) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher authorization record not found",
        });
      }

      let authOnlyCheck;
      try {
        authOnlyCheck = await this.client
          .from("courses")
          .select("id,teacher_id")
          .eq("id", courseId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to query course authorization",
          cause: err,
        });
      }

      if (authOnlyCheck.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error querying course authorization",
          cause: authOnlyCheck.error,
        });
      }

      if (!authOnlyCheck.data) {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found",
        });
      }

      const ownerRow = authOnlyCheck.data as {
        id: string;
        teacher_id: string;
      };
      if (ownerRow.teacher_id !== actor.teacherId) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher does not own this course",
        });
      }

      let courseData;
      try {
        courseData = await this.client
          .from("courses")
          .select(
            "id,teacher_id,name,description,join_code,pdf_cache_hash,created_at",
          )
          .eq("id", courseId)
          .eq("teacher_id", actor.teacherId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to retrieve authorized course",
          cause: err,
        });
      }

      if (courseData.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error retrieving authorized course",
          cause: courseData.error,
        });
      }

      if (!courseData.data) {
        throw new AppError({
          code: "NOT_FOUND",
          statusCode: 404,
          message: "Course not found",
        });
      }

      let parsed: z.infer<typeof courseRowSchema>;
      try {
        parsed = courseRowSchema.parse(courseData.data);
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database returned malformed course row",
          cause: err,
        });
      }

      return mapCourseRow(parsed);
    }

    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Unrecognized actor role",
    });
  }

  async listCourses(actor: ActorContext): Promise<Course[]> {
    if (actor.role === "student") {
      if (!actor.enrolledCourses || actor.enrolledCourses.length === 0) {
        return [];
      }

      const verifiedCourses: Course[] = [];
      for (const enrollment of actor.enrolledCourses) {
        let studentCheck;
        try {
          studentCheck = await this.client
            .from("students")
            .select("id")
            .eq("id", enrollment.studentId)
            .eq("auth_id", actor.authId)
            .eq("course_id", enrollment.courseId)
            .maybeSingle();
        } catch (err) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Failed to verify student enrollment",
            cause: err,
          });
        }

        if (studentCheck.error) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database error verifying student enrollment",
            cause: studentCheck.error,
          });
        }

        if (!studentCheck.data) {
          continue;
        }

        let courseResult;
        try {
          courseResult = await this.client
            .from("courses")
            .select(
              "id,teacher_id,name,description,join_code,pdf_cache_hash,created_at",
            )
            .eq("id", enrollment.courseId)
            .maybeSingle();
        } catch (err) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Failed to retrieve course",
            cause: err,
          });
        }

        if (courseResult.error) {
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Database error retrieving course",
            cause: courseResult.error,
          });
        }

        if (!courseResult.data) {
          continue;
        }

        const parsed = courseRowSchema.parse(courseResult.data);
        verifiedCourses.push(mapCourseRow(parsed));
      }

      return verifiedCourses;
    }

    if (actor.role === "teacher") {
      if (!actor.teacherId) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher context missing teacher ID",
        });
      }

      let teacherAuthCheck;
      try {
        teacherAuthCheck = await this.client
          .from("teachers")
          .select("id")
          .eq("id", actor.teacherId)
          .eq("auth_id", actor.authId)
          .maybeSingle();
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to verify teacher authorization",
          cause: err,
        });
      }

      if (teacherAuthCheck.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error verifying teacher authorization",
          cause: teacherAuthCheck.error,
        });
      }

      if (!teacherAuthCheck.data) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher authorization record not found",
        });
      }

      let coursesResult;
      try {
        coursesResult = await (this.client
          .from("courses")
          .select(
            "id,teacher_id,name,description,join_code,pdf_cache_hash,created_at",
          ) as unknown as { eq(col: string, val: string): Promise<{ data: unknown; error: unknown }> })
          .eq("teacher_id", actor.teacherId);
      } catch (err) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to retrieve courses for teacher",
          cause: err,
        });
      }

      if (coursesResult.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error retrieving courses for teacher",
          cause: coursesResult.error,
        });
      }

      if (!Array.isArray(coursesResult.data)) {
        return [];
      }

      const rows: Course[] = [];
      for (const raw of coursesResult.data) {
        const parsed = courseRowSchema.parse(raw);
        rows.push(mapCourseRow(parsed));
      }
      return rows;
    }

    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Unrecognized actor role",
    });
  }
}
