import type { ActorContext, UUID } from "../../../contracts/common.js";
import type { CourseService } from "../../../contracts/course.js";
import { AppError } from "../../../contracts/errors.js";

export async function requireCourseTeacher(
  actor: ActorContext,
  courseId: UUID,
  courses: Pick<CourseService, "getCourse">,
  forbiddenMessage: string,
): Promise<void> {
  if (actor.role !== "teacher" || !actor.teacherId) {
    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: forbiddenMessage,
    });
  }

  const course = await courses.getCourse(actor, courseId);
  if (course.teacherId !== actor.teacherId) {
    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: forbiddenMessage,
    });
  }
}
