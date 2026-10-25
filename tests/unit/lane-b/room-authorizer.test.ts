import { describe, it, expect, vi } from "vitest";
import type { ActorContext } from "../../../src/contracts/common.js";
import { createRoomAuthorizer } from "../../../src/server/realtime/room-authorizer.js";
import { createFixtureSupabaseClient } from "../../integration/lane-b/helpers/socket-fixture.js";

describe("P3-B-01: RoomAuthorizer", () => {
  const teacherAuthId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const studentAuthId = "33333333-3333-4333-8333-333333333333";
  const studentId1 = "44444444-4444-4444-8444-444444444441";
  const studentId2 = "44444444-4444-4444-8444-444444444442";
  const courseId1 = "55555555-5555-4555-8555-555555555551";
  const courseId2 = "55555555-5555-4555-8555-555555555552";
  const unownedCourseId = "55555555-5555-4555-8555-555555555559";
  const lectureId1 = "66666666-6666-4666-8666-666666666661";
  const lectureIdUnowned = "66666666-6666-4666-8666-666666666669";
  const matchId1 = "77777777-7777-4777-8777-777777777771";
  const studentId3 = "44444444-4444-4444-8444-444444444443";
  const studentId4 = "44444444-4444-4444-8444-444444444444";
  const studentAuthId4 = "33333333-3333-4333-8333-333333333334";

  const teacherActor: ActorContext = {
    userId: teacherAuthId,
    authId: teacherAuthId,
    teacherId,
    role: "teacher",
    name: "Prof. Ada Lovelace",
    email: "lovelace@example.edu",
    enrolledCourses: [],
  };

  const studentActor: ActorContext = {
    userId: studentAuthId,
    authId: studentAuthId,
    role: "student",
    name: "Alan Turing",
    email: "turing@example.edu",
    enrolledCourses: [
      { studentId: studentId1, courseId: courseId1 },
      { studentId: studentId2, courseId: courseId2 },
    ],
  };

  type DatabaseClient = Parameters<typeof createRoomAuthorizer>[0];

  function createMockDb(options?: {
    teacherCourses?: Array<{ id: string }>;
    lectureSessions?: Array<{ id: string; course_id: string }>;
    coursesError?: { message: string };
    lectureError?: { message: string };
    throwOnCourses?: boolean;
    throwOnLectures?: boolean;
    malformedCourseRow?: unknown;
    malformedLectureRow?: unknown;
  }): DatabaseClient {
    const fromFn = vi.fn((table: string) => {
      if (table === "courses") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, _val: string) => {
              if (options?.throwOnCourses) {
                throw new Error("Network timeout connecting to database");
              }
              if (options?.coursesError) {
                return Promise.resolve({ data: null, error: options.coursesError });
              }
              if (options?.malformedCourseRow) {
                return Promise.resolve({
                  data: [options.malformedCourseRow],
                  error: null,
                });
              }
              const courses = options?.teacherCourses ?? [{ id: courseId1 }, { id: courseId2 }];
              return Promise.resolve({ data: courses, error: null });
            }),
          }),
        };
      }

      if (table === "lecture_sessions") {
        const maybeSingleFn = vi.fn().mockImplementation(() => {
          if (options?.throwOnLectures) {
            throw new Error("Network timeout querying lecture session");
          }
          if (options?.lectureError) {
            return Promise.resolve({ data: null, error: options.lectureError });
          }
          if (options?.malformedLectureRow) {
            return Promise.resolve({
              data: options.malformedLectureRow,
              error: null,
            });
          }
          const sessions = options?.lectureSessions ?? [
            { id: lectureId1, course_id: courseId1 },
          ];
          const found = sessions.find(
            (s) => s.id === capturedLectureId && capturedPermittedCourseIds.includes(s.course_id)
          );
          return Promise.resolve({ data: found ?? null, error: null });
        });

        let capturedLectureId = "";
        let capturedPermittedCourseIds: string[] = [];

        const inFn = vi.fn().mockImplementation((_col: string, permittedCourseIds: string[]) => {
          capturedPermittedCourseIds = permittedCourseIds;
          return { maybeSingle: maybeSingleFn };
        });

        const eqFn = vi.fn().mockImplementation((_col: string, lId: string) => {
          capturedLectureId = lId;
          return { in: inFn };
        });

        return {
          select: vi.fn().mockReturnValue({ eq: eqFn }),
        };
      }

      throw new Error(`Unexpected table queried: ${table}`);
    });

    return { from: fromFn as unknown as DatabaseClient["from"] };
  }

  describe("Room identifier parsing and validation", () => {
    it("rejects malformed UUID in recognized prefix with VALIDATION_ERROR (400)", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, "student:not-a-valid-uuid")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid room identifier",
      });

      await expect(
        authorizer.authorizeRoom(studentActor, "lecture:12345")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid room identifier",
      });

      await expect(
        authorizer.authorizeRoom(teacherActor, "professor:bad-uuid")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid room identifier",
      });

      await expect(
        authorizer.authorizeRoom(studentActor, "study-group:not-a-valid-uuid")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Invalid room identifier",
      });

      expect(db.from).not.toHaveBeenCalled();
    });

    it("rejects unknown prefixes, empty string, and extra segments with FORBIDDEN (403)", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      const invalidRooms = [
        "",
        "unknown:" + lectureId1,
        `lecture:${lectureId1}:extra`,
        `student:${studentId1}:child`,
        "random-room",
        "lecture",
      ];

      for (const room of invalidRooms) {
        await expect(authorizer.authorizeRoom(studentActor, room)).rejects.toMatchObject({
          code: "FORBIDDEN",
          statusCode: 403,
          message: "Forbidden room access",
        });
      }

      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe("student:<studentId> authorization", () => {
    it("allows student to join their own enrolled student room without querying database", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, `student:${studentId1}`)
      ).resolves.toBeUndefined();

      await expect(
        authorizer.authorizeRoom(studentActor, `student:${studentId2}`)
      ).resolves.toBeUndefined();

      expect(db.from).not.toHaveBeenCalled();
    });

    it("denies student attempting to join another student room with FORBIDDEN (403)", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      const otherStudentId = "99999999-9999-4999-8999-999999999999";
      await expect(
        authorizer.authorizeRoom(studentActor, `student:${otherStudentId}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).not.toHaveBeenCalled();
    });

    it("denies student using authId instead of studentId with FORBIDDEN (403)", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, `student:${studentAuthId}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).not.toHaveBeenCalled();
    });

    it("denies teacher attempting to join student room with FORBIDDEN (403)", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `student:${studentId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe("professor:<lectureId> authorization", () => {
    it("denies non-teacher actor before querying resources", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, `professor:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).not.toHaveBeenCalled();
    });

    it("denies teacher actor without teacherId before querying resources", async () => {
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      const missingTeacherIdActor: ActorContext = {
        ...teacherActor,
        teacherId: undefined,
      };

      await expect(
        authorizer.authorizeRoom(missingTeacherIdActor, `professor:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).not.toHaveBeenCalled();
    });

    it("denies teacher with no owned courses without querying lecture_sessions", async () => {
      const db = createMockDb({ teacherCourses: [] });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `professor:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).toHaveBeenCalledWith("courses");
      expect(db.from).not.toHaveBeenCalledWith("lecture_sessions");
    });

    it("allows owning teacher to access professor room", async () => {
      const db = createMockDb({
        teacherCourses: [{ id: courseId1 }],
        lectureSessions: [{ id: lectureId1, course_id: courseId1 }],
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `professor:${lectureId1}`)
      ).resolves.toBeUndefined();

      expect(db.from).toHaveBeenCalledWith("courses");
      expect(db.from).toHaveBeenCalledWith("lecture_sessions");
    });

    it("denies teacher for lecture belonging to an unowned course", async () => {
      const db = createMockDb({
        teacherCourses: [{ id: courseId1 }],
        lectureSessions: [{ id: lectureIdUnowned, course_id: unownedCourseId }],
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `professor:${lectureIdUnowned}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });
    });
  });

  describe("lecture:<lectureId> authorization", () => {
    it("allows enrolled student to access lecture room", async () => {
      const db = createMockDb({
        lectureSessions: [{ id: lectureId1, course_id: courseId1 }],
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, `lecture:${lectureId1}`)
      ).resolves.toBeUndefined();

      // Student courses are already in actor context: courses table must not be queried
      expect(db.from).not.toHaveBeenCalledWith("courses");
      expect(db.from).toHaveBeenCalledWith("lecture_sessions");
    });

    it("denies student with no enrollments without querying lecture_sessions", async () => {
      const unenrolledStudent: ActorContext = {
        ...studentActor,
        enrolledCourses: [],
      };
      const db = createMockDb();
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(unenrolledStudent, `lecture:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });

      expect(db.from).not.toHaveBeenCalled();
    });

    it("denies student for lecture in course they are not enrolled in", async () => {
      const db = createMockDb({
        lectureSessions: [{ id: lectureIdUnowned, course_id: unownedCourseId }],
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, `lecture:${lectureIdUnowned}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });
    });

    it("allows owning teacher to access lecture room", async () => {
      const db = createMockDb({
        teacherCourses: [{ id: courseId1 }],
        lectureSessions: [{ id: lectureId1, course_id: courseId1 }],
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `lecture:${lectureId1}`)
      ).resolves.toBeUndefined();

      expect(db.from).toHaveBeenCalledWith("courses");
      expect(db.from).toHaveBeenCalledWith("lecture_sessions");
    });

    it("denies non-owning teacher for lecture room", async () => {
      const db = createMockDb({
        teacherCourses: [{ id: courseId1 }],
        lectureSessions: [{ id: lectureIdUnowned, course_id: unownedCourseId }],
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `lecture:${lectureIdUnowned}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden room access",
      });
    });
  });

  describe("study-group:<matchId> authorization", () => {
    const fixtureDb = createFixtureSupabaseClient({
      tableRows: {
        students: [
          { id: studentId1, auth_id: studentAuthId, course_id: courseId1 },
          { id: studentId2, auth_id: studentAuthId, course_id: courseId2 },
          { id: studentId3, auth_id: "33333333-3333-4333-8333-333333333339", course_id: courseId1 },
          { id: studentId4, auth_id: studentAuthId4, course_id: courseId1 },
        ],
        study_group_matches: [
          {
            id: matchId1,
            course_id: courseId1,
            student1_id: studentId1,
            student2_id: studentId3,
            concept_ids: ["88888888-8888-4888-8888-888888888888"],
            status: "active",
          },
        ],
      },
    });

    it("allows matched student member to authorize study group room", async () => {
      const authorizer = createRoomAuthorizer(fixtureDb);
      await expect(
        authorizer.authorizeRoom(studentActor, `study-group:${matchId1}`)
      ).resolves.toBeUndefined();
    });

    it("denies same-course non-member student with FORBIDDEN (403)", async () => {
      const nonMemberActor: ActorContext = {
        userId: studentAuthId4,
        authId: studentAuthId4,
        role: "student",
        name: "Non Member",
        email: "nonmember@example.edu",
        enrolledCourses: [{ studentId: studentId4, courseId: courseId1 }],
      };

      const authorizer = createRoomAuthorizer(fixtureDb);
      await expect(
        authorizer.authorizeRoom(nonMemberActor, `study-group:${matchId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    });

    it("denies teacher actor with FORBIDDEN (403)", async () => {
      const authorizer = createRoomAuthorizer(fixtureDb);
      await expect(
        authorizer.authorizeRoom(teacherActor, `study-group:${matchId1}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    });

    it("denies access to non-existent match with FORBIDDEN (403)", async () => {
      const nonExistentMatchId = "77777777-7777-4777-8777-777777777779";
      const authorizer = createRoomAuthorizer(fixtureDb);
      await expect(
        authorizer.authorizeRoom(studentActor, `study-group:${nonExistentMatchId}`)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
        message: "Forbidden study group access",
      });
    });
  });

  describe("Database errors and malformed responses", () => {
    it("wraps database query errors in INTERNAL_SERVER_ERROR (500)", async () => {
      const db = createMockDb({
        coursesError: { message: "connection refused" },
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `professor:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Room authorization failed",
      });
    });

    it("wraps thrown network failures in INTERNAL_SERVER_ERROR (500)", async () => {
      const db = createMockDb({
        throwOnLectures: true,
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(studentActor, `lecture:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Room authorization failed",
      });
    });

    it("wraps malformed returned rows in INTERNAL_SERVER_ERROR (500)", async () => {
      const db = createMockDb({
        malformedCourseRow: { id: "not-a-uuid" },
      });
      const authorizer = createRoomAuthorizer(db);

      await expect(
        authorizer.authorizeRoom(teacherActor, `professor:${lectureId1}`)
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        statusCode: 500,
        message: "Room authorization failed",
      });
    });
  });
});
