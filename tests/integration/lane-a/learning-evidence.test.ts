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
  LearningEvidenceService,
} from "../../../src/server/core/index.js";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)(
  "P5-A-01: Learning Evidence Service Integration Tests (live local PostgreSQL)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let masteryService: MasteryService;
    let learningEvidenceService: LearningEvidenceService;

    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const client = harness.serviceClient;
      enrollmentService = new EnrollmentService(new EnrollmentRepository(client));
      courseService = new CourseService(new CourseRepository(client), new CryptoIdGenerator());
      masteryService = new MasteryService(new MasteryRepository(client));
      learningEvidenceService = new LearningEvidenceService(client, courseService, masteryService);

    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("applies a persisted 4/5 quiz attempt: confidence 0 -> 0.15, band red, attempts 0, version 2, and audits mastery_evidence", async () => {
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

      const attemptId = randomUUID();
      const insertAttempt = await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student.id,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [
          { question_id: randomUUID(), selected_option: 0, correct: true },
          { question_id: randomUUID(), selected_option: 1, correct: true },
          { question_id: randomUUID(), selected_option: 2, correct: true },
          { question_id: randomUUID(), selected_option: 3, correct: true },
          { question_id: randomUUID(), selected_option: 0, correct: false },
        ],
      });
      expect(insertAttempt.error).toBeNull();

      // Student applies their own quiz attempt
      const result = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        course.courseId,
        attemptId,
      );

      expect(result).toEqual({
        sourceId: attemptId,
        studentId: student.id,
        conceptId,
        confidence: 0.15,
        band: "red",
        attempts: 0,
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
        confidence: 0.15,
        attempts: 0,
        version: 2,
      });

      // Verify mastery_evidence audit row in PostgreSQL
      const auditRows = await harness.serviceClient
        .from("mastery_evidence")
        .select("evidence_type,source_id,prior_confidence,new_confidence,student_id,concept_id")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(auditRows.error).toBeNull();
      expect(auditRows.data).toHaveLength(1);
      expect(auditRows.data![0]).toEqual({
        evidence_type: "quiz",
        source_id: attemptId,
        prior_confidence: 0.0,
        new_confidence: 0.15,
        student_id: student.id,
        concept_id: conceptId,
      });
    });

    it("chains quiz (0.15) and assistant tutor understanding message (0.20) to reach 0.35 with attempts remaining 0", async () => {
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

      // 1. Insert and apply quiz attempt
      const attemptId = randomUUID();
      const insertAttempt = await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student.id,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
      });
      expect(insertAttempt.error).toBeNull();

      const quizResult = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        course.courseId,
        attemptId,
      );
      expect(quizResult.confidence).toBe(0.15);
      expect(quizResult.attempts).toBe(0);
      expect(quizResult.version).toBe(2);

      // 2. Insert tutoring session and assistant understanding message
      const sessionId = randomUUID();
      const insertSession = await harness.serviceClient.from("tutoring_sessions").insert({
        id: sessionId,
        student_id: student.id,
        target_concepts: [conceptId],
      });
      expect(insertSession.error).toBeNull();

      const messageId = randomUUID();
      const insertMessage = await harness.serviceClient.from("tutoring_messages").insert({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        content: "Understanding verified by tutor.",
        concept_id: conceptId,
        understanding_detected: true,
      });
      expect(insertMessage.error).toBeNull();

      // 3. Apply tutoring message
      const tutorResult = await learningEvidenceService.applyTutorMessage(
        studentActor,
        course.courseId,
        messageId,
      );
      expect(tutorResult).toEqual({
        sourceId: messageId,
        studentId: student.id,
        conceptId,
        confidence: 0.35,
        band: "red",
        attempts: 0,
        version: 3,
      });

      // Verify PostgreSQL state
      const masteryRows = await harness.serviceClient
        .from("student_mastery")
        .select("confidence,attempts,version")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(masteryRows.data![0]).toEqual({
        confidence: 0.35,
        attempts: 0,
        version: 3,
      });

      const auditRows = await harness.serviceClient
        .from("mastery_evidence")
        .select("evidence_type,source_id,prior_confidence,new_confidence")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId)
        .order("created_at", { ascending: true });
      expect(auditRows.data).toHaveLength(2);
      expect(auditRows.data![0]).toEqual({
        evidence_type: "quiz",
        source_id: attemptId,
        prior_confidence: 0.0,
        new_confidence: 0.15,
      });
      expect(auditRows.data![1]).toEqual({
        evidence_type: "tutor",
        source_id: messageId, // message ID, not session ID!
        prior_confidence: 0.15,
        new_confidence: 0.35,
      });
    });

    it("does not increment poll attempts when baseline poll attempts exist (INV-MAS04)", async () => {
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

      // Apply poll evidence directly via MasteryService to set baseline attempts = 1
      const pollRes = await masteryService.applyEvidence(studentActor, student.id, conceptId, {
        type: "poll",
        outcome: "correct",
        sourceId: randomUUID(),
      });
      expect(pollRes.confidence).toBe(0.85);
      expect(pollRes.attempts).toBe(1);
      expect(pollRes.version).toBe(2);

      // Now apply quiz evidence
      const attemptId = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student.id,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
      });

      const quizRes = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        course.courseId,
        attemptId,
      );
      expect(quizRes.confidence).toBe(1.0);
      expect(quizRes.attempts).toBe(1); // STILL 1!
      expect(quizRes.version).toBe(3);

      const masteryRows = await harness.serviceClient
        .from("student_mastery")
        .select("confidence,attempts,version")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(masteryRows.data![0]).toEqual({
        confidence: 1.0,
        attempts: 1,
        version: 3,
      });
    });

    it("idempotently handles sequential duplicate replays and concurrent duplicate applications (INV-MAS05)", async () => {
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

      const attemptId = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student.id,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
      });

      // Concurrent execution against PostgreSQL row locks
      const [res1, res2] = await Promise.all([
        learningEvidenceService.applyQuizAttempt(studentActor, course.courseId, attemptId),
        learningEvidenceService.applyQuizAttempt(studentActor, course.courseId, attemptId),
      ]);

      expect(res1.confidence).toBe(0.15);
      expect(res2.confidence).toBe(0.15);
      expect(res1.version).toBe(2);
      expect(res2.version).toBe(2);

      // Subsequent sequential replay
      const res3 = await learningEvidenceService.applyQuizAttempt(
        studentActor,
        course.courseId,
        attemptId,
      );
      expect(res3.confidence).toBe(0.15);
      expect(res3.version).toBe(2);
      expect(res3.attempts).toBe(0);

      // Verify exactly ONE audit entry exists in PostgreSQL
      const auditRows = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(auditRows.data).toHaveLength(1);
    });

    it("allows teacher actor to apply quiz and tutor evidence for enrolled student", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0];

      const teacherActor = harness.buildTeacherActor(
        currentContext.users.find((u) => u.authId === course.teacherAuthId)!,
        course.teacherId,
      );

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );

      const attemptId = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student.id,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
      });

      const quizRes = await learningEvidenceService.applyQuizAttempt(
        teacherActor,
        course.courseId,
        attemptId,
      );
      expect(quizRes.confidence).toBe(0.15);
      expect(quizRes.studentId).toBe(student.id);

      const sessionId = randomUUID();
      await harness.serviceClient.from("tutoring_sessions").insert({
        id: sessionId,
        student_id: student.id,
        target_concepts: [conceptId],
      });

      const messageId = randomUUID();
      await harness.serviceClient.from("tutoring_messages").insert({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        content: "Understanding verified.",
        concept_id: conceptId,
        understanding_detected: true,
      });

      const tutorRes = await learningEvidenceService.applyTutorMessage(
        teacherActor,
        course.courseId,
        messageId,
      );
      expect(tutorRes.confidence).toBe(0.35);
      expect(tutorRes.studentId).toBe(student.id);
    });

    it("rejects ineligible tutor message with 400 VALIDATION_ERROR without changing mastery", async () => {
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

      const sessionId = randomUUID();
      await harness.serviceClient.from("tutoring_sessions").insert({
        id: sessionId,
        student_id: student.id,
        target_concepts: [conceptId],
      });

      const messageId = randomUUID();
      await harness.serviceClient.from("tutoring_messages").insert({
        id: messageId,
        session_id: sessionId,
        role: "assistant",
        content: "Still working on understanding...",
        concept_id: conceptId,
        understanding_detected: false, // NOT detected!
      });

      await expect(
        learningEvidenceService.applyTutorMessage(studentActor, course.courseId, messageId),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Tutoring message is not eligible for mastery evidence",
      });

      // Mastery must remain unchanged at 0.0, version 1
      const masteryRows = await harness.serviceClient
        .from("student_mastery")
        .select("confidence,attempts,version")
        .eq("student_id", student.id)
        .eq("concept_id", conceptId);
      expect(masteryRows.data![0]).toEqual({
        confidence: 0.0,
        attempts: 0,
        version: 1,
      });
    });

    it("rejects student applying another student's quiz attempt with 404 NOT_FOUND", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0];

      const student1User = await harness.createTestUser(currentContext, "student");
      const student1 = await enrollmentService.enrollStudent(
        harness.buildStudentActor(student1User),
        course.joinCode,
      );

      const student2User = await harness.createTestUser(currentContext, "student");
      const student2 = await enrollmentService.enrollStudent(
        harness.buildStudentActor(student2User),
        course.joinCode,
      );
      const student2Actor = harness.buildStudentActor(student2User, [
        { studentId: student2.id, courseId: course.courseId },
      ]);

      const attemptId = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student1.id, // belongs to student1
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
      });

      // student2 attempts to apply student1's attempt
      await expect(
        learningEvidenceService.applyQuizAttempt(student2Actor, course.courseId, attemptId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });
  },
);
