import { describe, it, expect, vi } from "vitest";
import type { Course } from "../../../src/contracts/course";
import type {
  ActorContext,
  IdGenerator,
  UUID,
} from "../../../src/contracts/common";
import { AppError } from "../../../src/contracts/errors";
import {
  CourseRepository,
  type CourseDatabaseClientPort,
  JoinCodeCollisionError,
} from "../../../src/server/core/courses/course-repository";
import { CourseService } from "../../../src/server/core/courses/course-service";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator";

describe("P1-A-02: Course Service & Repository", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const otherTeacherAuthId = "33333333-3333-4333-8333-333333333333";
  const otherTeacherId = "44444444-4444-4444-8444-444444444444";
  const studentAuthId = "55555555-5555-4555-8555-555555555555";
  const studentId = "66666666-6666-4666-8666-666666666666";
  const courseId = "77777777-7777-4777-8777-777777777777";

  const teacherActor: ActorContext = {
    userId: teacherAuthId,
    authId: teacherAuthId,
    teacherId,
    role: "teacher",
    name: "Dr. Ada",
    email: "ada@example.com",
    enrolledCourses: [],
  };

  const otherTeacherActor: ActorContext = {
    userId: otherTeacherAuthId,
    authId: otherTeacherAuthId,
    teacherId: otherTeacherId,
    role: "teacher",
    name: "Dr. Babbage",
    email: "babbage@example.com",
    enrolledCourses: [],
  };

  const enrolledStudentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Bob Student",
    email: "bob@example.com",
    enrolledCourses: [{ studentId, courseId }],
  };

  const unenrolledStudentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Bob Student",
    email: "bob@example.com",
    enrolledCourses: [],
  };

  describe("1. Teacher course creation and authorized retrieval", () => {
    it("creates course and returns same fields, omitting undefined description instead of null", async () => {
      const memoryCourses = new Map<string, Course>();

      const mockRepo = {
        insertCourse: vi.fn(async (_actor: ActorContext, course: Course) => {
          memoryCourses.set(course.id, course);
          return course;
        }),
        getCourse: vi.fn(async (_actor: ActorContext, targetId: UUID) => {
          const found = memoryCourses.get(targetId);
          if (!found) {
            throw new AppError({
              code: "NOT_FOUND",
              statusCode: 404,
              message: "Course not found",
            });
          }
          return found;
        }),
      };

      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "CS229001",
      };

      const service = new CourseService(mockRepo, mockIds);
      const created = await service.createCourse(
        teacherActor,
        "Distributed Systems",
      );

      expect(created.id).toBe(courseId);
      expect(created.teacherId).toBe(teacherId);
      expect(created.name).toBe("Distributed Systems");
      expect(created.joinCode).toBe("CS229001");
      expect(created.description).toBeUndefined();
      expect("description" in created).toBe(false);

      const retrieved = await service.getCourse(teacherActor, courseId);
      expect(retrieved).toEqual(created);
    });
  });

  describe("2. Role and actor authorization guards on creation", () => {
    it("rejects student / non-teacher creation with 403 before repository access", async () => {
      const mockRepo = {
        insertCourse: vi.fn(),
        getCourse: vi.fn(),
      };
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "CS229001",
      };

      const service = new CourseService(mockRepo, mockIds);

      await expect(
        service.createCourse(enrolledStudentActor, "Sneaky Course"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(mockRepo.insertCourse).not.toHaveBeenCalled();
    });

    it("rejects teacher creation if teacherId is missing even with role teacher", async () => {
      const brokenActor: ActorContext = {
        ...teacherActor,
        teacherId: undefined,
      };
      const mockRepo = {
        insertCourse: vi.fn(),
        getCourse: vi.fn(),
      };
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "CS229001",
      };

      const service = new CourseService(mockRepo, mockIds);
      await expect(
        service.createCourse(brokenActor, "Orphan Course"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(mockRepo.insertCourse).not.toHaveBeenCalled();
    });

    it("repository rejects creation if teacher row does not match actor.authId", async () => {
      const mockDb: CourseDatabaseClientPort = {
        from: vi.fn((table: string) => {
          if (table === "teachers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null, // No teacher row matching id and auth_id
                      error: null,
                    }),
                  }),
                }),
              }),
              insert: vi.fn(),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const repo = new CourseRepository(mockDb);
      const testCourse: Course = {
        id: courseId,
        teacherId,
        name: "Test Course",
        joinCode: "TESTCODE",
        createdAt: new Date().toISOString(),
      };

      await expect(
        repo.insertCourse(teacherActor, testCourse),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });
  });

  describe("3. Authorized retrieval access control in repository", () => {
    it("permits owning teacher and enrolled student, denies other teacher and stale student", async () => {
      const mockDb: CourseDatabaseClientPort = {
        from: vi.fn((table: string) => {
          if (table === "teachers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn((_col: string, val: string) => {
                  const isOwner = val === teacherId || val === teacherAuthId;
                  const isOther =
                    val === otherTeacherId || val === otherTeacherAuthId;
                  return {
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: isOwner || isOther ? { id: val } : null,
                        error: null,
                      }),
                    }),
                  };
                }),
              }),
              insert: vi.fn(),
            };
          }

          if (table === "students") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: studentId },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
              insert: vi.fn(),
            };
          }

          if (table === "courses") {
            const fullCourseRow = {
              id: courseId,
              teacher_id: teacherId,
              name: "Physics 101",
              description: "Mechanics",
              join_code: "PHYS1010",
              created_at: "2026-10-20T10:00:00Z",
            };
            return {
              select: vi.fn((cols?: string) => ({
                eq: vi.fn((_col1: string, val1: string) => {
                  const isFullSelect = cols?.includes("name");
                  return {
                    eq: vi.fn((_col2: string, val2: string) => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data:
                          val1 === courseId && val2 === teacherId
                            ? fullCourseRow
                            : null,
                        error: null,
                      }),
                    })),
                    maybeSingle: vi.fn().mockResolvedValue({
                      data:
                        val1 === courseId
                          ? isFullSelect
                            ? fullCourseRow
                            : { id: courseId, teacher_id: teacherId }
                          : null,
                      error: null,
                    }),
                  };
                }),
              })),
              insert: vi.fn(),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const repo = new CourseRepository(mockDb);

      // A. Owner teacher succeeds
      const resOwner = await repo.getCourse(teacherActor, courseId);
      expect(resOwner.id).toBe(courseId);

      // B. Enrolled student succeeds
      const resStudent = await repo.getCourse(enrolledStudentActor, courseId);
      expect(resStudent.id).toBe(courseId);

      // C. Other teacher gets 403
      await expect(
        repo.getCourse(otherTeacherActor, courseId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // D. Unenrolled student gets 403
      await expect(
        repo.getCourse(unenrolledStudentActor, courseId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // E. Nonexistent course gets 404
      const missingCourseId = "88888888-8888-4888-8888-888888888888";
      await expect(
        repo.getCourse(teacherActor, missingCourseId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });
  });

  describe("4. Input validation and database failure handling", () => {
    it("rejects empty name or >255 chars with 400 before mutation", async () => {
      const mockRepo = {
        insertCourse: vi.fn(),
        getCourse: vi.fn(),
      };
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "CS229001",
      };

      const service = new CourseService(mockRepo, mockIds);

      await expect(
        service.createCourse(teacherActor, ""),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        service.createCourse(teacherActor, "a".repeat(256)),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.insertCourse).not.toHaveBeenCalled();
    });

    it("rejects malformed course UUID with 400", async () => {
      const mockRepo = {
        insertCourse: vi.fn(),
        getCourse: vi.fn(),
      };
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "CS229001",
      };

      const service = new CourseService(mockRepo, mockIds);

      await expect(
        service.getCourse(teacherActor, "not-a-valid-uuid"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.getCourse).not.toHaveBeenCalled();
    });

    it("maps database failure to 500 without masking as not found", async () => {
      const mockDb: CourseDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "57014", message: "query_canceled" },
                }),
              }),
            }),
          }),
        }),
      };

      const repo = new CourseRepository(mockDb);
      await expect(repo.getCourse(teacherActor, courseId)).rejects.toMatchObject(
        {
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
        },
      );
    });
  });

  describe("5. Join code collision recovery", () => {
    it("recovers on collision: regenerates join code and succeeds with second code", async () => {
      const generatedCodes = ["COLLIDE1", "SUCCESS2"];
      let codeIdx = 0;
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => generatedCodes[codeIdx++],
      };

      let insertAttempts = 0;
      const mockRepo = {
        insertCourse: vi.fn(async (_actor: ActorContext, course: Course) => {
          insertAttempts++;
          if (course.joinCode === "COLLIDE1") {
            throw new JoinCodeCollisionError("courses_join_code_key collision");
          }
          return course;
        }),
        getCourse: vi.fn(),
      };

      const service = new CourseService(mockRepo, mockIds);
      const result = await service.createCourse(teacherActor, "Calculus 1");

      expect(insertAttempts).toBe(2);
      expect(result.joinCode).toBe("SUCCESS2");
      expect(result.id).toBe(courseId); // ID retained across attempts
    });

    it("throws 409 CONFLICT after 5 consecutive join code collisions", async () => {
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "COLLIDE0",
      };

      let attempts = 0;
      const mockRepo = {
        insertCourse: vi.fn(async () => {
          attempts++;
          throw new JoinCodeCollisionError("courses_join_code_key collision");
        }),
        getCourse: vi.fn(),
      };

      const service = new CourseService(mockRepo, mockIds);
      await expect(
        service.createCourse(teacherActor, "Linear Algebra"),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
        message: "Unable to allocate a unique course join code",
      });

      expect(attempts).toBe(5);
    });

    it("does not retry other database errors", async () => {
      const mockIds: IdGenerator = {
        generateId: () => courseId,
        generateJoinCode: () => "ANYCODE1",
      };

      let attempts = 0;
      const mockRepo = {
        insertCourse: vi.fn(async () => {
          attempts++;
          throw new AppError({
            code: "INTERNAL_SERVER_ERROR",
            statusCode: 500,
            message: "Disk full",
          });
        }),
        getCourse: vi.fn(),
      };

      const service = new CourseService(mockRepo, mockIds);
      await expect(
        service.createCourse(teacherActor, "Algorithms"),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
      });

      expect(attempts).toBe(1);
    });
  });

  describe("6. CryptoIdGenerator format verification", () => {
    it("generates UUIDs and 8-character uppercase alphanumeric codes", () => {
      const generator = new CryptoIdGenerator();

      for (let i = 0; i < 50; i++) {
        const id = generator.generateId();
        expect(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id,
          ),
        ).toBe(true);

        const code = generator.generateJoinCode();
        expect(code).toHaveLength(8);
        expect(/^[A-Z0-9]{8}$/.test(code)).toBe(true);
      }
    });
  });
});
