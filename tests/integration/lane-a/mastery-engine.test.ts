import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository";
import { MasteryService } from "../../../src/server/core/mastery/mastery-service";
import { MasteryRepository } from "../../../src/server/core/mastery/mastery-repository";
import {
  applyMasteryEvidence,
  type MasteryEvidence,
} from "../../../src/contracts";
const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)(
  "P1-A-04: Atomic Mastery Engine & PostgreSQL RPC (live local Supabase)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let masteryService: MasteryService;
    let masteryRepo: MasteryRepository;
    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const enrollmentRepo = new EnrollmentRepository(harness.serviceClient);
      enrollmentService = new EnrollmentService(enrollmentRepo);
      masteryRepo = new MasteryRepository(harness.serviceClient);
      masteryService = new MasteryService(masteryRepo);
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("verifies mathematical parity between PostgreSQL RPC and pure TypeScript formulas across all evidence types", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      const student = await enrollmentService.enrollStudent(actor, course.joinCode);
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const testCases: {
        initialConfidence: number;
        evidence: MasteryEvidence;
      }[] = [
        // Poll correct
        { initialConfidence: 0.0, evidence: { type: "poll", outcome: "correct", sourceId: randomUUID() } },
        { initialConfidence: 0.15, evidence: { type: "poll", outcome: "correct", sourceId: randomUUID() } },
        { initialConfidence: 0.85, evidence: { type: "poll", outcome: "correct", sourceId: randomUUID() } },
        { initialConfidence: 0.90, evidence: { type: "poll", outcome: "correct", sourceId: randomUUID() } },
        // Poll partial
        { initialConfidence: 0.20, evidence: { type: "poll", outcome: "partial", sourceId: randomUUID() } },
        { initialConfidence: 0.70, evidence: { type: "poll", outcome: "partial", sourceId: randomUUID() } },
        // Poll wrong
        { initialConfidence: 0.0, evidence: { type: "poll", outcome: "wrong", sourceId: randomUUID() } },
        { initialConfidence: 0.15, evidence: { type: "poll", outcome: "wrong", sourceId: randomUUID() } },
        { initialConfidence: 0.85, evidence: { type: "poll", outcome: "wrong", sourceId: randomUUID() } },
        // Tutor
        { initialConfidence: 0.30, evidence: { type: "tutor", sourceId: randomUUID() } },
        { initialConfidence: 0.90, evidence: { type: "tutor", sourceId: randomUUID() } },
        // Quiz
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.0, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.3999, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.40, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.5999, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.60, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.7999, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 0.80, sourceId: randomUUID() } },
        { initialConfidence: 0.40, evidence: { type: "quiz", score: 1.0, sourceId: randomUUID() } },
        // Attendance
        { initialConfidence: 0.28, evidence: { type: "attendance", sourceId: randomUUID() } },
        { initialConfidence: 0.30, evidence: { type: "attendance", sourceId: randomUUID() } },
        { initialConfidence: 0.60, evidence: { type: "attendance", sourceId: randomUUID() } },
      ];

      for (let i = 0; i < testCases.length; i++) {
        const { initialConfidence, evidence } = testCases[i];
        const conceptId = course.conceptIds[i];

        // Set baseline confidence directly
        await harness.serviceClient
          .from("student_mastery")
          .update({ confidence: initialConfidence, attempts: 0, version: 1 })
          .eq("student_id", student.id)
          .eq("concept_id", conceptId);

        const expected = applyMasteryEvidence(initialConfidence, evidence);
        const actual = await masteryService.applyEvidence(enrolledActor, student.id, conceptId, evidence);

        expect(actual.confidence).toBe(expected.confidence);
        expect(actual.band).toBe(expected.band);
        expect(actual.version).toBe(2);
        expect(actual.attempts).toBe(evidence.type === "poll" ? 1 : 0);

        // Verify audit row
        const { data: auditRows } = await harness.serviceClient
          .from("mastery_evidence")
          .select("*")
          .eq("student_id", student.id)
          .eq("concept_id", conceptId)
          .eq("source_id", evidence.sourceId);

        expect(auditRows).toHaveLength(1);
        expect(auditRows![0].prior_confidence).toBe(initialConfidence);
        expect(auditRows![0].new_confidence).toBe(expected.confidence);
        expect(auditRows![0].evidence_type).toBe(evidence.type);
      }
    });

    it("handles concurrent distinct events atomically without lost updates", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);
      const targetConcept = course.conceptIds[0];

      // Two concurrent tutor events: each +0.20
      const ev1: MasteryEvidence = { type: "tutor", sourceId: randomUUID() };
      const ev2: MasteryEvidence = { type: "tutor", sourceId: randomUUID() };

      await Promise.all([
        masteryService.applyEvidence(enrolledActor, student.id, targetConcept, ev1),
        masteryService.applyEvidence(enrolledActor, student.id, targetConcept, ev2),
      ]);

      const mastery = await masteryService.getMastery(enrolledActor, student.id);
      expect(mastery).toHaveLength(1);
      expect(mastery[0].confidence).toBe(0.40);
      expect(mastery[0].attempts).toBe(0);
      expect(mastery[0].version).toBe(3);

      // Verify audit chain
      const { data: auditRows } = await harness.serviceClient
        .from("mastery_evidence")
        .select("*")
        .eq("student_id", student.id)
        .eq("concept_id", targetConcept)
        .order("created_at", { ascending: true })
        .order("prior_confidence", { ascending: true });

      expect(auditRows).toHaveLength(2);
      const confidences = auditRows!.map((r) => [r.prior_confidence, r.new_confidence]);
      expect(confidences).toEqual([
        [0.0, 0.20],
        [0.20, 0.40],
      ]);
    });

    it("idempotently handles 10 concurrent replays of one event without version or attempt increments", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);
      const targetConcept = course.conceptIds[0];

      const sharedSourceId = randomUUID();
      const tutorEvidence: MasteryEvidence = { type: "tutor", sourceId: sharedSourceId };

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          masteryService.applyEvidence(enrolledActor, student.id, targetConcept, tutorEvidence),
        ),
      );

      for (const res of results) {
        expect(res.confidence).toBe(0.20);
        expect(res.version).toBe(2);
        expect(res.attempts).toBe(0);
      }

      // Exact single audit row
      const { data: auditRows } = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("student_id", student.id)
        .eq("source_id", sharedSourceId);
      expect(auditRows).toHaveLength(1);

      // Apply distinct event, then replay the first one
      const distinctEvent: MasteryEvidence = { type: "tutor", sourceId: randomUUID() };
      const resAfterSecond = await masteryService.applyEvidence(
        enrolledActor,
        student.id,
        targetConcept,
        distinctEvent,
      );
      expect(resAfterSecond.confidence).toBe(0.40);
      expect(resAfterSecond.version).toBe(3);

      // Replay original event: returns current locked state (0.40, version 3) without advancing version
      const replayResult = await masteryService.applyEvidence(
        enrolledActor,
        student.id,
        targetConcept,
        tutorEvidence,
      );
      expect(replayResult.confidence).toBe(0.40);
      expect(replayResult.version).toBe(3);
    });

    it("increments attempts only on unique poll evidence and never on quiz, tutor, or attendance", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);
      const targetConcept = course.conceptIds[0];

      // Poll correct 1
      const p1 = await masteryService.applyEvidence(enrolledActor, student.id, targetConcept, {
        type: "poll",
        outcome: "correct",
        sourceId: randomUUID(),
      });
      expect(p1.attempts).toBe(1);

      // Poll correct 2: confidence stays 0.85, attempts increments to 2
      const p2 = await masteryService.applyEvidence(enrolledActor, student.id, targetConcept, {
        type: "poll",
        outcome: "correct",
        sourceId: randomUUID(),
      });
      expect(p2.attempts).toBe(2);
      expect(p2.confidence).toBe(0.85);

      // Tutor: attempts stays 2
      const t1 = await masteryService.applyEvidence(enrolledActor, student.id, targetConcept, {
        type: "tutor",
        sourceId: randomUUID(),
      });
      expect(t1.attempts).toBe(2);

      // Quiz: attempts stays 2
      const q1 = await masteryService.applyEvidence(enrolledActor, student.id, targetConcept, {
        type: "quiz",
        score: 0.9,
        sourceId: randomUUID(),
      });
      expect(q1.attempts).toBe(2);

      // Attendance: attempts stays 2
      const a1 = await masteryService.applyEvidence(enrolledActor, student.id, targetConcept, {
        type: "attendance",
        sourceId: randomUUID(),
      });
      expect(a1.attempts).toBe(2);
    });

    it("verifies initializeStudentMastery returns count of new rows and rejects mismatched course", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const courseA = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const courseB = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");

      // Enroll in course A
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        courseA.joinCode,
      );

      // Initialized on enrollment -> repeat returns 0
      const secondInit = await masteryService.initializeStudentMastery(student.id, courseA.courseId);
      expect(secondInit).toBe(0);

      // Delete 3 mastery rows, call initialize -> returns 3
      const { data: rows } = await harness.serviceClient
        .from("student_mastery")
        .select("id")
        .eq("student_id", student.id)
        .limit(3);

      for (const r of rows!) {
        await harness.serviceClient.from("student_mastery").delete().eq("id", r.id);
      }

      const repairInit = await masteryService.initializeStudentMastery(student.id, courseA.courseId);
      expect(repairInit).toBe(3);

      // Attempt initialization for course B where student is not enrolled -> 404 NOT_FOUND
      await expect(
        masteryService.initializeStudentMastery(student.id, courseB.courseId),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });
    });

    it("enforces authorization: teacher owner and student target can access; cross-student, unrelated teacher, and cross-course concept are rejected", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUserA = await harness.createTestUser(currentContext, "student");
      const studentUserB = await harness.createTestUser(currentContext, "student");
      const unrelatedTeacherUser = await harness.createTestUser(currentContext, "teacher");

      const studentA = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserA),
        course.joinCode,
      );
      const studentB = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUserB),
        course.joinCode,
      );

      const targetConcept = course.conceptIds[0];
      const validEvidence: MasteryEvidence = { type: "tutor", sourceId: randomUUID() };

      const actorA = harness.buildStudentActor(studentUserA, [
        { studentId: studentA.id, courseId: course.courseId },
      ]);
      const actorB = harness.buildStudentActor(studentUserB, [
        { studentId: studentB.id, courseId: course.courseId },
      ]);
      const teacherActor = harness.buildTeacherActor(
        { authId: course.teacherAuthId, email: "teacher@test.com", name: "Owner Teacher", role: "teacher" },
        course.teacherId,
      );
      const unrelatedTeacherActor = harness.buildTeacherActor(
        unrelatedTeacherUser,
        randomUUID(),
      );

      // Student A can read and apply own mastery
      const resA = await masteryService.applyEvidence(actorA, studentA.id, targetConcept, validEvidence);
      expect(resA.confidence).toBe(0.20);
      const readA = await masteryService.getMastery(actorA, studentA.id);
      expect(readA).toHaveLength(1);

      // Course teacher can read and apply mastery for student A
      const resTeacher = await masteryService.applyEvidence(
        teacherActor,
        studentA.id,
        targetConcept,
        { type: "tutor", sourceId: randomUUID() },
      );
      expect(resTeacher.confidence).toBe(0.40);
      const readTeacher = await masteryService.getMastery(teacherActor, studentA.id);
      expect(readTeacher).toHaveLength(1);

      // Student B targeting student A -> 403
      await expect(
        masteryService.applyEvidence(actorB, studentA.id, targetConcept, validEvidence),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      await expect(
        masteryService.getMastery(actorB, studentA.id),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // Unrelated teacher targeting student A -> 403
      await expect(
        masteryService.applyEvidence(unrelatedTeacherActor, studentA.id, targetConcept, validEvidence),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // Cross-course concept targeting student A
      const foreignCourse = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const foreignConcept = foreignCourse.conceptIds[0];

      await expect(
        masteryService.applyEvidence(actorA, studentA.id, foreignConcept, validEvidence),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("verifies attendance at >= 0.30 leaves confidence unchanged, creates audit row, and advances version", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);
      const targetConcept = course.conceptIds[0];

      // Set initial confidence = 0.60
      await harness.serviceClient
        .from("student_mastery")
        .update({ confidence: 0.60, attempts: 0, version: 1 })
        .eq("student_id", student.id)
        .eq("concept_id", targetConcept);

      const attendanceEvent: MasteryEvidence = { type: "attendance", sourceId: randomUUID() };
      const res = await masteryService.applyEvidence(
        enrolledActor,
        student.id,
        targetConcept,
        attendanceEvent,
      );

      expect(res.confidence).toBe(0.60);
      expect(res.version).toBe(2);
      expect(res.attempts).toBe(0);

      const { data: audit } = await harness.serviceClient
        .from("mastery_evidence")
        .select("*")
        .eq("source_id", attendanceEvent.sourceId);

      expect(audit).toHaveLength(1);
      expect(audit![0].prior_confidence).toBe(0.60);
      expect(audit![0].new_confidence).toBe(0.60);
    });

    it("atomically rolls back audit insert when mastery update fails, and succeeds on retry after trigger removal", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);
      const targetConcept = course.conceptIds[0];

      const triggerName = `trg_mastery_fail_${student.id.replace(/-/g, "")}`;
      const fnName = `fn_mastery_fail_${student.id.replace(/-/g, "")}`;

      const installSql = `
        CREATE OR REPLACE FUNCTION ${fnName}()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.student_id = '${student.id}' THEN
            RAISE EXCEPTION 'Simulated mastery update failure for student %', '${student.id}'
              USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON public.student_mastery
        FOR EACH ROW
        EXECUTE FUNCTION ${fnName}();
      `;

      const ev: MasteryEvidence = { type: "tutor", sourceId: randomUUID() };

      const dbContainer = process.env.SUPABASE_DB_CONTAINER ?? (
        (() => {
          try {
            execFileSync("docker", ["inspect", "supabase_db_spark"], { stdio: "ignore" });
            return "supabase_db_spark";
          } catch {
            return "supabase_db_HackOHIO-2026";
          }
        })()
      );

      try {
        execFileSync(
          "docker",
          ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
          { input: installSql },
        );
        // Expect failure
        await expect(
          masteryService.applyEvidence(enrolledActor, student.id, targetConcept, ev),
        ).rejects.toThrow();

        // Verify mastery state unchanged
        const { data: masteryBefore } = await harness.serviceClient
          .from("student_mastery")
          .select("*")
          .eq("student_id", student.id)
          .eq("concept_id", targetConcept)
          .single();

        expect(masteryBefore!.confidence).toBe(0.0);
        expect(masteryBefore!.version).toBe(1);

        // Verify audit row rolled back (0 rows)
        const { data: auditRows } = await harness.serviceClient
          .from("mastery_evidence")
          .select("id")
          .eq("source_id", ev.sourceId);
        expect(auditRows).toHaveLength(0);
      } finally {
        const cleanupSql = `
          DROP TRIGGER IF EXISTS ${triggerName} ON public.student_mastery;
          DROP FUNCTION IF EXISTS ${fnName}();
        `;
        execFileSync(
          "docker",
          ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
          { input: cleanupSql },
        );
      }

      // Retry after trigger removed: succeeds cleanly
      const retryResult = await masteryService.applyEvidence(
        enrolledActor,
        student.id,
        targetConcept,
        ev,
      );
      expect(retryResult.confidence).toBe(0.20);
      expect(retryResult.version).toBe(2);

      const { data: finalAudit } = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("source_id", ev.sourceId);
      expect(finalAudit).toHaveLength(1);
    });

    it("enforces RLS and permission invariants: anon client denied; service role denied direct UPDATE/DELETE on mastery_evidence", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const enrolledActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);
      const targetConcept = course.conceptIds[0];
      // Anon client cannot read mastery_evidence
      const { error: anonErr } = await harness.anonClient
        .from("mastery_evidence")
        .select("*");
      expect(anonErr).not.toBeNull();

      // Anon client cannot execute apply_mastery_evidence
      const { error: anonRpcErr } = await harness.anonClient.rpc("apply_mastery_evidence", {
        p_actor_auth_id: studentUser.authId,
        p_student_id: student.id,
        p_concept_id: targetConcept,
        p_evidence: { type: "tutor", sourceId: randomUUID() },
      });
      expect(anonRpcErr).not.toBeNull();

      // Service role can apply evidence (SELECT/INSERT)
      const ev: MasteryEvidence = { type: "tutor", sourceId: randomUUID() };
      await masteryService.applyEvidence(enrolledActor, student.id, targetConcept, ev);

      const { data: auditRow } = await harness.serviceClient
        .from("mastery_evidence")
        .select("id")
        .eq("source_id", ev.sourceId)
        .single();
      expect(auditRow).not.toBeNull();

      // Service role cannot UPDATE mastery_evidence directly (permission denied)
      const { error: serviceUpdateErr } = await harness.serviceClient
        .from("mastery_evidence")
        .update({ prior_confidence: 0.99 })
        .eq("id", auditRow!.id);
      expect(serviceUpdateErr).not.toBeNull();

      // Service role cannot DELETE mastery_evidence directly (permission denied)
      const { error: serviceDeleteErr } = await harness.serviceClient
        .from("mastery_evidence")
        .delete()
        .eq("id", auditRow!.id);
      expect(serviceDeleteErr).not.toBeNull();
    });
  },
);
