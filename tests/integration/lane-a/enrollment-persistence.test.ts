import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)(
  "P1-A-03: Enrollment & Mastery Initialization Persistence (live local Supabase)",
  () => {
    let harness: SupabaseTestHarness;
    let service: EnrollmentService;
    let repo: EnrollmentRepository;
    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      repo = new EnrollmentRepository(harness.serviceClient);
      service = new EnrollmentService(repo);
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("enrolls new student in 33-concept course, initializing exactly 33 mastery rows with default values", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      const student = await service.enrollStudent(actor, course.joinCode);

      expect(student.authId).toBe(studentUser.authId);
      expect(student.courseId).toBe(course.courseId);
      expect(student.name).toBe(studentUser.name);
      expect(student.email).toBe(studentUser.email);
      expect(student.id).toBeDefined();

      // Verify single student in DB
      const { data: students, error: studentErr } = await harness.serviceClient
        .from("students")
        .select("*")
        .eq("auth_id", studentUser.authId)
        .eq("course_id", course.courseId);

      expect(studentErr).toBeNull();
      expect(students).toHaveLength(1);
      expect(students![0].id).toBe(student.id);

      // Verify exactly 33 mastery rows matching conceptIds
      const { data: masteryRows, error: masteryErr } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id);

      expect(masteryErr).toBeNull();
      expect(masteryRows).toHaveLength(33);

      const masteryConceptIds = new Set(masteryRows!.map((m) => m.concept_id));
      for (const conceptId of course.conceptIds) {
        expect(masteryConceptIds.has(conceptId)).toBe(true);
      }

      for (const row of masteryRows!) {
        expect(row.confidence).toBe(0.0);
        expect(row.attempts).toBe(0);
        expect(row.version).toBe(1);
      }
    });

    it("idempotently handles sequential repeat and 10 concurrent enrollments", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      // Initial enrollment
      const first = await service.enrollStudent(actor, course.joinCode);

      // Sequential repeat
      const second = await service.enrollStudent(actor, course.joinCode);
      expect(second.id).toBe(first.id);

      // 10 concurrent calls
      const concurrentResults = await Promise.all(
        Array.from({ length: 10 }, () => service.enrollStudent(actor, course.joinCode)),
      );

      for (const res of concurrentResults) {
        expect(res.id).toBe(first.id);
      }

      // Check DB holds exactly one student and 33 mastery records
      const { data: students } = await harness.serviceClient
        .from("students")
        .select("id")
        .eq("auth_id", studentUser.authId)
        .eq("course_id", course.courseId);

      expect(students).toHaveLength(1);

      const { data: masteryRows } = await harness.serviceClient
        .from("student_mastery")
        .select("id")
        .eq("student_id", first.id);

      expect(masteryRows).toHaveLength(33);
    });

    it("preserves existing mastery progress on enrollment replay and repairs only deleted rows", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      const student = await service.enrollStudent(actor, course.joinCode);

      // Fetch mastery rows
      const { data: initialMastery } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id);

      const targetConcept1 = initialMastery![0].concept_id;
      const targetConcept2 = initialMastery![1].concept_id;

      // Update concept 1: confidence=0.6, attempts=2, version=4
      const { error: updateErr } = await harness.serviceClient
        .from("student_mastery")
        .update({
          confidence: 0.6,
          attempts: 2,
          version: 4,
        })
        .eq("student_id", student.id)
        .eq("concept_id", targetConcept1);
      expect(updateErr).toBeNull();

      // Delete concept 2
      const { error: deleteErr } = await harness.serviceClient
        .from("student_mastery")
        .delete()
        .eq("student_id", student.id)
        .eq("concept_id", targetConcept2);
      expect(deleteErr).toBeNull();

      // Verify concept 2 is gone (count 32)
      const { data: midMastery } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id);
      expect(midMastery).toHaveLength(32);

      // Re-enroll
      await service.enrollStudent(actor, course.joinCode);

      // Verify:
      // Concept 1 remained unchanged
      const { data: c1Row } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id)
        .eq("concept_id", targetConcept1)
        .single();
      expect(c1Row!.confidence).toBe(0.6);
      expect(c1Row!.attempts).toBe(2);
      expect(c1Row!.version).toBe(4);

      // Concept 2 was repaired with defaults (confidence=0.0, attempts=0, version=1)
      const { data: c2Row } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id)
        .eq("concept_id", targetConcept2)
        .single();
      expect(c2Row).not.toBeNull();
      expect(c2Row!.confidence).toBe(0.0);
      expect(c2Row!.attempts).toBe(0);
      expect(c2Row!.version).toBe(1);

      // Total count back to 33
      const { data: finalMastery } = await harness.serviceClient
        .from("student_mastery")
        .select("id")
        .eq("student_id", student.id);
      expect(finalMastery).toHaveLength(33);
    });

    it("enrolls in empty course with 0 mastery rows; rejects unknown and invalid join codes without mutating DB", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const emptyCourse = await harness.createTestCourse(currentContext, { conceptCount: 0 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      // Enroll in 0-concept course
      const student = await service.enrollStudent(actor, emptyCourse.joinCode);
      expect(student.id).toBeDefined();

      const { data: masteryRows } = await harness.serviceClient
        .from("student_mastery")
        .select("id")
        .eq("student_id", student.id);
      expect(masteryRows).toHaveLength(0);

      // Unknown 8-char join code -> 404
      const unknownStudentUser = await harness.createTestUser(currentContext, "student");
      const unknownActor = harness.buildStudentActor(unknownStudentUser);

      await expect(
        service.enrollStudent(unknownActor, "ZZZZZZZZ"),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        statusCode: 404,
      });

      // Confirm no enrollment created for unknown
      const { data: unknownEnrollments } = await harness.serviceClient
        .from("students")
        .select("id")
        .eq("auth_id", unknownStudentUser.authId);
      expect(unknownEnrollments).toHaveLength(0);

      // Malformed join code -> 400
      await expect(
        service.enrollStudent(unknownActor, "invalid-code"),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("creates isolated enrollments for the same student in different courses without mastery cross-contamination", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const courseA = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const courseB = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      const studentA = await service.enrollStudent(actor, courseA.joinCode);
      const studentB = await service.enrollStudent(actor, courseB.joinCode);

      expect(studentA.id).not.toBe(studentB.id);
      expect(studentA.courseId).toBe(courseA.courseId);
      expect(studentB.courseId).toBe(courseB.courseId);

      const { data: masteryA } = await harness.serviceClient
        .from("student_mastery")
        .select("concept_id")
        .eq("student_id", studentA.id);

      const { data: masteryB } = await harness.serviceClient
        .from("student_mastery")
        .select("concept_id")
        .eq("student_id", studentB.id);

      expect(masteryA).toHaveLength(33);
      expect(masteryB).toHaveLength(33);

      const setA = new Set(masteryA!.map((m) => m.concept_id));
      const setB = new Set(masteryB!.map((m) => m.concept_id));

      for (const cA of courseA.conceptIds) {
        expect(setA.has(cA)).toBe(true);
        expect(setB.has(cA)).toBe(false);
      }
      for (const cB of courseB.conceptIds) {
        expect(setB.has(cB)).toBe(true);
        expect(setA.has(cB)).toBe(false);
      }
    });

    it("atomically rolls back student enrollment if mastery initialization fails", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 33 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);

      const triggerName = `trg_test_fail_${course.courseId.replace(/-/g, "")}`;
      const fnName = `fn_test_fail_${course.courseId.replace(/-/g, "")}`;

      // Install scoped trigger in Docker container via psql
      const installSql = `
        CREATE OR REPLACE FUNCTION ${fnName}()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.student_id IN (SELECT id FROM public.students WHERE course_id = '${course.courseId}') THEN
            RAISE EXCEPTION 'Simulated mastery initialization failure for course %', '${course.courseId}'
              USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON public.student_mastery
        FOR EACH ROW
        EXECUTE FUNCTION ${fnName}();
      `;

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
        // Attempt enrollment - must fail
        await expect(service.enrollStudent(actor, course.joinCode)).rejects.toThrow();

        // Verify atomic rollback: neither students nor student_mastery records exist for this course
        const { data: students } = await harness.serviceClient
          .from("students")
          .select("id")
          .eq("auth_id", studentUser.authId)
          .eq("course_id", course.courseId);

        expect(students).toHaveLength(0);

        const { data: masteryRows } = await harness.serviceClient
          .from("student_mastery")
          .select("id")
          .in(
            "concept_id",
            course.conceptIds,
          );

        expect(masteryRows).toHaveLength(0);
      } finally {
        // Drop trigger and function cleanly
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
    });
  },
);
