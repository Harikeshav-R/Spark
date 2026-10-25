import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext, UUID } from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import type { ConceptNode } from "../../../contracts/course";
import { conceptNodeSchema } from "../../../contracts/course";
import { AppError } from "../../../contracts/errors";
import type { CourseService } from "./course-service";

export interface ConceptContext {
  courseId: UUID;
  concept: ConceptNode;
  studentId: UUID | null;
}

interface ConceptNodeRow {
  id: string;
  course_id: string;
  label: string;
  description: string;
  category: string;
  difficulty: number;
  created_at: string;
}

export class ConceptContextRepository {
  constructor(
    private readonly client: SupabaseClient | Pick<SupabaseClient, "from">,
    private readonly courses: Pick<CourseService, "listCourses" | "getCourse">
  ) {}

  async resolve(actor: ActorContext, conceptId: UUID): Promise<ConceptContext> {
    const parsedId = uuidSchema.safeParse(conceptId);
    if (!parsedId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid concept ID format",
      });
    }

    // Step 1: Obtain verified authorized courses for this actor
    const authorizedCourses = await this.courses.listCourses(actor);
    if (authorizedCourses.length === 0) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Concept not found",
      });
    }

    // Step 2: Query concept_nodes constrained strictly to authorized courses
    let foundRow: ConceptNodeRow | null = null;

    for (const course of authorizedCourses) {
      let queryResult;
      try {
        queryResult = await (
          this.client.from("concept_nodes") as unknown as {
            select(cols: string): {
              eq(col: string, val: string): {
                eq(col: string, val: string): {
                  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
                };
              };
            };
          }
        )
          .select("id,course_id,label,description,category,difficulty,created_at")
          .eq("id", parsedId.data)
          .eq("course_id", course.id)
          .maybeSingle();
      } catch (err: unknown) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Failed to query concept node",
          cause: err,
        });
      }

      if (queryResult.error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Database error querying concept node",
          cause: queryResult.error,
        });
      }

      if (queryResult.data) {
        foundRow = queryResult.data as ConceptNodeRow;
        break;
      }
    }

    if (!foundRow) {
      throw new AppError({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Concept not found",
      });
    }

    const concept = conceptNodeSchema.parse({
      id: foundRow.id,
      courseId: foundRow.course_id,
      label: foundRow.label,
      description: foundRow.description,
      category: foundRow.category,
      difficulty: foundRow.difficulty,
      createdAt: new Date(foundRow.created_at).toISOString(),
    });

    // Step 3: Resolve studentId for student actors and revalidate course authorization
    let studentId: UUID | null = null;
    if (actor.role === "student") {
      const enrollment = actor.enrolledCourses.find(
        (e) => e.courseId === concept.courseId
      );
      if (!enrollment) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Student is not enrolled in the course for this concept",
        });
      }

      // Revalidate active enrollment
      await this.courses.getCourse(actor, concept.courseId);
      studentId = enrollment.studentId;
    }

    return {
      courseId: concept.courseId,
      concept,
      studentId,
    };
  }
}
