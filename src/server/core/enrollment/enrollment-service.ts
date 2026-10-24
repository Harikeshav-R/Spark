import { z } from "zod";
import type {
  CourseService as CourseServicePort,
  Student,
} from "../../../contracts/course";
import type { ActorContext } from "../../../contracts/common";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";
import type { EnrollmentRepository } from "./enrollment-repository";

const joinCodeRegex = /^[A-Z0-9]{8}$/;

const actorContextValidationSchema = z.object({
  authId: uuidSchema,
  name: z.string().min(1),
  email: z.email(),
});

export class EnrollmentService
  implements Pick<CourseServicePort, "enrollStudent">
{
  constructor(
    private readonly repository: Pick<EnrollmentRepository, "enrollStudent">,
  ) {}

  async enrollStudent(
    actor: ActorContext,
    joinCode: string,
  ): Promise<Student> {
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only students can enroll in courses",
      });
    }

    if (typeof joinCode !== "string" || !joinCodeRegex.test(joinCode)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Join code must be an 8-character uppercase alphanumeric string",
      });
    }

    const actorParsed = actorContextValidationSchema.safeParse({
      authId: actor.authId,
      name: actor.name,
      email: actor.email,
    });

    if (!actorParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid student actor context",
        cause: actorParsed.error,
      });
    }

    return this.repository.enrollStudent(actor, joinCode);
  }
}
