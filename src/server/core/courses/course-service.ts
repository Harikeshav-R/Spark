import { z } from "zod";
import type {
  CourseService as CourseServicePort,
  Course,
} from "../../../contracts/course";
import type {
  ActorContext,
  IdGenerator,
  UUID,
} from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";
import {
  type CourseRepository,
  JoinCodeCollisionError,
} from "./course-repository";

const courseNameSchema = z.string().min(1).max(255);
const courseDescriptionSchema = z.string().optional();

export class CourseService
  implements Pick<CourseServicePort, "createCourse" | "getCourse">
{
  constructor(
    private readonly repository: Pick<
      CourseRepository,
      "insertCourse" | "getCourse"
    >,
    private readonly ids: IdGenerator,
  ) {}

  async createCourse(
    actor: ActorContext,
    name: string,
    description?: string,
  ): Promise<Course> {
    if (actor.role !== "teacher" || !actor.teacherId) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can create courses",
      });
    }

    const nameParsed = courseNameSchema.safeParse(name);
    if (!nameParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Course name must be between 1 and 255 characters",
      });
    }

    const descParsed = courseDescriptionSchema.safeParse(description);
    if (!descParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Course description must be a string if provided",
      });
    }

    const courseId = this.ids.generateId();
    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "IdGenerator produced invalid UUID",
      });
    }

    const createdAt = new Date().toISOString();

    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      const joinCode = this.ids.generateJoinCode();
      if (!/^[A-Z0-9]{8}$/.test(joinCode)) {
        throw new AppError({
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          message: "IdGenerator produced invalid join code format",
        });
      }

      const candidateCourse: Course = {
        id: courseId,
        teacherId: actor.teacherId,
        name: nameParsed.data,
        createdAt,
        joinCode,
      };
      if (descParsed.data !== undefined) {
        candidateCourse.description = descParsed.data;
      }

      try {
        return await this.repository.insertCourse(actor, candidateCourse);
      } catch (err) {
        if (err instanceof JoinCodeCollisionError) {
          if (attempts >= MAX_ATTEMPTS) {
            throw new AppError({
              code: "CONFLICT",
              statusCode: 409,
              message: "Unable to allocate a unique course join code",
              cause: err,
            });
          }
          continue;
        }
        throw err;
      }
    }

    throw new AppError({
      code: "CONFLICT",
      statusCode: 409,
      message: "Unable to allocate a unique course join code",
    });
  }

  async getCourse(actor: ActorContext, courseId: UUID): Promise<Course> {
    const parsedId = uuidSchema.safeParse(courseId);
    if (!parsedId.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    return this.repository.getCourse(actor, parsedId.data);
  }
}
