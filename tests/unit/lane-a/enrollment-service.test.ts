import { describe, it, expect, vi } from "vitest";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service";
import type { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository";
import type { ActorContext, Student } from "../../../src/contracts";
import { AppError } from "../../../src/contracts/errors";

describe("EnrollmentService", () => {
  const validStudentActor: ActorContext = {
    userId: "00000000-0000-4000-8000-000000000001",
    authId: "00000000-0000-4000-8000-000000000001",
    email: "student@example.com",
    name: "Ada Lovelace",
    role: "student",
    enrolledCourses: [],
  };

  const validStudent: Student = {
    id: "00000000-0000-4000-8000-000000000010",
    authId: validStudentActor.authId,
    courseId: "00000000-0000-4000-8000-000000000100",
    name: "Ada Lovelace",
    email: "student@example.com",
    createdAt: "2026-10-21T00:00:00.000Z",
  };

  it("rejects non-student actors with 403 FORBIDDEN", async () => {
    const mockRepo: Pick<EnrollmentRepository, "enrollStudent"> = {
      enrollStudent: vi.fn(),
    };
    const service = new EnrollmentService(mockRepo);

    const teacherActor: ActorContext = {
      userId: "00000000-0000-4000-8000-000000000002",
      authId: "00000000-0000-4000-8000-000000000002",
      email: "teacher@example.com",
      name: "Prof Babbage",
      role: "teacher",
      teacherId: "00000000-0000-4000-8000-000000000020",
      enrolledCourses: [],
    };

    await expect(
      service.enrollStudent(teacherActor, "JOIN1234"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });

    expect(mockRepo.enrollStudent).not.toHaveBeenCalled();
  });

  it.each([
    ["lowercase", "join1234"],
    ["too short", "JOIN123"],
    ["too long", "JOIN12345"],
    ["whitespace prefix", " JOIN123"],
    ["whitespace suffix", "JOIN123 "],
    ["whitespace inside", "JOIN 123"],
    ["hyphen", "JOIN-123"],
    ["empty string", ""],
    ["special characters", "JOIN!@#$"],
  ])("rejects malformed join code '%s' with 400 VALIDATION_ERROR without repo call", async (_, code) => {
    const mockRepo: Pick<EnrollmentRepository, "enrollStudent"> = {
      enrollStudent: vi.fn(),
    };
    const service = new EnrollmentService(mockRepo);

    await expect(
      service.enrollStudent(validStudentActor, code),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });

    expect(mockRepo.enrollStudent).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invalid authId",
      { ...validStudentActor, authId: "not-a-uuid" as unknown as ActorContext["authId"] },
    ],
    [
      "empty name",
      { ...validStudentActor, name: "" },
    ],
    [
      "invalid email",
      { ...validStudentActor, email: "invalid-email" },
    ],
  ])("rejects malformed actor context '%s' with 400 VALIDATION_ERROR without repo call", async (_, badActor) => {
    const mockRepo: Pick<EnrollmentRepository, "enrollStudent"> = {
      enrollStudent: vi.fn(),
    };
    const service = new EnrollmentService(mockRepo);

    await expect(
      service.enrollStudent(badActor, "JOIN1234"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });

    expect(mockRepo.enrollStudent).not.toHaveBeenCalled();
  });

  it("delegates to repository and returns student for valid input", async () => {
    const mockRepo: Pick<EnrollmentRepository, "enrollStudent"> = {
      enrollStudent: vi.fn().mockResolvedValue(validStudent),
    };
    const service = new EnrollmentService(mockRepo);

    const result = await service.enrollStudent(validStudentActor, "JOIN1234");
    expect(result).toEqual(validStudent);
    expect(mockRepo.enrollStudent).toHaveBeenCalledWith(validStudentActor, "JOIN1234");
  });

  it("propagates repository AppError", async () => {
    const notFoundError = new AppError({
      code: "NOT_FOUND",
      statusCode: 404,
      message: "Course not found for join code",
    });
    const mockRepo: Pick<EnrollmentRepository, "enrollStudent"> = {
      enrollStudent: vi.fn().mockRejectedValue(notFoundError),
    };
    const service = new EnrollmentService(mockRepo);

    await expect(
      service.enrollStudent(validStudentActor, "JOIN1234"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });
});
