import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service.js";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository.js";
import { CourseService } from "../../../src/server/core/courses/course-service.js";
import { CourseRepository } from "../../../src/server/core/courses/course-repository.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import {
  SchedulerRepository,
  AvailabilityService,
} from "../../../src/server/study-groups/index.js";
import type { ActorContext } from "../../../src/contracts/common.js";
import type { TimeInterval } from "../../../src/contracts/classroom.js";
import { AppError } from "../../../src/contracts/errors.js";

describe("AvailabilityService Unit & Domain Invariants", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const studentAuthId = "22222222-2222-4222-8222-222222222222";
  const studentId = "33333333-3333-4333-8333-333333333333";
  const courseId = "44444444-4444-4444-8444-444444444444";

  const studentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Alice",
    email: "alice@example.com",
    enrolledCourses: [{ studentId, courseId }],
  };

  const teacherActor: ActorContext = {
    userId: teacherAuthId,
    authId: teacherAuthId,
    role: "teacher",
    name: "Dr. Smith",
    email: "smith@example.com",
    enrolledCourses: [],
  };

  it("rejects non-student actor with 403 FORBIDDEN", async () => {
    const mockRepo = {
      getAvailability: vi.fn(),
      replaceAvailability: vi.fn(),
    };
    const mockCourses = {
      getCourse: vi.fn(),
    };
    const service = new AvailabilityService({
      courses: mockCourses,
      repository: mockRepo,
    });

    await expect(
      service.registerAvailability(teacherActor, courseId, [])
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("rejects intervals shorter than 30 minutes with 400 VALIDATION_ERROR", async () => {
    const mockRepo = {
      getAvailability: vi.fn(),
      replaceAvailability: vi.fn(),
    };
    const mockCourses = {
      getCourse: vi.fn().mockResolvedValue({ id: courseId }),
    };
    const service = new AvailabilityService({
      courses: mockCourses,
      repository: mockRepo,
    });

    const shortInterval: TimeInterval = {
      startsAt: "2026-10-25T14:00:00.000Z",
      endsAt: "2026-10-25T14:15:00.000Z", // 15 mins < 30 mins
    };

    await expect(
      service.registerAvailability(studentActor, courseId, [shortInterval])
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
    expect(mockRepo.replaceAvailability).not.toHaveBeenCalled();
  });

  it("successfully passes valid intervals formatted to UTC ISO strings to repository", async () => {
    const mockRepo = {
      getAvailability: vi.fn(),
      replaceAvailability: vi.fn().mockResolvedValue(undefined),
    };
    const mockCourses = {
      getCourse: vi.fn().mockResolvedValue({ id: courseId }),
    };
    const service = new AvailabilityService({
      courses: mockCourses,
      repository: mockRepo,
    });

    const validIntervals: TimeInterval[] = [
      {
        startsAt: "2026-10-25T14:00:00.000Z",
        endsAt: "2026-10-25T15:00:00.000Z",
      },
      {
        startsAt: "2026-10-25T16:00:00.000Z",
        endsAt: "2026-10-25T17:30:00.000Z",
      },
    ];

    await service.registerAvailability(studentActor, courseId, validIntervals);

    expect(mockRepo.replaceAvailability).toHaveBeenCalledWith(
      studentAuthId,
      studentId,
      courseId,
      [
        { start: "2026-10-25T14:00:00.000Z", end: "2026-10-25T15:00:00.000Z" },
        { start: "2026-10-25T16:00:00.000Z", end: "2026-10-25T17:30:00.000Z" },
      ]
    );
  });
});

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P6-B-03: Availability Persistence & RPC Integration (Local PostgreSQL)",
  () => {
    let harness: SupabaseTestHarness;
    let context: TestContext;
    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let schedulerRepo: SchedulerRepository;
    let availabilityService: AvailabilityService;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const idGen = new CryptoIdGenerator();
      enrollmentService = new EnrollmentService(
        new EnrollmentRepository(harness.serviceClient)
      );
      courseService = new CourseService(
        new CourseRepository(harness.serviceClient),
        idGen
      );
      schedulerRepo = new SchedulerRepository(harness.serviceClient);
      availabilityService = new AvailabilityService({
        courses: courseService,
        repository: schedulerRepo,
      });
    });

    afterEach(async () => {
      if (context) {
        await harness.cleanup(context);
      }
    });

    it("atomically replaces student availability and rejects invalid intervals without mutating state", async () => {
      context = { users: [], teacherIds: [], courseIds: [] };
      const courseContext = await harness.createTestCourse(context);
      const studentUser = await harness.createTestUser(context, "student");
      const enrolled = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        courseContext.joinCode
      );

      const actor: ActorContext = harness.buildStudentActor(studentUser, [
        { studentId: enrolled.id, courseId: courseContext.courseId },
      ]);

      // 1. Initial write
      const initialIntervals: TimeInterval[] = [
        {
          startsAt: "2026-10-25T14:00:00.000Z",
          endsAt: "2026-10-25T15:00:00.000Z",
        },
      ];
      await availabilityService.registerAvailability(
        actor,
        courseContext.courseId,
        initialIntervals
      );

      let saved = await availabilityService.getAvailability(
        actor,
        courseContext.courseId
      );
      expect(saved).toHaveLength(1);
      expect(saved[0].startsAt).toBe("2026-10-25T14:00:00.000Z");

      // 2. Second valid write replaces the first atomically
      const updatedIntervals: TimeInterval[] = [
        {
          startsAt: "2026-10-26T10:00:00.000Z",
          endsAt: "2026-10-26T11:00:00.000Z",
        },
        {
          startsAt: "2026-10-26T14:00:00.000Z",
          endsAt: "2026-10-26T15:00:00.000Z",
        },
      ];
      await availabilityService.registerAvailability(
        actor,
        courseContext.courseId,
        updatedIntervals
      );

      saved = await availabilityService.getAvailability(
        actor,
        courseContext.courseId
      );
      expect(saved).toHaveLength(2);

      // 3. Invalid write (<30m) fails and preserves previous intervals
      const invalidIntervals: TimeInterval[] = [
        {
          startsAt: "2026-10-27T10:00:00.000Z",
          endsAt: "2026-10-27T10:15:00.000Z",
        },
      ];
      await expect(
        availabilityService.registerAvailability(
          actor,
          courseContext.courseId,
          invalidIntervals
        )
      ).rejects.toBeInstanceOf(AppError);

      const preserved = await availabilityService.getAvailability(
        actor,
        courseContext.courseId
      );
      expect(preserved).toHaveLength(2);
    });
  }
);
