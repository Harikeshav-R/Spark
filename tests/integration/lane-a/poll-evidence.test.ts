import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import {
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  EnrollmentRepository,
  EnrollmentService,
  MasteryRepository,
  MasteryService,
  PollEvidenceService,
} from "../../../src/server/core/index.js";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)(
  "P4-A-01: Poll Response Atomic Mastery Evidence Application Integration Tests (live local PostgreSQL)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let masteryService: MasteryService;
    let pollEvidenceService: PollEvidenceService;
    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const client = harness.serviceClient;
      enrollmentService = new EnrollmentService(new EnrollmentRepository(client));
      courseService = new CourseService(new CourseRepository(client), new CryptoIdGenerator());
      masteryService = new MasteryService(new MasteryRepository(client));
      pollEvidenceService = new PollEvidenceService(client, courseService, masteryService);
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("applies new evaluated correct poll response, verifies confidence 0.85/band green/attempts 1/version 2, and audits mastery_evidence", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0];
      expect(conceptId).toBeDefined();

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const lectureId = randomUUID();
      const questionId = randomUUID();
      const responseId = randomUUID();

      const lectureRes = await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Integration Lecture",
        status: "live",
      });
      expect(lectureRes.error).toBeNull();

      const questionRes = await harness.serviceClient.from("poll_questions").insert({
        id: questionId,
        lecture_id: lectureId,
        concept_id: conceptId,
        question: "Explain the core concept.",
        expected_answer: "The fundamental definition.",
        status: "active",
      });
      expect(questionRes.error).toBeNull();

      const responseRes = await harness.serviceClient.from("poll_responses").insert({
        id: responseId,
        question_id: questionId,
        student_id: student.id,
        answer: "The fundamental definition.",
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Well stated explanation." },
      });
      expect(responseRes.error).toBeNull();

      // Student applies their own response
      const result = await pollEvidenceService.applyResponse(
        studentActor,
        course.courseId,
        responseId,
      );

      expect(result).toEqual({
        responseId,
        studentId: student.id,
        conceptId,
        confidence: 0.85,
        band: "green",
        attempts: 1,
        version: 2,
      });

      // Verify student_mastery row in PostgreSQL
      const masteryRows = await harness.serviceClient
        .from("student_mastery")
        .select("confidence,attempts,version")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(masteryRows.error).toBeNull();
      expect(masteryRows.data).toHaveLength(1);
      expect(masteryRows.data![0]).toEqual({
        confidence: 0.85,
        attempts: 1,
        version: 2,
      });

      // Verify mastery_evidence audit row in PostgreSQL
      const auditRows = await harness.serviceClient
        .from("mastery_evidence")
        .select("evidence_type,source_id,prior_confidence,new_confidence")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(auditRows.error).toBeNull();
      expect(auditRows.data).toEqual([
        {
          evidence_type: "poll",
          source_id: responseId,
          prior_confidence: 0,
          new_confidence: 0.85,
        },
      ]);

      // Verify poll_responses was not modified by the evidence application
      const pollResponseDb = await harness.serviceClient
        .from("poll_responses")
        .select("status,evaluation")
        .eq("id", responseId)
        .single();
      expect(pollResponseDb.error).toBeNull();
      expect(pollResponseDb.data).toEqual({
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Well stated explanation." },
      });
    });

    it("ensures ten concurrent duplicate applications yield exactly one audit row and attempts 1/version 2", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0];

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const lectureId = randomUUID();
      const questionId = randomUUID();
      const responseId = randomUUID();

      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Concurrent Poll Lecture",
        status: "live",
      });
      await harness.serviceClient.from("poll_questions").insert({
        id: questionId,
        lecture_id: lectureId,
        concept_id: conceptId,
        question: "Explain concurrency safety.",
        expected_answer: "Row-level locks prevent race conditions.",
        status: "active",
      });
      await harness.serviceClient.from("poll_responses").insert({
        id: responseId,
        question_id: questionId,
        student_id: student.id,
        answer: "Row-level locks prevent race conditions.",
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Strong concurrency insight." },
      });

      // 10 concurrent duplicate applications
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          pollEvidenceService.applyResponse(studentActor, course.courseId, responseId),
        ),
      );

      // All 10 returned identical idempotent result
      for (const res of results) {
        expect(res).toEqual({
          responseId,
          studentId: student.id,
          conceptId,
          confidence: 0.85,
          band: "green",
          attempts: 1,
          version: 2,
        });
      }

      // Exactly 1 audit record in PostgreSQL
      const audit = await harness.serviceClient
        .from("mastery_evidence")
        .select("evidence_type,source_id")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(1);
      expect(audit.data![0].source_id).toBe(responseId);

      // Mastery row reflects attempts=1, version=2
      const stored = (await masteryService.getMastery(studentActor, student.id))[0];
      expect(stored.confidence).toBe(0.85);
      expect(stored.attempts).toBe(1);
      expect(stored.version).toBe(2);
    });

    it("applies two distinct evaluated responses for two questions on the same concept, yielding 2 audit rows and attempts 2/version 3", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0];

      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;
      const teacherActor = harness.buildTeacherActor(teacherUser, course.teacherId);

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );

      const lectureId = randomUUID();
      const question1Id = randomUUID();
      const question2Id = randomUUID();
      const response1Id = randomUUID();
      const response2Id = randomUUID();

      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Two Poll Lecture",
        status: "live",
      });
      await harness.serviceClient.from("poll_questions").insert([
        {
          id: question1Id,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: "Question 1 on concept",
          expected_answer: "Answer 1",
          status: "active",
        },
        {
          id: question2Id,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: "Question 2 on concept",
          expected_answer: "Answer 2",
          status: "active",
        },
      ]);
      await harness.serviceClient.from("poll_responses").insert([
        {
          id: response1Id,
          question_id: question1Id,
          student_id: student.id,
          answer: "Answer 1",
          status: "evaluated",
          evaluation: { outcome: "correct", feedback: "Good answer 1" },
        },
        {
          id: response2Id,
          question_id: question2Id,
          student_id: student.id,
          answer: "Answer 2",
          status: "evaluated",
          evaluation: { outcome: "correct", feedback: "Good answer 2" },
        },
      ]);

      // Teacher applies response 1
      const res1 = await pollEvidenceService.applyResponse(
        teacherActor,
        course.courseId,
        response1Id,
      );
      expect(res1.confidence).toBe(0.85);
      expect(res1.attempts).toBe(1);
      expect(res1.version).toBe(2);

      // Teacher applies response 2
      const res2 = await pollEvidenceService.applyResponse(
        teacherActor,
        course.courseId,
        response2Id,
      );
      expect(res2.confidence).toBe(0.85);
      expect(res2.attempts).toBe(2);
      expect(res2.version).toBe(3);

      // Two distinct audit rows in mastery_evidence
      const audit = await harness.serviceClient
        .from("mastery_evidence")
        .select("source_id,prior_confidence,new_confidence")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(audit.error).toBeNull();
      expect(audit.data).toHaveLength(2);
      const sourceIds = audit.data!.map((a) => a.source_id);
      expect(sourceIds).toContain(response1Id);
      expect(sourceIds).toContain(response2Id);
    });

    it("rejects pending and failed responses with 409 CONFLICT and no mastery mutation", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0];

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const lectureId = randomUUID();
      const questionPendingId = randomUUID();
      const responsePendingId = randomUUID();
      const questionFailedId = randomUUID();
      const responseFailedId = randomUUID();

      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: course.courseId,
        title: "Status Test Lecture",
        status: "live",
      });
      await harness.serviceClient.from("poll_questions").insert([
        {
          id: questionPendingId,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: "Pending poll question",
          expected_answer: "Pending answer",
          status: "active",
        },
        {
          id: questionFailedId,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: "Failed poll question",
          expected_answer: "Failed answer",
          status: "active",
        },
      ]);
      await harness.serviceClient.from("poll_responses").insert([
        {
          id: responsePendingId,
          question_id: questionPendingId,
          student_id: student.id,
          answer: "Pending answer",
          status: "pending",
          evaluation: null,
        },
        {
          id: responseFailedId,
          question_id: questionFailedId,
          student_id: student.id,
          answer: "Failed answer",
          status: "failed",
          evaluation: null,
        },
      ]);

      // Pending response rejected
      await expect(
        pollEvidenceService.applyResponse(studentActor, course.courseId, responsePendingId),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
        message: "Poll response has not been evaluated",
      });

      // Failed response rejected
      await expect(
        pollEvidenceService.applyResponse(studentActor, course.courseId, responseFailedId),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
        message: "Poll response has not been evaluated",
      });

      // No mastery evidence recorded
      const audit = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("student_id", student.id);
      expect(audit.data).toHaveLength(0);
    });

    it("rejects cross-course access and foreign student response requests with 404 NOT_FOUND", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const courseA = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const courseB = await harness.createTestCourse(currentContext, { conceptCount: 1 });

      const studentUserA = await harness.createTestUser(currentContext, "student");
      const studentUserB = await harness.createTestUser(currentContext, "student");

      const studentA = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserA),
        courseA.joinCode,
      );
      const studentB = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserB),
        courseA.joinCode,
      );
      const actorB = harness.buildStudentActor(studentUserB, [
        { studentId: studentB.id, courseId: courseA.courseId },
      ]);

      const lectureId = randomUUID();
      const questionId = randomUUID();
      const responseId = randomUUID();

      await harness.serviceClient.from("lecture_sessions").insert({
        id: lectureId,
        course_id: courseA.courseId,
        title: "Auth Isolation Lecture",
        status: "live",
      });
      await harness.serviceClient.from("poll_questions").insert({
        id: questionId,
        lecture_id: lectureId,
        concept_id: courseA.conceptIds[0],
        question: "Isolation test question",
        expected_answer: "Isolation test answer",
        status: "active",
      });
      await harness.serviceClient.from("poll_responses").insert({
        id: responseId,
        question_id: questionId,
        student_id: studentA.id,
        answer: "Isolation test answer",
        status: "evaluated",
        evaluation: { outcome: "correct", feedback: "Correct" },
      });

      // Student B cannot apply Student A's response -> 404 NOT_FOUND
      await expect(
        pollEvidenceService.applyResponse(actorB, courseA.courseId, responseId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll response not found for this course",
      });

      // Cross-course check: Enroll Student A in courseB as well
      const studentAInB = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserA),
        courseB.joinCode,
      );
      const actorAEnrolledInBoth = harness.buildStudentActor(studentUserA, [
        { studentId: studentA.id, courseId: courseA.courseId },
        { studentId: studentAInB.id, courseId: courseB.courseId },
      ]);

      // Enrolled student requesting courseA's response under courseB -> 404 NOT_FOUND
      await expect(
        pollEvidenceService.applyResponse(actorAEnrolledInBoth, courseB.courseId, responseId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
        message: "Poll response not found for this course",
      });

      // Unenrolled student requesting courseB -> 403 FORBIDDEN from CourseService
      await expect(
        pollEvidenceService.applyResponse(actorB, courseB.courseId, responseId),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
      // No mastery evidence recorded
      const audit = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("source_id", responseId);
      expect(audit.data).toHaveLength(0);
    });
  },
);
