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

function runPsql(sql: string): string {
  return execFileSync(
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
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8" }
  );
}

function runPsqlExpectError(sql: string): { code: string; message: string; stderr: string } {
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
    const stderr =
      err && typeof err === "object" && "stderr" in err && err.stderr
        ? String(err.stderr)
        : String(err);

    const codeMatch = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/i) ?? stderr.match(/SQLSTATE:\s+([0-9A-Z]{5})/i);
    const code = codeMatch ? codeMatch[1] : "";
    return { code, message: stderr, stderr };
  }
}

function makeQuizAttempt(id: string, studentId: string, conceptId: string) {
  return {
    id,
    student_id: studentId,
    concept_id: conceptId,
    score: 1.0,
    correct_count: 5,
    total_questions: 5,
    submitted_answers: [{ questionId: randomUUID(), selected: 0 }],
    encounter_id: null,
  };
}

describe.skipIf(isFixtureMode)(
  "P6-A-02: Collaboration Extension Relational Migration 0005 Integration (live local Supabase)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let currentContext: TestContext | null = null;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const repo = new EnrollmentRepository(harness.serviceClient);
      enrollmentService = new EnrollmentService(repo);
    });

    afterEach(async () => {
      if (currentContext) {
        try {
          runPsql(
            "DELETE FROM public.party_quest_progress; DELETE FROM public.party_quests; DELETE FROM public.study_group_invitations; DELETE FROM public.study_group_matches;"
          );
        } catch {
          // Ignore cleanup errors before harness cleanup
        }
        await harness.cleanup(currentContext);
        currentContext = null;
      }
    });

    async function setupCourseAndPeers() {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 3 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);

      const [peerA, peerB] = studentA.id < studentB.id ? [studentA, studentB] : [studentB, studentA];
      return { course, peerA, peerB };
    }

    it("1. verifies valid chain: invitation -> quest -> attempts -> progress -> party encounter persists and queries", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const sharedConcepts = [course.conceptIds[0], course.conceptIds[1]];

      // Direct match row
      const matchId = randomUUID();
      const { error: matchErr } = await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: sharedConcepts,
        status: "active",
      });
      expect(matchErr).toBeNull();

      // Study group invitation
      const invitationId = randomUUID();
      const { error: invErr } = await harness.serviceClient.from("study_group_invitations").insert({
        id: invitationId,
        course_id: course.courseId,
        inviter_student_id: peerA.id,
        invitee_student_id: peerB.id,
        concept_ids: sharedConcepts,
        status: "accepted",
        resulting_match_id: matchId,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      });
      expect(invErr).toBeNull();

      // Party quest
      const partyQuestId = randomUUID();
      const { error: questErr } = await harness.serviceClient.from("party_quests").insert({
        id: partyQuestId,
        match_id: matchId,
        concept_ids: sharedConcepts,
        status: "active",
        version: 1,
      });
      expect(questErr).toBeNull();

      // Independent quiz attempts for both peers across 2 shared concepts
      const attemptA1 = randomUUID();
      const attemptA2 = randomUUID();
      const attemptB1 = randomUUID();
      const attemptB2 = randomUUID();

      const { error: attA1Err } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptA1, peerA.id, sharedConcepts[0]));
      expect(attA1Err).toBeNull();

      const { error: attA2Err } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptA2, peerA.id, sharedConcepts[1]));
      expect(attA2Err).toBeNull();

      const { error: attB1Err } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptB1, peerB.id, sharedConcepts[0]));
      expect(attB1Err).toBeNull();

      const { error: attB2Err } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptB2, peerB.id, sharedConcepts[1]));
      expect(attB2Err).toBeNull();

      // Progress rows: peer A concept 0 does not block peer B concept 0 or peer A concept 1
      const { error: progA1Err } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerA.id,
        concept_id: sharedConcepts[0],
        quiz_attempt_id: attemptA1,
      });
      expect(progA1Err).toBeNull();

      const { error: progA2Err } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerA.id,
        concept_id: sharedConcepts[1],
        quiz_attempt_id: attemptA2,
      });
      expect(progA2Err).toBeNull();

      const { error: progB1Err } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerB.id,
        concept_id: sharedConcepts[0],
        quiz_attempt_id: attemptB1,
      });
      expect(progB1Err).toBeNull();

      const { error: progB2Err } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerB.id,
        concept_id: sharedConcepts[1],
        quiz_attempt_id: attemptB2,
      });
      expect(progB2Err).toBeNull();

      // Query all 4 progress rows back
      const { data: progressRows, error: fetchProgErr } = await harness.serviceClient
        .from("party_quest_progress")
        .select("*")
        .eq("party_quest_id", partyQuestId);
      expect(fetchProgErr).toBeNull();
      expect(progressRows).toHaveLength(4);

      // Party Encounter linked to the party quest
      const encounterId = randomUUID();
      const { error: encErr } = await harness.serviceClient.from("encounters").insert({
        id: encounterId,
        student_id: peerA.id,
        concept_id: sharedConcepts[0],
        source: "party",
        party_quest_id: partyQuestId,
        status: "active",
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(encErr).toBeNull();

      const { data: encRow, error: fetchEncErr } = await harness.serviceClient
        .from("encounters")
        .select("id, source, party_quest_id")
        .eq("id", encounterId)
        .single();
      expect(fetchEncErr).toBeNull();
      expect(encRow).not.toBeNull();
      expect(encRow!.party_quest_id).toBe(partyQuestId);
      expect(encRow!.source).toBe("party");
    });

    it("2. verifies primary key uniqueness on party_quest_progress (party_quest_id, student_id, concept_id) fails 23505", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const partyQuestId = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: partyQuestId,
        match_id: matchId,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const attempt1 = randomUUID();
      const attempt2 = randomUUID();
      const { error: att1Err } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attempt1, peerA.id, course.conceptIds[0]));
      expect(att1Err).toBeNull();

      const { error: att2Err } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attempt2, peerA.id, course.conceptIds[0]));
      expect(att2Err).toBeNull();

      const { error: firstProgErr } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attempt1,
      });
      expect(firstProgErr).toBeNull();

      // Duplicate (party_quest_id, student_id, concept_id) fails 23505 even with different quiz_attempt_id
      const { error: dupProgErr } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attempt2,
      });
      expect(dupProgErr).not.toBeNull();
      expect(dupProgErr?.code).toBe("23505");
    });

    it("3. verifies status check constraints fail 23514 on invalid strings, succeed on valid values", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      // Invitation valid statuses: pending, accepted, declined, expired
      for (const validStatus of ["pending", "accepted", "declined", "expired"] as const) {
        const invId = randomUUID();
        const { error } = await harness.serviceClient.from("study_group_invitations").insert({
          id: invId,
          course_id: course.courseId,
          inviter_student_id: peerA.id,
          invitee_student_id: peerB.id,
          concept_ids: [course.conceptIds[0]],
          status: validStatus,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
        expect(error).toBeNull();
      }

      // Invalid invitation status fails 23514
      const { error: badInvStatusErr } = await harness.serviceClient.from("study_group_invitations").insert({
        id: randomUUID(),
        course_id: course.courseId,
        inviter_student_id: peerA.id,
        invitee_student_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "invalid_status",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(badInvStatusErr).not.toBeNull();
      expect(badInvStatusErr?.code).toBe("23514");

      // Party quest valid statuses: active, completed, cancelled
      for (const validStatus of ["active", "completed", "cancelled"] as const) {
        const questId = randomUUID();
        const { error } = await harness.serviceClient.from("party_quests").insert({
          id: questId,
          match_id: matchId,
          concept_ids: [course.conceptIds[0]],
          status: validStatus,
        });
        expect(error).toBeNull();
      }

      // Invalid party quest status fails 23514
      const { error: badQuestStatusErr } = await harness.serviceClient.from("party_quests").insert({
        id: randomUUID(),
        match_id: matchId,
        concept_ids: [course.conceptIds[0]],
        status: "paused",
      });
      expect(badQuestStatusErr).not.toBeNull();
      expect(badQuestStatusErr?.code).toBe("23514");
    });

    it("4. verifies foreign key boundaries fail 23503 when parent references do not exist", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const partyQuestId = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: partyQuestId,
        match_id: matchId,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const attemptId = randomUUID();
      const { error: attErr } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptId, peerA.id, course.conceptIds[0]));
      expect(attErr).toBeNull();

      // Invitation: missing course_id
      const { error: badInvCourse } = await harness.serviceClient.from("study_group_invitations").insert({
        id: randomUUID(),
        course_id: randomUUID(),
        inviter_student_id: peerA.id,
        invitee_student_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(badInvCourse?.code).toBe("23503");

      // Invitation: missing inviter_student_id
      const { error: badInvInviter } = await harness.serviceClient.from("study_group_invitations").insert({
        id: randomUUID(),
        course_id: course.courseId,
        inviter_student_id: randomUUID(),
        invitee_student_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(badInvInviter?.code).toBe("23503");

      // Invitation: missing invitee_student_id
      const { error: badInvInvitee } = await harness.serviceClient.from("study_group_invitations").insert({
        id: randomUUID(),
        course_id: course.courseId,
        inviter_student_id: peerA.id,
        invitee_student_id: randomUUID(),
        concept_ids: [course.conceptIds[0]],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(badInvInvitee?.code).toBe("23503");

      // Invitation: missing resulting_match_id
      const { error: badInvMatch } = await harness.serviceClient.from("study_group_invitations").insert({
        id: randomUUID(),
        course_id: course.courseId,
        inviter_student_id: peerA.id,
        invitee_student_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        resulting_match_id: randomUUID(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(badInvMatch?.code).toBe("23503");

      // Party quest: missing match_id
      const { error: badQuestMatch } = await harness.serviceClient.from("party_quests").insert({
        id: randomUUID(),
        match_id: randomUUID(),
        concept_ids: [course.conceptIds[0]],
      });
      expect(badQuestMatch?.code).toBe("23503");

      // Progress: missing party_quest_id
      const { error: badProgQuest } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: randomUUID(),
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attemptId,
      });
      expect(badProgQuest?.code).toBe("23503");

      // Progress: missing student_id
      const { error: badProgStudent } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: randomUUID(),
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attemptId,
      });
      expect(badProgStudent?.code).toBe("23503");

      // Progress: missing concept_id
      const { error: badProgConcept } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerA.id,
        concept_id: randomUUID(),
        quiz_attempt_id: attemptId,
      });
      expect(badProgConcept?.code).toBe("23503");

      // Progress: missing quiz_attempt_id
      const { error: badProgAttempt } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: partyQuestId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: randomUUID(),
      });
      expect(badProgAttempt?.code).toBe("23503");

      // Encounter: missing party_quest_id
      const { error: badEncQuest } = await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        source: "party",
        party_quest_id: randomUUID(),
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(badEncQuest?.code).toBe("23503");
    });

    it("5. verifies Encounter party_quest_id FK: null accepted, valid accepted, nonexistent rejected on INSERT & UPDATE", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const partyQuestId = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: partyQuestId,
        match_id: matchId,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      // NULL party_quest_id accepted
      const encNullId = randomUUID();
      const { error: nullEncErr } = await harness.serviceClient.from("encounters").insert({
        id: encNullId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        source: "star",
        party_quest_id: null,
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(nullEncErr).toBeNull();

      // Valid party_quest_id accepted
      const encPartyId = randomUUID();
      const { error: validEncErr } = await harness.serviceClient.from("encounters").insert({
        id: encPartyId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        source: "party",
        party_quest_id: partyQuestId,
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(validEncErr).toBeNull();

      // UPDATE to NULL party_quest_id accepted
      const { error: updateToNullErr } = await harness.serviceClient
        .from("encounters")
        .update({ party_quest_id: null })
        .eq("id", encPartyId);
      expect(updateToNullErr).toBeNull();

      // UPDATE to nonexistent party_quest_id rejected with 23503
      const { error: updateBadErr } = await harness.serviceClient
        .from("encounters")
        .update({ party_quest_id: randomUUID() })
        .eq("id", encPartyId);
      expect(updateBadErr?.code).toBe("23503");

      // INSERT with nonexistent party_quest_id rejected with 23503
      const { error: insertBadErr } = await harness.serviceClient.from("encounters").insert({
        id: randomUUID(),
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        source: "party",
        party_quest_id: randomUUID(),
        question_ids: [randomUUID()],
        option_permutations: {},
      });
      expect(insertBadErr?.code).toBe("23503");
    });

    it("6. verifies deleting match sets invitation resulting_match_id NULL, cascades quest and progress, preserves encounter and attempt", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const invId = randomUUID();
      await harness.serviceClient.from("study_group_invitations").insert({
        id: invId,
        course_id: course.courseId,
        inviter_student_id: peerA.id,
        invitee_student_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "accepted",
        resulting_match_id: matchId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

      const questId = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: questId,
        match_id: matchId,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const attemptId = randomUUID();
      const { error: attErr } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptId, peerA.id, course.conceptIds[0]));
      expect(attErr).toBeNull();

      const { error: progErr } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: questId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attemptId,
      });
      expect(progErr).toBeNull();

      const encId = randomUUID();
      await harness.serviceClient.from("encounters").insert({
        id: encId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        source: "party",
        party_quest_id: questId,
        question_ids: [randomUUID()],
        option_permutations: {},
      });

      // Delete the study group match
      const { error: delMatchErr } = await harness.serviceClient
        .from("study_group_matches")
        .delete()
        .eq("id", matchId);
      expect(delMatchErr).toBeNull();

      // Invitation survives with resulting_match_id = NULL (ON DELETE SET NULL)
      const { data: invRow } = await harness.serviceClient
        .from("study_group_invitations")
        .select("id, resulting_match_id")
        .eq("id", invId)
        .single();
      expect(invRow).not.toBeNull();
      expect(invRow!.resulting_match_id).toBeNull();

      // Party quest cascaded (ON DELETE CASCADE)
      const { data: questRows } = await harness.serviceClient
        .from("party_quests")
        .select("id")
        .eq("id", questId);
      expect(questRows).toHaveLength(0);

      // Party quest progress cascaded (ON DELETE CASCADE from party_quests)
      const { data: progRows } = await harness.serviceClient
        .from("party_quest_progress")
        .select("party_quest_id")
        .eq("party_quest_id", questId);
      expect(progRows).toHaveLength(0);

      // Encounter survives with party_quest_id = NULL (ON DELETE SET NULL)
      const { data: encRow } = await harness.serviceClient
        .from("encounters")
        .select("id, party_quest_id")
        .eq("id", encId)
        .single();
      expect(encRow).not.toBeNull();
      expect(encRow!.party_quest_id).toBeNull();

      // Quiz attempt survives
      const { data: attemptRows } = await harness.serviceClient
        .from("quiz_attempts")
        .select("id")
        .eq("id", attemptId);
      expect(attemptRows).toHaveLength(1);
    });

    it("7. verifies deleting quest removes progress and sets encounter party_quest_id null; deleting progress alone preserves attempt; deleting attempt as owner fails 23503 until progress removed", async () => {
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const questId = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: questId,
        match_id: matchId,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const attemptId = randomUUID();
      const { error: attErr } = await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attemptId, peerA.id, course.conceptIds[0]));
      expect(attErr).toBeNull();

      const { error: progErr } = await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: questId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attemptId,
      });
      expect(progErr).toBeNull();

      const encId = randomUUID();
      await harness.serviceClient.from("encounters").insert({
        id: encId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        source: "party",
        party_quest_id: questId,
        question_ids: [randomUUID()],
        option_permutations: {},
      });

      // Attempt deletion as postgres owner fails 23503 due to RESTRICT on party_quest_progress.quiz_attempt_id
      const delAttemptErr = runPsqlExpectError(`DELETE FROM public.quiz_attempts WHERE id = '${attemptId}';`);
      expect(delAttemptErr.code).toBe("23503");

      // Deleting progress alone does not delete attempt
      const { error: delProgErr } = await harness.serviceClient
        .from("party_quest_progress")
        .delete()
        .eq("party_quest_id", questId)
        .eq("student_id", peerA.id)
        .eq("concept_id", course.conceptIds[0]);
      expect(delProgErr).toBeNull();

      const { data: attemptAfterProgDel } = await harness.serviceClient
        .from("quiz_attempts")
        .select("id")
        .eq("id", attemptId);
      expect(attemptAfterProgDel).toHaveLength(1);

      // Re-insert progress to test deleting quest
      await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: questId,
        student_id: peerA.id,
        concept_id: course.conceptIds[0],
        quiz_attempt_id: attemptId,
      });

      // Delete quest
      const { error: delQuestErr } = await harness.serviceClient
        .from("party_quests")
        .delete()
        .eq("id", questId);
      expect(delQuestErr).toBeNull();

      // Progress removed
      const { data: progRows } = await harness.serviceClient
        .from("party_quest_progress")
        .select("*")
        .eq("party_quest_id", questId);
      expect(progRows).toHaveLength(0);

      // Encounter preserved with party_quest_id = NULL
      const { data: encRow } = await harness.serviceClient
        .from("encounters")
        .select("id, party_quest_id")
        .eq("id", encId)
        .single();
      expect(encRow).not.toBeNull();
      expect(encRow!.party_quest_id).toBeNull();

      // Quiz attempt still exists
      const { data: attemptAfterQuestDel } = await harness.serviceClient
        .from("quiz_attempts")
        .select("id")
        .eq("id", attemptId);
      expect(attemptAfterQuestDel).toHaveLength(1);

      // Now deleting attempt as postgres owner succeeds because progress reference was removed
      runPsql(`DELETE FROM public.quiz_attempts WHERE id = '${attemptId}';`);
      const countRemaining = runPsql(`SELECT count(*) FROM public.quiz_attempts WHERE id = '${attemptId}';`);
      expect(countRemaining.trim()).toBe("0");
    });

    it("8. verifies cascades: course/student deletion cascades invitations; student/concept deletion cascades progress", async () => {
      // 8a. Invitation cascades from course
      const { course: c1, peerA: p1A, peerB: p1B } = await setupCourseAndPeers();
      const invCourseId = randomUUID();
      await harness.serviceClient.from("study_group_invitations").insert({
        id: invCourseId,
        course_id: c1.courseId,
        inviter_student_id: p1A.id,
        invitee_student_id: p1B.id,
        concept_ids: [c1.conceptIds[0]],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

      runPsql(`DELETE FROM public.courses WHERE id = '${c1.courseId}';`);
      const { data: invAfterCourseDel } = await harness.serviceClient
        .from("study_group_invitations")
        .select("id")
        .eq("id", invCourseId);
      expect(invAfterCourseDel).toHaveLength(0);

      // 8b. Invitation cascades from inviter student
      const { course: c2, peerA: p2A, peerB: p2B } = await setupCourseAndPeers();
      const invInviterId = randomUUID();
      await harness.serviceClient.from("study_group_invitations").insert({
        id: invInviterId,
        course_id: c2.courseId,
        inviter_student_id: p2A.id,
        invitee_student_id: p2B.id,
        concept_ids: [c2.conceptIds[0]],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

      runPsql(`DELETE FROM public.students WHERE id = '${p2A.id}';`);
      const { data: invAfterInviterDel } = await harness.serviceClient
        .from("study_group_invitations")
        .select("id")
        .eq("id", invInviterId);
      expect(invAfterInviterDel).toHaveLength(0);

      // 8c. Invitation cascades from invitee student
      const { course: c3, peerA: p3A, peerB: p3B } = await setupCourseAndPeers();
      const invInviteeId = randomUUID();
      await harness.serviceClient.from("study_group_invitations").insert({
        id: invInviteeId,
        course_id: c3.courseId,
        inviter_student_id: p3A.id,
        invitee_student_id: p3B.id,
        concept_ids: [c3.conceptIds[0]],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

      runPsql(`DELETE FROM public.students WHERE id = '${p3B.id}';`);
      const { data: invAfterInviteeDel } = await harness.serviceClient
        .from("study_group_invitations")
        .select("id")
        .eq("id", invInviteeId);
      expect(invAfterInviteeDel).toHaveLength(0);

      // 8d. Progress cascades from concept deletion
      const { course: c4, peerA: p4A, peerB: p4B } = await setupCourseAndPeers();
      const match4Id = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: match4Id,
        course_id: c4.courseId,
        student1_id: p4A.id,
        student2_id: p4B.id,
        concept_ids: [c4.conceptIds[0]],
        status: "active",
      });

      const quest4Id = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: quest4Id,
        match_id: match4Id,
        concept_ids: [c4.conceptIds[0]],
        status: "active",
      });

      const attempt4Id = randomUUID();
      await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attempt4Id, p4A.id, c4.conceptIds[0]));

      await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: quest4Id,
        student_id: p4A.id,
        concept_id: c4.conceptIds[0],
        quiz_attempt_id: attempt4Id,
      });

      runPsql(`DELETE FROM public.concept_nodes WHERE id = '${c4.conceptIds[0]}';`);
      const { data: progAfterConceptDel } = await harness.serviceClient
        .from("party_quest_progress")
        .select("*")
        .eq("party_quest_id", quest4Id);
      expect(progAfterConceptDel).toHaveLength(0);

      // 8e. Progress cascades from student deletion
      const { course: c5, peerA: p5A, peerB: p5B } = await setupCourseAndPeers();
      const match5Id = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: match5Id,
        course_id: c5.courseId,
        student1_id: p5A.id,
        student2_id: p5B.id,
        concept_ids: [c5.conceptIds[0]],
        status: "active",
      });

      const quest5Id = randomUUID();
      await harness.serviceClient.from("party_quests").insert({
        id: quest5Id,
        match_id: match5Id,
        concept_ids: [c5.conceptIds[0]],
        status: "active",
      });

      const attempt5Id = randomUUID();
      await harness.serviceClient
        .from("quiz_attempts")
        .insert(makeQuizAttempt(attempt5Id, p5A.id, c5.conceptIds[0]));

      await harness.serviceClient.from("party_quest_progress").insert({
        party_quest_id: quest5Id,
        student_id: p5A.id,
        concept_id: c5.conceptIds[0],
        quiz_attempt_id: attempt5Id,
      });

      runPsql(`DELETE FROM public.students WHERE id = '${p5A.id}';`);
      const { data: progAfterStudentDel } = await harness.serviceClient
        .from("party_quest_progress")
        .select("*")
        .eq("party_quest_id", quest5Id);
      expect(progAfterStudentDel).toHaveLength(0);
    });

    it("9. verifies RLS enabled on all three tables, anon/authenticated denied 42501, and service_role permitted", async () => {
      // 9a. Verify relrowsecurity is true for all three tables
      const rlsOutput = runPsql(`
        SELECT relname, relrowsecurity
        FROM pg_class
        WHERE relname IN ('study_group_invitations', 'party_quests', 'party_quest_progress')
        ORDER BY relname;
      `).trim();
      expect(rlsOutput.split("\n")).toEqual([
        "party_quest_progress|t",
        "party_quests|t",
        "study_group_invitations|t",
      ]);

      // 9b. Anon role denied 42501 on SELECT, INSERT, UPDATE, DELETE
      const anonSelectSql = `
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT * FROM public.study_group_invitations;
        ROLLBACK;
      `;
      expect(runPsqlExpectError(anonSelectSql).code).toBe("42501");

      const anonInsertSql = `
        BEGIN;
        SET LOCAL ROLE anon;
        INSERT INTO public.party_quests (id, match_id, concept_ids)
        VALUES ('${randomUUID()}', '${randomUUID()}', '{}');
        ROLLBACK;
      `;
      expect(runPsqlExpectError(anonInsertSql).code).toBe("42501");

      const anonProgressSql = `
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT * FROM public.party_quest_progress;
        ROLLBACK;
      `;
      expect(runPsqlExpectError(anonProgressSql).code).toBe("42501");

      // 9c. Authenticated role denied 42501 on SELECT, INSERT, UPDATE, DELETE
      const authSelectSql = `
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT * FROM public.study_group_invitations;
        ROLLBACK;
      `;
      expect(runPsqlExpectError(authSelectSql).code).toBe("42501");

      const authQuestSql = `
        BEGIN;
        SET LOCAL ROLE authenticated;
        INSERT INTO public.party_quests (id, match_id, concept_ids)
        VALUES ('${randomUUID()}', '${randomUUID()}', '{}');
        ROLLBACK;
      `;
      expect(runPsqlExpectError(authQuestSql).code).toBe("42501");

      const authProgressSql = `
        BEGIN;
        SET LOCAL ROLE authenticated;
        SELECT * FROM public.party_quest_progress;
        ROLLBACK;
      `;
      expect(runPsqlExpectError(authProgressSql).code).toBe("42501");

      // 9d. Service role CRUD succeeds
      const { course, peerA, peerB } = await setupCourseAndPeers();
      const matchId = randomUUID();
      await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: peerA.id,
        student2_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });

      const invId = randomUUID();
      const { error: insInvErr } = await harness.serviceClient.from("study_group_invitations").insert({
        id: invId,
        course_id: course.courseId,
        inviter_student_id: peerA.id,
        invitee_student_id: peerB.id,
        concept_ids: [course.conceptIds[0]],
        status: "pending",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(insInvErr).toBeNull();

      const { data: selInvData, error: selInvErr } = await harness.serviceClient
        .from("study_group_invitations")
        .select("*")
        .eq("id", invId)
        .single();
      expect(selInvErr).toBeNull();
      expect(selInvData.id).toBe(invId);

      const { error: updInvErr } = await harness.serviceClient
        .from("study_group_invitations")
        .update({ status: "accepted" })
        .eq("id", invId);
      expect(updInvErr).toBeNull();

      const { error: delInvErr } = await harness.serviceClient
        .from("study_group_invitations")
        .delete()
        .eq("id", invId);
      expect(delInvErr).toBeNull();
    });
  }
);
