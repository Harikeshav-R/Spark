import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActorContext, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import { MessagingRepository } from "../study-groups/index.js";

export interface RoomAuthorizer {
  authorizeRoom(actor: ActorContext, room: string): Promise<void>;
}

const courseRowSchema = z.object({
  id: uuidSchema,
});

const lectureSessionRowSchema = z.object({
  id: uuidSchema,
  course_id: uuidSchema,
});

export function createRoomAuthorizer(
  databaseClient: Pick<SupabaseClient, "from">
): RoomAuthorizer {
  const messagingRepository = new MessagingRepository(databaseClient);

  async function getTeacherCourseIds(teacherId: UUID): Promise<UUID[]> {
    try {
      const { data, error } = await databaseClient
        .from("courses")
        .select("id")
        .eq("teacher_id", teacherId);

      if (error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Room authorization failed",
          cause: error,
        });
      }

      const parsed = z.array(courseRowSchema).safeParse(data);
      if (!parsed.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Room authorization failed",
          cause: parsed.error,
        });
      }

      return parsed.data.map((c) => c.id);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Room authorization failed",
        cause: err,
      });
    }
  }

  async function checkLectureSessionAccess(
    lectureId: UUID,
    permittedCourseIds: UUID[]
  ): Promise<void> {
    try {
      const { data, error } = await databaseClient
        .from("lecture_sessions")
        .select("id,course_id")
        .eq("id", lectureId)
        .in("course_id", permittedCourseIds)
        .maybeSingle();

      if (error) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Room authorization failed",
          cause: error,
        });
      }

      if (!data) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Forbidden room access",
        });
      }

      const parsed = lectureSessionRowSchema.safeParse(data);
      if (!parsed.success) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "Room authorization failed",
          cause: parsed.error,
        });
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Room authorization failed",
        cause: err,
      });
    }
  }

  return {
    async authorizeRoom(actor: ActorContext, room: string): Promise<void> {
      const parts = room.split(":");
      if (parts.length !== 2) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Forbidden room access",
        });
      }

      const [prefix, id] = parts;
      if (
        prefix !== "lecture" &&
        prefix !== "professor" &&
        prefix !== "student" &&
        prefix !== "study-group"
      ) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Forbidden room access",
        });
      }

      const parsedId = uuidSchema.safeParse(id);
      if (!parsedId.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid room identifier",
        });
      }

      const resourceId = parsedId.data;

      if (prefix === "study-group") {
        await messagingRepository.requireMatchMember(actor, resourceId);
        return;
      }

      if (prefix === "student") {
        if (actor.role !== "student") {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Forbidden room access",
          });
        }

        const isEnrolled = actor.enrolledCourses.some(
          (course) => course.studentId === resourceId
        );

        if (!isEnrolled) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Forbidden room access",
          });
        }

        return;
      }

      if (prefix === "professor") {
        if (actor.role !== "teacher" || !actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Forbidden room access",
          });
        }

        const ownedCourseIds = await getTeacherCourseIds(actor.teacherId);
        if (ownedCourseIds.length === 0) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Forbidden room access",
          });
        }

        await checkLectureSessionAccess(resourceId, ownedCourseIds);
        return;
      }

      if (prefix === "lecture") {
        let permittedCourseIds: UUID[];

        if (actor.role === "student") {
          permittedCourseIds = Array.from(
            new Set(actor.enrolledCourses.map((c) => c.courseId))
          );
        } else if (actor.role === "teacher") {
          if (!actor.teacherId) {
            throw new AppError({
              code: "FORBIDDEN",
              statusCode: 403,
              message: "Forbidden room access",
            });
          }
          permittedCourseIds = await getTeacherCourseIds(actor.teacherId);
        } else {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Forbidden room access",
          });
        }

        if (permittedCourseIds.length === 0) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Forbidden room access",
          });
        }

        await checkLectureSessionAccess(resourceId, permittedCourseIds);
        return;
      }
    },
  };
}
