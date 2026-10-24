import type {
  ActorContext,
  MasteryBand,
  MasteryEvidence,
  MasteryService as MasteryServicePort,
  StudentMastery,
  UUID,
} from "../../../contracts";
import { masteryEvidenceSchema } from "../../../contracts/mastery";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";
import type { MasteryRepository } from "./mastery-repository";

export class MasteryService
  implements
    Pick<
      MasteryServicePort,
      "getMastery" | "applyEvidence" | "initializeStudentMastery"
    >
{
  constructor(
    private readonly repository: Pick<
      MasteryRepository,
      "getMastery" | "applyEvidence" | "initializeStudentMastery"
    >,
  ) {}

  private checkActorAuthorization(actor: ActorContext, studentId: UUID): void {
    if (actor.role === "student") {
      const isEnrolled =
        Array.isArray(actor.enrolledCourses) &&
        actor.enrolledCourses.some((e) => e.studentId === studentId);
      if (!isEnrolled) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Student is not authorized to access mastery for this student ID",
        });
      }
      return;
    }

    if (actor.role === "teacher") {
      if (!actor.teacherId) {
        throw new AppError({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Teacher actor missing teacherId authorization",
        });
      }
      return;
    }

    throw new AppError({
      code: "FORBIDDEN",
      statusCode: 403,
      message: "Actor role is not authorized to access mastery",
    });
  }

  async getMastery(actor: ActorContext, studentId: UUID): Promise<StudentMastery[]> {
    const studentIdParsed = uuidSchema.safeParse(studentId);
    if (!studentIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid studentId format",
        cause: studentIdParsed.error,
      });
    }

    this.checkActorAuthorization(actor, studentId);

    return this.repository.getMastery(actor, studentId);
  }

  async applyEvidence(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    evidence: MasteryEvidence,
  ): Promise<{ confidence: number; band: MasteryBand; attempts: number; version: number }> {
    const studentIdParsed = uuidSchema.safeParse(studentId);
    if (!studentIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid studentId format",
        cause: studentIdParsed.error,
      });
    }

    const conceptIdParsed = uuidSchema.safeParse(conceptId);
    if (!conceptIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid conceptId format",
        cause: conceptIdParsed.error,
      });
    }

    const evidenceParsed = masteryEvidenceSchema.safeParse(evidence);
    if (!evidenceParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid mastery evidence format",
        cause: evidenceParsed.error,
      });
    }

    this.checkActorAuthorization(actor, studentId);

    return this.repository.applyEvidence(actor, studentId, conceptId, evidenceParsed.data);
  }

  async initializeStudentMastery(studentId: UUID, courseId: UUID): Promise<number> {
    const studentIdParsed = uuidSchema.safeParse(studentId);
    if (!studentIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid studentId format",
        cause: studentIdParsed.error,
      });
    }

    const courseIdParsed = uuidSchema.safeParse(courseId);
    if (!courseIdParsed.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid courseId format",
        cause: courseIdParsed.error,
      });
    }

    return this.repository.initializeStudentMastery(studentId, courseId);
  }
}
