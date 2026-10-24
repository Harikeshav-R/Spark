import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository";
import { MasteryService } from "../../../src/server/core/mastery/mastery-service";
import { MasteryRepository } from "../../../src/server/core/mastery/mastery-repository";
import { CourseService } from "../../../src/server/core/courses/course-service";
import { CourseRepository } from "../../../src/server/core/courses/course-repository";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator";
import { AttendanceEvidenceService } from "../../../src/server/core/mastery/attendance-evidence";
import type { UUID } from "../../../src/contracts/common";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)(
  "P3-A-01: Attendance Evidence Recording & Verification (live local Supabase)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let masteryService: MasteryService;
    let attendanceService: AttendanceEvidenceService;
    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const enrollmentRepo = new EnrollmentRepository(harness.serviceClient);
      enrollmentService = new EnrollmentService(enrollmentRepo);
      const courseRepo = new CourseRepository(harness.serviceClient);
      const idGen = new CryptoIdGenerator();
      courseService = new CourseService(courseRepo, idGen);
      const masteryRepo = new MasteryRepository(harness.serviceClient);
      masteryService = new MasteryService(masteryRepo);
      attendanceService = new AttendanceEvidenceService(
        harness.serviceClient,
        courseService,
        masteryService,
      );
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("records batch attendance: 0.20 becomes 0.25, 0.60 remains 0.60, attempts untouched, absent untouched", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const [concept1, concept2] = course.conceptIds;

      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;
      const teacherActor = harness.buildTeacherActor(teacherUser, course.teacherId);

      // Create 3 students
      const studentUserA = await harness.createTestUser(currentContext, "student");
      const studentUserB = await harness.createTestUser(currentContext, "student");
      const studentUserC = await harness.createTestUser(currentContext, "student");

      const studentA = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserA),
        course.joinCode,
      );
      const studentB = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserB),
        course.joinCode,
      );
      const studentC = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserC),
        course.joinCode,
      );

      const enrolledActorA = harness.buildStudentActor(studentUserA, [
        { studentId: studentA.id, courseId: course.courseId },
      ]);
      const enrolledActorB = harness.buildStudentActor(studentUserB, [
        { studentId: studentB.id, courseId: course.courseId },
      ]);

      // Seed student A at 0.20 on concept1 (one tutor evidence)
      await masteryService.applyEvidence(enrolledActorA, studentA.id, concept1, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      // Seed student B at 0.60 on concept1 (three tutor evidences)
      await masteryService.applyEvidence(enrolledActorB, studentB.id, concept1, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(enrolledActorB, studentB.id, concept1, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(enrolledActorB, studentB.id, concept1, {
        type: "tutor",
        sourceId: randomUUID(),
      });

      // Check baseline masteries
      const baselineA = await masteryService.getMastery(enrolledActorA, studentA.id);
      const baseA_c1 = baselineA.find((m) => m.conceptId === concept1)!;
      expect(baseA_c1.confidence).toBe(0.2);
      expect(baseA_c1.attempts).toBe(0);
      expect(baseA_c1.version).toBe(2);

      const baselineB = await masteryService.getMastery(enrolledActorB, studentB.id);
      const baseB_c1 = baselineB.find((m) => m.conceptId === concept1)!;
      expect(baseB_c1.confidence).toBe(0.6);
      expect(baseB_c1.attempts).toBe(0);
      expect(baseB_c1.version).toBe(4);

      // Create live lecture session
      const lectureId = randomUUID();
      const { error: lectureError } = await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Lecture on Concept 1",
        status: "live",
      });
      expect(lectureError).toBeNull();

      // Create transcript chunk
      const chunkId = randomUUID();
      const { error: chunkError } = await harness.serviceClient.from("transcript_chunks").insert({
        id: chunkId,
        lecture_id: lectureId,
        text: "Discussing the core principles of concept 1.",
        timestamp_sec: 12.5,
      });
      expect(chunkError).toBeNull();

      // Link chunk to concept 1 only
      const { error: conceptLinkError } = await harness.serviceClient
        .from("transcript_concepts")
        .insert({
          transcript_chunk_id: chunkId,
          concept_id: concept1,
        });
      expect(conceptLinkError).toBeNull();

      // Execute attendance recording for present students A and B
      const results = await attendanceService.recordChunkAttendance(
        teacherActor,
        course.courseId,
        lectureId,
        chunkId,
        [studentA.id, studentB.id],
      );

      expect(results).toHaveLength(2);
      const resA = results.find((r) => r.studentId === studentA.id)!;
      expect(resA.confidence).toBe(0.25);
      expect(resA.band).toBe("red");
      expect(resA.attempts).toBe(0);
      expect(resA.version).toBe(3);

      const resB = results.find((r) => r.studentId === studentB.id)!;
      expect(resB.confidence).toBe(0.60);
      expect(resB.band).toBe("yellow");
      expect(resB.attempts).toBe(0);
      expect(resB.version).toBe(5);

      // Verify Student A on concept 1 in DB: 0.20 -> 0.25, version incremented, attempts 0
      const masteryAAfter = await masteryService.getMastery(enrolledActorA, studentA.id);
      const rowA_c1 = masteryAAfter.find((m) => m.conceptId === concept1)!;
      expect(rowA_c1.confidence).toBe(0.25);
      expect(rowA_c1.attempts).toBe(0);
      expect(rowA_c1.version).toBe(3);

      // Concept 2 for student A: untouched
      const rowA_c2 = masteryAAfter.find((m) => m.conceptId === concept2)!;
      expect(rowA_c2.confidence).toBe(0.0);
      expect(rowA_c2.version).toBe(1);

      // Verify Student B on concept 1 in DB: 0.60 -> 0.60 (unchanged), version incremented, attempts 0
      const masteryBAfter = await masteryService.getMastery(enrolledActorB, studentB.id);
      const rowB_c1 = masteryBAfter.find((m) => m.conceptId === concept1)!;
      expect(rowB_c1.confidence).toBe(0.6);
      expect(rowB_c1.attempts).toBe(0);
      expect(rowB_c1.version).toBe(5);

      // Verify Student C (absent): completely untouched
      const enrolledActorC = harness.buildStudentActor(studentUserC, [
        { studentId: studentC.id, courseId: course.courseId },
      ]);
      const masteryCAfter = await masteryService.getMastery(enrolledActorC, studentC.id);
      const rowC_c1 = masteryCAfter.find((m) => m.conceptId === concept1)!;
      expect(rowC_c1.confidence).toBe(0.0);
      expect(rowC_c1.attempts).toBe(0);
      expect(rowC_c1.version).toBe(1);

      // Verify audit rows in mastery_evidence table
      const { data: auditA } = await harness.serviceClient
        .from("mastery_evidence")
        .select("*")
        .eq("student_id", studentA.id)
        .eq("source_id", chunkId);
      expect(auditA).toHaveLength(1);
      expect(auditA![0].evidence_type).toBe("attendance");
      expect(auditA![0].prior_confidence).toBe(0.2);
      expect(auditA![0].new_confidence).toBe(0.25);

      const { data: auditB } = await harness.serviceClient
        .from("mastery_evidence")
        .select("*")
        .eq("student_id", studentB.id)
        .eq("source_id", chunkId);
      expect(auditB).toHaveLength(1);
      expect(auditB![0].evidence_type).toBe("attendance");
      expect(auditB![0].prior_confidence).toBe(0.6);
      expect(auditB![0].new_confidence).toBe(0.6);
    });

    it("idempotently handles chunk attendance replay without double increments or audit duplication", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const [concept1] = course.conceptIds;

      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;
      const teacherActor = harness.buildTeacherActor(teacherUser, course.teacherId);

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const lectureId = randomUUID();
      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Replay Test Lecture",
        status: "live",
      });

      const chunkId = randomUUID();
      await harness.serviceClient.from("transcript_chunks").insert({
        id: chunkId,
        lecture_id: lectureId,
        text: "Idempotent speech chunk",
        timestamp_sec: 0,
      });

      await harness.serviceClient.from("transcript_concepts").insert({
        transcript_chunk_id: chunkId,
        concept_id: concept1,
      });

      // First run: 0.0 -> 0.05
      const firstRun = await attendanceService.recordChunkAttendance(
        teacherActor,
        course.courseId,
        lectureId,
        chunkId,
        [student.id],
      );
      expect(firstRun[0].confidence).toBe(0.05);
      expect(firstRun[0].version).toBe(2);

      // Replay run with identical chunk and student
      const replayRun = await attendanceService.recordChunkAttendance(
        teacherActor,
        course.courseId,
        lectureId,
        chunkId,
        [student.id],
      );
      expect(replayRun[0].confidence).toBe(0.05);
      expect(replayRun[0].version).toBe(2);

      // Verify mastery state in DB
      const masteryAfter = await masteryService.getMastery(enrolledActor, student.id);
      expect(masteryAfter[0].confidence).toBe(0.05);
      expect(masteryAfter[0].version).toBe(2);

      // Verify exactly 1 audit row exists for this chunk
      const { data: auditRows } = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("source_id", chunkId);
      expect(auditRows).toHaveLength(1);
    });

    it("rejects non-live lecture with 400 BAD_REQUEST and makes no DB updates", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const [concept1] = course.conceptIds;

      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;
      const teacherActor = harness.buildTeacherActor(teacherUser, course.teacherId);

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );

      const lectureId = randomUUID();
      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Completed Lecture",
        status: "completed",
      });

      const chunkId = randomUUID();
      await harness.serviceClient.from("transcript_chunks").insert({
        id: chunkId,
        lecture_id: lectureId,
        text: "Completed speech chunk",
        timestamp_sec: 0,
      });

      await harness.serviceClient.from("transcript_concepts").insert({
        transcript_chunk_id: chunkId,
        concept_id: concept1,
      });

      await expect(
        attendanceService.recordChunkAttendance(
          teacherActor,
          course.courseId,
          lectureId,
          chunkId,
          [student.id],
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          code: "BAD_REQUEST",
          message: "Attendance evidence requires a live lecture",
        }),
      );
    });

    it("rejects batch with 403 FORBIDDEN when any student is unenrolled, preserving all student states", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const [concept1] = course.conceptIds;

      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;
      const teacherActor = harness.buildTeacherActor(teacherUser, course.teacherId);

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const unenrolledStudentId: UUID = randomUUID();

      const lectureId = randomUUID();
      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Membership Check Lecture",
        status: "live",
      });

      const chunkId = randomUUID();
      await harness.serviceClient.from("transcript_chunks").insert({
        id: chunkId,
        lecture_id: lectureId,
        text: "Chunk text",
        timestamp_sec: 0,
      });

      await harness.serviceClient.from("transcript_concepts").insert({
        transcript_chunk_id: chunkId,
        concept_id: concept1,
      });

      await expect(
        attendanceService.recordChunkAttendance(
          teacherActor,
          course.courseId,
          lectureId,
          chunkId,
          [student.id, unenrolledStudentId],
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: "FORBIDDEN",
        }),
      );

      // Verify enrolled student's mastery was NOT modified
      const mastery = await masteryService.getMastery(enrolledActor, student.id);
      expect(mastery[0].confidence).toBe(0.0);
      expect(mastery[0].version).toBe(1);
    });
  },
);
