import type { ActorContext, UUID } from "../../contracts/common.js";
import { uuidSchema } from "../../contracts/common.js";
import type { TimeInterval } from "../../contracts/classroom.js";
import { timeIntervalSchema } from "../../contracts/classroom.js";
import { AppError } from "../../contracts/errors.js";
import type { CourseService } from "../core/courses/course-service.js";
import type { SchedulerRepository } from "./scheduler-repository.js";

export interface AvailabilityServiceDependencies {
  courses: Pick<CourseService, "getCourse">;
  repository: Pick<SchedulerRepository, "getAvailability" | "replaceAvailability">;
}

export class AvailabilityService {
  constructor(private readonly deps: AvailabilityServiceDependencies) {}

  private async authorizeStudentAndCourse(
    actor: ActorContext,
    courseId: UUID
  ): Promise<{ studentId: UUID }> {
    if (actor.role !== "student") {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only enrolled students can manage availability",
      });
    }

    if (!uuidSchema.safeParse(courseId).success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid course ID format",
      });
    }

    const enrollment = actor.enrolledCourses.find((e) => e.courseId === courseId);
    if (!enrollment) {
      throw new AppError({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Student is not enrolled in the specified course",
      });
    }

    // Revalidate course authorization
    await this.deps.courses.getCourse(actor, courseId);

    return { studentId: enrollment.studentId };
  }

  async registerAvailability(
    actor: ActorContext,
    courseId: UUID,
    intervals: TimeInterval[]
  ): Promise<void> {
    const { studentId } = await this.authorizeStudentAndCourse(actor, courseId);

    if (!Array.isArray(intervals)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Intervals must be an array",
      });
    }

    const rpcIntervals: Array<{ start: string; end: string }> = [];
    for (const interval of intervals) {
      const parsed = timeIntervalSchema.safeParse(interval);
      if (!parsed.success) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Invalid time interval format",
          cause: parsed.error,
        });
      }

      const startMs = new Date(parsed.data.startsAt).getTime();
      const endMs = new Date(parsed.data.endsAt).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Interval timestamps must be valid ISO dates",
        });
      }

      if (endMs < startMs + 30 * 60 * 1000) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Each interval must be at least 30 minutes in duration",
        });
      }

      rpcIntervals.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      });
    }

    await this.deps.repository.replaceAvailability(
      actor.authId,
      studentId,
      courseId,
      rpcIntervals
    );
  }

  async getAvailability(
    actor: ActorContext,
    courseId: UUID
  ): Promise<TimeInterval[]> {
    const { studentId } = await this.authorizeStudentAndCourse(actor, courseId);
    return this.deps.repository.getAvailability(courseId, studentId);
  }
}
