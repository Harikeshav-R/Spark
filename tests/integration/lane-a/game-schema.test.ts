import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? (
  (() => {
    try {
      execFileSync("docker", ["inspect", "supabase_db_spark"], { stdio: "ignore" });
      return "supabase_db_spark";
    } catch {
      return "supabase_db_HackOHIO-2026";
    }
  })()
);


function runPsqlExpectError(sql: string): string {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        DB_CONTAINER,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-c",
        sql,
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    throw new Error("Expected psql command to fail but it succeeded");
  } catch (err: unknown) {
    let errorString = String(err);
    if (err && typeof err === "object" && "stderr" in err && err.stderr) {
      errorString = String(err.stderr);
    }
    return errorString;
  }
}

describe.skipIf(isFixtureMode)(
  "P1-A-06: Spark Learning Relational Migration 0003 Integration (live local Supabase)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const repo = new EnrollmentRepository(harness.serviceClient);
      enrollmentService = new EnrollmentService(repo);
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("verifies daily_quests and encounters table creation, array ordering, JSON state, and unique quest dates", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 3 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      // Insert daily quest
      const questId = randomUUID();
      const questDate = "2026-10-21";
      const { error: questError } = await harness.serviceClient.from("daily_quests").insert({
        id: questId,
        student_id: student.id,
        quest_date: questDate,
        concept_ids: course.conceptIds,
        completed_ids: [course.conceptIds[0]],
        cleared_at: null,
        version: 1,
      });
      expect(questError).toBeNull();

      // Read back daily quest and verify array ordering
      const { data: questRows, error: readQuestError } = await harness.serviceClient
        .from("daily_quests")
        .select("*")
        .eq("id", questId);
      expect(readQuestError).toBeNull();
      expect(questRows).toHaveLength(1);
      expect(questRows![0].concept_ids).toEqual(course.conceptIds);
      expect(questRows![0].completed_ids).toEqual([course.conceptIds[0]]);

      // Duplicate (student_id, quest_date) must fail (SQLSTATE 23505)
      const { error: dupQuestError } = await harness.serviceClient.from("daily_quests").insert({
        id: randomUUID(),
        student_id: student.id,
        quest_date: questDate,
        concept_ids: course.conceptIds,
      });
      expect(dupQuestError).not.toBeNull();
      expect(dupQuestError?.code).toBe("23505");

      // Different date succeeds
      const { error: nextDateError } = await harness.serviceClient.from("daily_quests").insert({
        id: randomUUID(),
        student_id: student.id,
        quest_date: "2026-10-22",
        concept_ids: course.conceptIds,
      });
      expect(nextDateError).toBeNull();

      // Insert encounter linked to daily quest
      const encounterId = randomUUID();
      const optionPermutations = {
        "1": [0, 1, 2, 3],
        "2": [3, 2, 1, 0],
        "3": [1, 0, 3, 2],
        "4": [2, 3, 0, 1],
        "5": [0, 2, 1, 3],
      };
      const hintsUsed = { "1": 1, "2": 0, "3": 0, "4": 0, "5": 0 };
      const qIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

      const { error: encounterError } = await harness.serviceClient.from("encounters").insert({
        id: encounterId,
        student_id: student.id,
        concept_id: course.conceptIds[0],
        source: "daily",
        quest_id: questId,
        party_quest_id: null,
        status: "active",
        question_ids: qIds,
        option_permutations: optionPermutations,
        hints_used: hintsUsed,
        version: 1,
      });
      expect(encounterError).toBeNull();

      // Read back encounter
      const { data: encounterRows, error: readEncounterErr } = await harness.serviceClient
        .from("encounters")
        .select("*")
        .eq("id", encounterId);
      expect(readEncounterErr).toBeNull();
      expect(encounterRows).toHaveLength(1);
      expect(encounterRows![0].question_ids).toEqual(qIds);
      expect(encounterRows![0].option_permutations).toEqual(optionPermutations);
      expect(encounterRows![0].hints_used).toEqual(hintsUsed);
      expect(encounterRows![0].quest_id).toBe(questId);
    });

    it("verifies concept_quiz_questions.hints check: NULL and 3 strings succeed, invalid shapes fail 23514", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const questionId = randomUUID();

      // Seed valid question with NULL hints
      const { error: insertErr } = await harness.serviceClient.from("concept_quiz_questions").insert({
        id: questionId,
        concept_id: course.conceptIds[0],
        question: "What is backpropagation?",
        option_a: "A",
        option_b: "B",
        option_c: "C",
        option_d: "D",
        correct_answer: 0,
        explanation: "Mathematical derivative propagation",
        question_order: 1,
        hints: null,
      });
      expect(insertErr).toBeNull();

      // Update with valid 3-string hints
      const validHints = ["Think about calculus", "Recall the chain rule", "Evaluate partial derivatives"];
      const { error: validUpdateErr } = await harness.serviceClient
        .from("concept_quiz_questions")
        .update({ hints: validHints })
        .eq("id", questionId);
      expect(validUpdateErr).toBeNull();

      // 2 strings should fail check 23514
      const { error: twoStringsErr } = await harness.serviceClient
        .from("concept_quiz_questions")
        .update({ hints: ["Hint 1", "Hint 2"] })
        .eq("id", questionId);
      expect(twoStringsErr).not.toBeNull();
      expect(twoStringsErr?.code).toBe("23514");

      // 4 strings should fail check 23514
      const { error: fourStringsErr } = await harness.serviceClient
        .from("concept_quiz_questions")
        .update({ hints: ["H1", "H2", "H3", "H4"] })
        .eq("id", questionId);
      expect(fourStringsErr).not.toBeNull();
      expect(fourStringsErr?.code).toBe("23514");

      // Mixed types (number in array) should fail check 23514
      const { error: mixedErr } = await harness.serviceClient
        .from("concept_quiz_questions")
        .update({ hints: ["H1", 2, "H3"] })
        .eq("id", questionId);
      expect(mixedErr).not.toBeNull();
      expect(mixedErr?.code).toBe("23514");

      // Object JSON should fail check 23514
      const { error: objectErr } = await harness.serviceClient
        .from("concept_quiz_questions")
        .update({ hints: { a: 1, b: 2, c: 3 } })
        .eq("id", questionId);
      expect(objectErr).not.toBeNull();
      expect(objectErr?.code).toBe("23514");

      // Prior valid hints unchanged
      const { data: finalRows } = await harness.serviceClient
        .from("concept_quiz_questions")
        .select("hints")
        .eq("id", questionId);
      expect(finalRows![0].hints).toEqual(validHints);
    });

    it("verifies encounter constraints: source/status check, FK cascades", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      // Invalid source fails 23514
      const { error: badSourceErr } = await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: student.id,
        concept_id: course.conceptIds[0],
        source: "boss_fight",
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(badSourceErr).not.toBeNull();
      expect(badSourceErr?.code).toBe("23514");

      // Invalid status fails 23514
      const { error: badStatusErr } = await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: student.id,
        concept_id: course.conceptIds[0],
        source: "star",
        status: "paused",
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(badStatusErr).not.toBeNull();
      expect(badStatusErr?.code).toBe("23514");

      // Nonexistent student fails 23503
      const { error: badStudentErr } = await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: randomUUID(),
        concept_id: course.conceptIds[0],
        source: "star",
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(badStudentErr).not.toBeNull();
      expect(badStudentErr?.code).toBe("23503");

      // Nonexistent concept fails 23503
      const { error: badConceptErr } = await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: student.id,
        concept_id: randomUUID(),
        source: "star",
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(badConceptErr).not.toBeNull();
      expect(badConceptErr?.code).toBe("23503");

    });

    it("verifies quiz_attempts: nullable encounter_id uniqueness, delete encounter sets encounter_id NULL", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      // Two legacy attempts with NULL encounter_id succeed
      const attempt1Id = randomUUID();
      const attempt2Id = randomUUID();
      const { error: att1Err } = await harness.serviceClient.from("quiz_attempts").insert({
        id: attempt1Id,
        student_id: student.id,
        concept_id: course.conceptIds[0],
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [{ questionId: randomUUID(), selected: 1 }],
        encounter_id: null,
      });
      expect(att1Err).toBeNull();

      const { error: att2Err } = await harness.serviceClient.from("quiz_attempts").insert({
        id: attempt2Id,
        student_id: student.id,
        concept_id: course.conceptIds[0],
        score: 1.0,
        correct_count: 5,
        total_questions: 5,
        submitted_answers: [{ questionId: randomUUID(), selected: 0 }],
        encounter_id: null,
      });
      expect(att2Err).toBeNull();

      // Create encounter and attempt linked to it
      const encounterId = randomUUID();
      await harness.serviceClient.from("encounters").insert({
        id: encounterId,
        student_id: student.id,
        concept_id: course.conceptIds[0],
        source: "star",
        question_ids: [randomUUID()],
        option_permutations: {},
      });

      const attempt3Id = randomUUID();
      const { error: att3Err } = await harness.serviceClient.from("quiz_attempts").insert({
        id: attempt3Id,
        student_id: student.id,
        concept_id: course.conceptIds[0],
        score: 0.6,
        correct_count: 3,
        total_questions: 5,
        submitted_answers: [],
        encounter_id: encounterId,
      });
      expect(att3Err).toBeNull();

      // Second attempt referring to same encounter fails uniqueness 23505
      const { error: dupEncounterAttemptErr } = await harness.serviceClient.from("quiz_attempts").insert({
        id: randomUUID(),
        student_id: student.id,
        concept_id: course.conceptIds[0],
        score: 0.4,
        correct_count: 2,
        total_questions: 5,
        submitted_answers: [],
        encounter_id: encounterId,
      });
      expect(dupEncounterAttemptErr).not.toBeNull();
      expect(dupEncounterAttemptErr?.code).toBe("23505");

      // Deleting encounter preserves quiz attempt and sets encounter_id to NULL
      const { error: delEncounterErr } = await harness.serviceClient
        .from("encounters")
        .delete()
        .eq("id", encounterId);
      expect(delEncounterErr).toBeNull();

      const { data: attempt3Rows } = await harness.serviceClient
        .from("quiz_attempts")
        .select("id, encounter_id")
        .eq("id", attempt3Id);
      expect(attempt3Rows).toHaveLength(1);
      expect(attempt3Rows![0].encounter_id).toBeNull();
    });

    it("verifies xp_events exact-once rules (INV-XP06) and positive amount", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      const awardDate = "2026-10-21";
      const source1 = randomUUID();

      // Practice reward: student, concept, date
      const { error: xp1Err } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 88,
        reason: "encounter",
        source_id: source1,
        award_date: awardDate,
        concept_id: course.conceptIds[0],
      });
      expect(xp1Err).toBeNull();

      // Duplication for same student/concept/date fails even with new source_id
      const { error: dupPracticeErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 88,
        reason: "encounter",
        source_id: randomUUID(),
        award_date: awardDate,
        concept_id: course.conceptIds[0],
      });
      expect(dupPracticeErr).not.toBeNull();
      expect(dupPracticeErr?.code).toBe("23505");

      // Same student/next date succeeds
      const { error: nextDatePracticeErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 88,
        reason: "encounter",
        source_id: randomUUID(),
        award_date: "2026-10-22",
        concept_id: course.conceptIds[0],
      });
      expect(nextDatePracticeErr).toBeNull();

      // Quest-clear reward: student, award_date
      const { error: questXpErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 100,
        reason: "quest_cleared",
        source_id: randomUUID(),
        award_date: awardDate,
      });
      expect(questXpErr).toBeNull();

      // Duplicate quest-clear reward on same date fails
      const { error: dupQuestXpErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 100,
        reason: "quest_cleared",
        source_id: randomUUID(),
        award_date: awardDate,
      });
      expect(dupQuestXpErr).not.toBeNull();
      expect(dupQuestXpErr?.code).toBe("23505");

      // Party reward: student, source_id
      const partyQuestId = randomUUID();
      const { error: partyXpErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 50,
        reason: "party",
        source_id: partyQuestId,
        award_date: awardDate,
      });
      expect(partyXpErr).toBeNull();

      // Duplicate party reward with same source_id fails even on different date
      const { error: dupPartyXpErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 50,
        reason: "party",
        source_id: partyQuestId,
        award_date: "2026-10-25",
      });
      expect(dupPartyXpErr).not.toBeNull();
      expect(dupPartyXpErr?.code).toBe("23505");

      // Zero and negative amount fail 23514
      const { error: zeroAmtErr } = await harness.serviceClient.from("xp_events").insert({
        student_id: student.id,
        amount: 0,
        reason: "encounter",
        source_id: randomUUID(),
        award_date: "2026-10-30",
        concept_id: course.conceptIds[1],
      });
      expect(zeroAmtErr).not.toBeNull();
      expect(zeroAmtErr?.code).toBe("23514");

      // Sum equals 88 + 88 + 100 + 50 = 326
      const { data: xpSumRows } = await harness.serviceClient
        .from("xp_events")
        .select("amount")
        .eq("student_id", student.id);
      const totalXp = xpSumRows?.reduce((sum, r) => sum + r.amount, 0);
      expect(totalXp).toBe(326);
    });

    it("verifies RLS and immutable ledger permissions (anon/authenticated denied 42501, service_role immutable on xp_events/quiz_attempts)", async () => {
      // Authenticated role denial via SET LOCAL ROLE in transaction
      const authDenySql = `
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT * FROM public.daily_quests;
        ROLLBACK;
      `;
      const authErr = runPsqlExpectError(authDenySql);
      expect(authErr).toContain("permission denied");
      expect(authErr).toContain("42501");

      // Anon denial
      const anonDenySql = `
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT * FROM public.xp_events;
        ROLLBACK;
      `;
      const anonErr = runPsqlExpectError(anonDenySql);
      expect(anonErr).toContain("permission denied");
      expect(anonErr).toContain("42501");

      // Service role UPDATE on xp_events denied 42501
      const updateXpSql = `
        BEGIN;
        SET LOCAL ROLE service_role;
        UPDATE public.xp_events SET amount = 999;
        ROLLBACK;
      `;
      const updateXpErr = runPsqlExpectError(updateXpSql);
      expect(updateXpErr).toContain("permission denied");
      expect(updateXpErr).toContain("42501");

      // Service role DELETE on quiz_attempts denied 42501
      const deleteQuizAttemptSql = `
        BEGIN;
        SET LOCAL ROLE service_role;
        DELETE FROM public.quiz_attempts;
        ROLLBACK;
      `;
      const deleteAttemptErr = runPsqlExpectError(deleteQuizAttemptSql);
      expect(deleteAttemptErr).toContain("permission denied");
      expect(deleteAttemptErr).toContain("42501");
    });

    it("verifies cascading deletions and SET NULL behavior on student, quest, and concept deletion", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      // Create quest, encounter, attempt, xp_event
      const questId = randomUUID();
      await harness.serviceClient.from("daily_quests").insert({
        id: questId,
        student_id: student.id,
        quest_date: "2026-10-21",
        concept_ids: course.conceptIds,
      });

      const encounterId = randomUUID();
      await harness.serviceClient.from("encounters").insert({
        id: encounterId,
        student_id: student.id,
        concept_id: course.conceptIds[0],
        source: "daily",
        quest_id: questId,
        question_ids: [randomUUID()],
        option_permutations: {},
      });

      // Deleting quest sets encounters.quest_id to NULL
      const { error: delQuestErr } = await harness.serviceClient
        .from("daily_quests")
        .delete()
        .eq("id", questId);
      expect(delQuestErr).toBeNull();

      const { data: encRows } = await harness.serviceClient
        .from("encounters")
        .select("quest_id")
        .eq("id", encounterId);
      expect(encRows![0].quest_id).toBeNull();

      // Insert xp event linked to concept
      const xpId = randomUUID();
      await harness.serviceClient.from("xp_events").insert({
        id: xpId,
        student_id: student.id,
        amount: 88,
        reason: "encounter",
        source_id: randomUUID(),
        award_date: "2026-10-21",
        concept_id: course.conceptIds[0],
      });

      // Concept deletion nulls xp_events.concept_id without removing the ledger row
      const { error: delConceptErr } = await harness.serviceClient
        .from("concept_nodes")
        .delete()
        .eq("id", course.conceptIds[0]);
      expect(delConceptErr).toBeNull();

      const { data: xpRows } = await harness.serviceClient
        .from("xp_events")
        .select("id, concept_id, amount")
        .eq("id", xpId);
      expect(xpRows).toHaveLength(1);
      expect(xpRows![0].concept_id).toBeNull();
      expect(xpRows![0].amount).toBe(88);

      // Student deletion cascades owned encounter and XP rows
      const { error: delStudentErr } = await harness.serviceClient
        .from("students")
        .delete()
        .eq("id", student.id);
      expect(delStudentErr).toBeNull();

      const { data: survivingEnc } = await harness.serviceClient
        .from("encounters")
        .select("id")
        .eq("student_id", student.id);
      expect(survivingEnc).toHaveLength(0);

      const { data: survivingXp } = await harness.serviceClient
        .from("xp_events")
        .select("id")
        .eq("student_id", student.id);
      expect(survivingXp).toHaveLength(0);
    });

    it("verifies single mastery writer: inserting game/xp rows causes no implicit writes to student_mastery or mastery_evidence", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      // Snapshot mastery before
      const { data: masteryBefore } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id);
      const { data: evidenceBefore } = await harness.serviceClient
        .from("mastery_evidence")
        .select("*")
        .eq("student_id", student.id);

      // Insert encounter and xp event
      await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: student.id,
        concept_id: course.conceptIds[0],
        source: "star",
        question_ids: [randomUUID()],
        option_permutations: {},
      });

      await harness.serviceClient.from("xp_events").insert({
        id: randomUUID(),
        student_id: student.id,
        amount: 88,
        reason: "encounter",
        source_id: randomUUID(),
        award_date: "2026-10-21",
        concept_id: course.conceptIds[0],
      });

      // Snapshot mastery after
      const { data: masteryAfter } = await harness.serviceClient
        .from("student_mastery")
        .select("*")
        .eq("student_id", student.id);
      const { data: evidenceAfter } = await harness.serviceClient
        .from("mastery_evidence")
        .select("*")
        .eq("student_id", student.id);

      expect(masteryAfter).toEqual(masteryBefore);
      expect(evidenceAfter).toEqual(evidenceBefore);
    });
  }
);
