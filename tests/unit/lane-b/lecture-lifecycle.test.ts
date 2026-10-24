import { describe, it, expect, vi } from "vitest";
import type { LectureSession } from "../../../src/contracts/classroom.js";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../../src/contracts/common.js";
import { AppError } from "../../../src/contracts/errors.js";
import {
  LectureRepository,
  type LectureDatabaseClientPort,
} from "../../../src/server/classroom/lecture-repository.js";
import { LectureService } from "../../../src/server/classroom/lecture-service.js";

describe("P1-B-01: Lecture Session Lifecycle & State Machine", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const studentAuthId = "33333333-3333-4333-8333-333333333333";
  const studentId = "44444444-4444-4444-8444-444444444444";
  const courseId = "55555555-5555-4555-8555-555555555555";
  const lectureId = "66666666-6666-4666-8666-666666666666";

  const teacherActor: ActorContext = {
    userId: teacherAuthId,
    authId: teacherAuthId,
    teacherId,
    role: "teacher",
    name: "Prof. Alan Turing",
    email: "turing@example.edu",
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Grace Hopper",
    email: "hopper@example.edu",
    enrolledCourses: [{ studentId, courseId }],
  };

  const startTime = "2026-10-20T14:00:00.000Z";
  const endTime = "2026-10-20T15:30:00.000Z";

  const mockClock: Clock = {
    now: () => new Date(startTime),
    nowISO: () => startTime,
  };

  const mockIds: IdGenerator = {
    generateId: () => lectureId,
    generateJoinCode: () => "LEC001",
  };

  describe("LectureService state machine & lifecycle", () => {
    it("Teacher starts lecture in live state with timestamp", async () => {
      const memoryLectures = new Map<string, LectureSession>();

      const mockRepo = {
        insertLecture: vi.fn(async (lecture: LectureSession) => {
          memoryLectures.set(lecture.id, lecture);
          return lecture;
        }),
        getLecture: vi.fn(async (id: UUID) => {
          const found = memoryLectures.get(id);
          if (!found) {
            throw new AppError({
              code: "NOT_FOUND",
              statusCode: 404,
              message: "Lecture session not found",
            });
          }
          return found;
        }),
        updateLectureStatus: vi.fn(
          async (id: UUID, status: "live" | "completed", endedAt?: string) => {
            const found = memoryLectures.get(id);
            if (!found) {
              throw new AppError({
                code: "NOT_FOUND",
                statusCode: 404,
                message: "Lecture session not found",
              });
            }
            const updated: LectureSession = {
              ...found,
              status,
              ...(endedAt ? { endedAt } : {}),
            };
            memoryLectures.set(id, updated);
            return updated;
          },
        ),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      const created = await service.startLecture(
        teacherActor,
        courseId,
        "Introduction to Quantum Algorithms",
      );

      expect(created.id).toBe(lectureId);
      expect(created.courseId).toBe(courseId);
      expect(created.title).toBe("Introduction to Quantum Algorithms");
      expect(created.status).toBe("live");
      expect(created.startedAt).toBe(startTime);
      expect(created.endedAt).toBeUndefined();
      expect(mockRepo.insertLecture).toHaveBeenCalledTimes(1);
    });

    it("Teacher ends live lecture → completed with endedAt timestamp", async () => {
      const liveLecture: LectureSession = {
        id: lectureId,
        courseId,
        title: "Introduction to Quantum Algorithms",
        status: "live",
        startedAt: startTime,
      };

      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(async () => liveLecture),
        updateLectureStatus: vi.fn(
          async (id: UUID, status: "live" | "completed", endedAt?: string) => ({
            ...liveLecture,
            id,
            status,
            endedAt,
          }),
        ),
      };

      const endClock: Clock = {
        now: () => new Date(endTime),
        nowISO: () => endTime,
      };

      const service = new LectureService(mockRepo, mockIds, endClock);

      const completed = await service.endLecture(teacherActor, lectureId);

      expect(completed.id).toBe(lectureId);
      expect(completed.status).toBe("completed");
      expect(completed.endedAt).toBe(endTime);
      expect(mockRepo.updateLectureStatus).toHaveBeenCalledWith(
        lectureId,
        "completed",
        endTime,
      );
    });

    it("Ending already-completed lecture returns 409 CONFLICT", async () => {
      const completedLecture: LectureSession = {
        id: lectureId,
        courseId,
        title: "Introduction to Quantum Algorithms",
        status: "completed",
        startedAt: startTime,
        endedAt: endTime,
      };

      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(async () => completedLecture),
        updateLectureStatus: vi.fn(),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      await expect(
        service.endLecture(teacherActor, lectureId),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
        message: "Lecture session is already completed",
      });

      expect(mockRepo.updateLectureStatus).not.toHaveBeenCalled();
    });

    it("Student cannot start lecture (403 FORBIDDEN)", async () => {
      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(),
        updateLectureStatus: vi.fn(),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      await expect(
        service.startLecture(studentActor, courseId, "Student Session"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can start lectures",
      });

      expect(mockRepo.insertLecture).not.toHaveBeenCalled();
    });

    it("Student cannot end lecture (403 FORBIDDEN)", async () => {
      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(),
        updateLectureStatus: vi.fn(),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      await expect(
        service.endLecture(studentActor, lectureId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Only teachers can end lectures",
      });

      expect(mockRepo.updateLectureStatus).not.toHaveBeenCalled();
    });

    it("Invalid courseId rejected (400 VALIDATION_ERROR)", async () => {
      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(),
        updateLectureStatus: vi.fn(),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      await expect(
        service.startLecture(teacherActor, "not-a-uuid", "Invalid Course"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.insertLecture).not.toHaveBeenCalled();
    });

    it("Invalid lectureId rejected (400 VALIDATION_ERROR)", async () => {
      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(),
        updateLectureStatus: vi.fn(),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      await expect(
        service.endLecture(teacherActor, "not-a-uuid"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.getLecture).not.toHaveBeenCalled();
    });

    it("Empty title rejected (400 VALIDATION_ERROR)", async () => {
      const mockRepo = {
        insertLecture: vi.fn(),
        getLecture: vi.fn(),
        updateLectureStatus: vi.fn(),
      };

      const service = new LectureService(mockRepo, mockIds, mockClock);

      await expect(
        service.startLecture(teacherActor, courseId, ""),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      await expect(
        service.startLecture(teacherActor, courseId, "   "),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      expect(mockRepo.insertLecture).not.toHaveBeenCalled();
    });
  });

  describe("LectureRepository database interaction", () => {
    it("insertLecture maps row correctly from database client", async () => {
      const mockClient: LectureDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: lectureId,
                  course_id: courseId,
                  title: "Sample Lecture",
                  status: "live",
                  started_at: startTime,
                  ended_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      };

      const repository = new LectureRepository(mockClient);
      const inserted = await repository.insertLecture({
        id: lectureId,
        courseId,
        title: "Sample Lecture",
        status: "live",
        startedAt: startTime,
      });

      expect(inserted.id).toBe(lectureId);
      expect(inserted.courseId).toBe(courseId);
      expect(inserted.title).toBe("Sample Lecture");
      expect(inserted.status).toBe("live");
      expect(inserted.startedAt).toBe(startTime);
      expect(inserted.endedAt).toBeUndefined();
    });

    it("getLecture throws 404 when lecture not found", async () => {
      const mockClient: LectureDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      };

      const repository = new LectureRepository(mockClient);

      await expect(repository.getLecture(lectureId)).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });

    it("updateLectureStatus updates status and endedAt", async () => {
      const mockClient: LectureDatabaseClientPort = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: lectureId,
                    course_id: courseId,
                    title: "Sample Lecture",
                    status: "completed",
                    started_at: startTime,
                    ended_at: endTime,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      const repository = new LectureRepository(mockClient);
      const updated = await repository.updateLectureStatus(
        lectureId,
        "completed",
        endTime,
      );

      expect(updated.status).toBe("completed");
      expect(updated.endedAt).toBe(endTime);
    });
  });
});
