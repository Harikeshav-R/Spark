import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository";
import {
  DB_CONTAINER,
  runPsql,
  runPsqlExpectError,
} from "./postgres-test-helpers";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";


function sleep(ms: number): Promise<void> {
  // Real clock wait required for polling external PostgreSQL engine lock-table in Docker
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitForLock(appName: string, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const output = runPsql(
      `SELECT count(*) FROM pg_stat_activity WHERE application_name = '${appName}' AND wait_event_type = 'Lock';`
    ).trim();
    if (Number(output) > 0) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

function spawnPsqlSession(): {
  child: ChildProcess;
  output: { stdout: string; stderr: string };
  waitForOutput: (marker: string, timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
} {
  const child = spawn("docker", [
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
  ]);

  const output = { stdout: "", stderr: "" };
  const pendingWatchers: Array<{
    marker: string;
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  const checkWatchers = () => {
    for (let i = pendingWatchers.length - 1; i >= 0; i--) {
      const watcher = pendingWatchers[i];
      if (output.stdout.includes(watcher.marker) || output.stderr.includes(watcher.marker)) {
        clearTimeout(watcher.timer);
        pendingWatchers.splice(i, 1);
        watcher.resolve();
      }
    }
  };

  child.stdin?.on("error", () => {
    // Ignore EPIPE / stream errors if psql exits early on error
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output.stdout += chunk.toString("utf8");
    checkWatchers();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output.stderr += chunk.toString("utf8");
    checkWatchers();
  });
  child.on("exit", (code) => {
    for (const watcher of pendingWatchers.splice(0)) {
      clearTimeout(watcher.timer);
      if (output.stdout.includes(watcher.marker) || output.stderr.includes(watcher.marker)) {
        watcher.resolve();
      } else {
        watcher.reject(
          new Error(`psql process exited with code ${code} while waiting for '${watcher.marker}'. stderr: ${output.stderr}`)
        );
      }
    }
  });

  const waitForOutput = (marker: string, timeoutMs = 15000): Promise<void> => {
    if (output.stdout.includes(marker) || output.stderr.includes(marker)) {
      return Promise.resolve();
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      const idx = pendingWatchers.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) {
        pendingWatchers.splice(idx, 1);
      }
      reject(new Error(`Timed out waiting for marker '${marker}' in psql output. Output: ${output.stdout}, Stderr: ${output.stderr}`));
    }, timeoutMs);

    pendingWatchers.push({ marker, resolve, reject, timer });
    return promise;
  };
  const close = async (): Promise<void> => {
    try {
      if (child.exitCode === null && child.stdin?.writable) {
        child.stdin.end();
      }
    } catch {
      // ignore
    }
    if (child.exitCode === null) {
      child.kill();
    }
  };

  return { child, output, waitForOutput, close };
}

describe.skipIf(isFixtureMode)(
  "P6-A-01: Study Group Relational Schema and Atomic Pairing (live local Supabase)",
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

    it("1. availability boundaries: accepts >= 30m, rejects shorter/reversed with 23514, cascades on delete", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const studentUser = await harness.createTestUser(currentContext, "student");
      const actor = harness.buildStudentActor(studentUser);
      const student = await enrollmentService.enrollStudent(actor, course.joinCode);

      const startsAt = "2026-10-25T10:00:00.000Z";
      const exact30m = "2026-10-25T10:30:00.000Z";
      const availId = randomUUID();

      // Exactly 30 minutes must succeed
      const { error: insertErr } = await harness.serviceClient.from("student_availability").insert({
        id: availId,
        student_id: student.id,
        course_id: course.courseId,
        starts_at: startsAt,
        ends_at: exact30m,
      });
      expect(insertErr).toBeNull();

      // Read back and verify exact timestamps
      const { data: readAvail, error: readErr } = await harness.serviceClient
        .from("student_availability")
        .select("*")
        .eq("id", availId)
        .single();
      expect(readErr).toBeNull();
      expect(readAvail).not.toBeNull();
      expect(new Date(readAvail!.starts_at).toISOString()).toBe(startsAt);
      expect(new Date(readAvail!.ends_at).toISOString()).toBe(exact30m);

      // 29m 59s interval must fail with 23514 check_violation
      const { error: shortErr } = await harness.serviceClient.from("student_availability").insert({
        id: randomUUID(),
        student_id: student.id,
        course_id: course.courseId,
        starts_at: startsAt,
        ends_at: "2026-10-25T10:29:59.000Z",
      });
      expect(shortErr).not.toBeNull();
      expect(shortErr?.code).toBe("23514");

      // Zero-length interval must fail with 23514
      const { error: zeroErr } = await harness.serviceClient.from("student_availability").insert({
        id: randomUUID(),
        student_id: student.id,
        course_id: course.courseId,
        starts_at: startsAt,
        ends_at: startsAt,
      });
      expect(zeroErr).not.toBeNull();
      expect(zeroErr?.code).toBe("23514");

      // Reversed interval must fail with 23514
      const { error: reversedErr } = await harness.serviceClient.from("student_availability").insert({
        id: randomUUID(),
        student_id: student.id,
        course_id: course.courseId,
        starts_at: startsAt,
        ends_at: "2026-10-25T09:30:00.000Z",
      });
      expect(reversedErr).not.toBeNull();
      expect(reversedErr?.code).toBe("23514");

      // Cascading deletion on student removal
      const { error: delStudentErr } = await harness.serviceClient.from("students").delete().eq("id", student.id);
      expect(delStudentErr).toBeNull();

      const { data: cascadedAvail } = await harness.serviceClient
        .from("student_availability")
        .select("id")
        .eq("id", availId);
      expect(cascadedAvail).toHaveLength(0);
    });

    it("2. chat persistence: inserts and reads match messages, enforces FK constraints (23503), cascades on match delete", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);

      // Create a match
      const [s1, s2] = studentA.id < studentB.id ? [studentA.id, studentB.id] : [studentB.id, studentA.id];
      const matchId = randomUUID();
      const { error: matchErr } = await harness.serviceClient.from("study_group_matches").insert({
        id: matchId,
        course_id: course.courseId,
        student1_id: s1,
        student2_id: s2,
        concept_ids: [course.conceptIds[0]],
        status: "active",
      });
      expect(matchErr).toBeNull();

      // Insert message from studentA
      const messageId = randomUUID();
      const content = "Hello peer, ready to review graph concepts?";
      const { error: msgErr } = await harness.serviceClient.from("study_group_messages").insert({
        id: messageId,
        match_id: matchId,
        sender_id: studentA.id,
        content,
      });
      expect(msgErr).toBeNull();

      // Read back message
      const { data: readMsg, error: readMsgErr } = await harness.serviceClient
        .from("study_group_messages")
        .select("*")
        .eq("id", messageId)
        .single();
      expect(readMsgErr).toBeNull();
      expect(readMsg?.match_id).toBe(matchId);
      expect(readMsg?.sender_id).toBe(studentA.id);
      expect(readMsg?.content).toBe(content);

      // Foreign key violation: non-existent matchId must fail with 23503
      const { error: badMatchErr } = await harness.serviceClient.from("study_group_messages").insert({
        id: randomUUID(),
        match_id: randomUUID(),
        sender_id: studentA.id,
        content: "orphan message",
      });
      expect(badMatchErr).not.toBeNull();
      expect(badMatchErr?.code).toBe("23503");

      // Foreign key violation: non-existent senderId must fail with 23503
      const { error: badSenderErr } = await harness.serviceClient.from("study_group_messages").insert({
        id: randomUUID(),
        match_id: matchId,
        sender_id: randomUUID(),
        content: "orphan sender",
      });
      expect(badSenderErr).not.toBeNull();
      expect(badSenderErr?.code).toBe("23503");

      // Cascading deletion: deleting match removes messages
      const { error: delMatchErr } = await harness.serviceClient.from("study_group_matches").delete().eq("id", matchId);
      expect(delMatchErr).toBeNull();

      const { data: cascadedMsgs } = await harness.serviceClient
        .from("study_group_messages")
        .select("id")
        .eq("id", messageId);
      expect(cascadedMsgs).toHaveLength(0);
    });

    it("3. canonical atomic success: orders student UUIDs canonically (student1_id < student2_id) and transitions pool rows", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 3 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);

      const concepts = [course.conceptIds[0], course.conceptIds[1]];

      // Both students waiting in pool
      const { error: p1Err } = await harness.serviceClient.from("study_group_pool").insert({
        student_id: studentA.id,
        course_id: course.courseId,
        concept_ids: concepts,
        status: "waiting",
      });
      expect(p1Err).toBeNull();

      const { error: p2Err } = await harness.serviceClient.from("study_group_pool").insert({
        student_id: studentB.id,
        course_id: course.courseId,
        concept_ids: concepts,
        status: "waiting",
      });
      expect(p2Err).toBeNull();

      // Pass higher UUID first as p_student_a to verify canonical reordering
      const [higherId, lowerId] = studentA.id > studentB.id
        ? [studentA.id, studentB.id]
        : [studentB.id, studentA.id];

      const { data: matchId, error: rpcErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course.courseId,
        p_student_a: higherId,
        p_student_b: lowerId,
        p_concept_ids: concepts,
      });
      expect(rpcErr).toBeNull();
      expect(matchId).toBeDefined();

      // Verify created match
      const { data: matchRow } = await harness.serviceClient
        .from("study_group_matches")
        .select("*")
        .eq("id", matchId)
        .single();
      expect(matchRow).not.toBeNull();
      expect(matchRow.course_id).toBe(course.courseId);
      expect(matchRow.student1_id).toBe(lowerId);
      expect(matchRow.student2_id).toBe(higherId);
      expect(matchRow.concept_ids).toEqual(concepts);
      expect(matchRow.status).toBe("active");
      expect(matchRow.scheduling_status).toBe("pending");
      expect(matchRow.meeting_status).toBe("pending");

      // Verify both pool entries are now 'matched'
      const { data: poolRows } = await harness.serviceClient
        .from("study_group_pool")
        .select("student_id, status")
        .in("student_id", [studentA.id, studentB.id]);
      expect(poolRows).toHaveLength(2);
      expect(poolRows!.every((r) => r.status === "matched")).toBe(true);
    });

    it("4. rejected claims leave state unchanged: missing, non-waiting, expired, cross-course, identical IDs, and replays", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const courseA = await harness.createTestCourse(currentContext, { conceptCount: 3 });
      const courseB = await harness.createTestCourse(currentContext, { conceptCount: 3 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const userC = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), courseA.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), courseA.joinCode);
      const studentC_inB = await enrollmentService.enrollStudent(harness.buildStudentActor(userC), courseB.joinCode);

      const concepts = [courseA.conceptIds[0]];

      // A is in pool (waiting)
      await harness.serviceClient.from("study_group_pool").insert({
        student_id: studentA.id,
        course_id: courseA.courseId,
        concept_ids: concepts,
        status: "waiting",
      });

      // 4a. One missing pool entry: studentB is not in pool
      const { error: missingErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(missingErr).not.toBeNull();
      expect(missingErr?.code).toBe("55000");

      // Pool A must remain 'waiting'
      const { data: poolA1 } = await harness.serviceClient.from("study_group_pool").select("status").eq("student_id", studentA.id).single();
      expect(poolA1?.status).toBe("waiting");

      // 4b. Status 'cancelled'
      await harness.serviceClient.from("study_group_pool").insert({
        student_id: studentB.id,
        course_id: courseA.courseId,
        concept_ids: concepts,
        status: "cancelled",
      });
      const { error: cancelledErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(cancelledErr).not.toBeNull();
      expect(cancelledErr?.code).toBe("55000");

      // 4c. Status 'matched'
      await harness.serviceClient.from("study_group_pool").update({ status: "matched" }).eq("student_id", studentB.id);
      const { error: matchedErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(matchedErr).not.toBeNull();
      expect(matchedErr?.code).toBe("55000");

      // 4d. Status 'expired'
      await harness.serviceClient.from("study_group_pool").update({ status: "expired" }).eq("student_id", studentB.id);
      const { error: expiredErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(expiredErr).not.toBeNull();
      expect(expiredErr?.code).toBe("55000");

      // 4e. Past expires_at while status says 'waiting'
      await harness.serviceClient.from("study_group_pool").update({
        status: "waiting",
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      }).eq("student_id", studentB.id);

      const { error: pastExpiryErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(pastExpiryErr).not.toBeNull();
      expect(pastExpiryErr?.code).toBe("55000");

      // 4f. Cross-course / enrollment mismatch: studentC is enrolled in courseB, not courseA
      await harness.serviceClient.from("study_group_pool").insert({
        student_id: studentC_inB.id,
        course_id: courseA.courseId,
        concept_ids: concepts,
        status: "waiting",
      });
      const { error: crossCourseErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentC_inB.id,
        p_concept_ids: concepts,
      });
      expect(crossCourseErr).not.toBeNull();
      expect(crossCourseErr?.code).toBe("55000");

      // 4g. Identical student IDs: raises 22023
      const { error: identicalErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentA.id,
        p_concept_ids: concepts,
      });
      expect(identicalErr).not.toBeNull();
      expect(identicalErr?.code).toBe("22023");

      // Verify studentA pool row is STILL 'waiting' after all failed claims
      const { data: poolAFinal } = await harness.serviceClient.from("study_group_pool").select("status").eq("student_id", studentA.id).single();
      expect(poolAFinal?.status).toBe("waiting");

      // Now reset studentB to valid waiting state and claim successfully
      await harness.serviceClient.from("study_group_pool").update({
        status: "waiting",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }).eq("student_id", studentB.id);

      const { data: validMatchId, error: validClaimErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(validClaimErr).toBeNull();
      expect(validMatchId).toBeDefined();

      // 4h. Replay attempt on already matched pair must fail with 55000 and create no new match
      const { error: replayErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: courseA.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: concepts,
      });
      expect(replayErr).not.toBeNull();
      expect(replayErr?.code).toBe("55000");

      // Assert only 1 match exists in courseA
      const { data: totalMatches } = await harness.serviceClient.from("study_group_matches").select("id").eq("course_id", courseA.courseId);
      expect(totalMatches).toHaveLength(1);
    });

    it("5. concept consent: rejects empty, nulls, unrequested, and other-course concepts with 22023", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course1 = await harness.createTestCourse(currentContext, { conceptCount: 4 });
      const course2 = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course1.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course1.joinCode);

      // Student A requests [c0, c1], Student B requests [c0, c2]
      await harness.serviceClient.from("study_group_pool").insert([
        {
          student_id: studentA.id,
          course_id: course1.courseId,
          concept_ids: [course1.conceptIds[0], course1.conceptIds[1]],
          status: "waiting",
        },
        {
          student_id: studentB.id,
          course_id: course1.courseId,
          concept_ids: [course1.conceptIds[0], course1.conceptIds[2]],
          status: "waiting",
        },
      ]);

      // 5a. Empty concept array -> 22023
      const { error: emptyErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course1.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: [],
      });
      expect(emptyErr).not.toBeNull();
      expect(emptyErr?.code).toBe("22023");

      // 5b. Null-containing concept array -> 22023
      const { error: nullElemErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course1.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: [course1.conceptIds[0], null as unknown as string],
      });
      expect(nullElemErr).not.toBeNull();
      expect(nullElemErr?.code).toBe("22023");

      // 5d. Duplicate concepts in array -> 22023
      const { error: dupErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course1.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: [course1.conceptIds[0], course1.conceptIds[0]],
      });
      expect(dupErr).not.toBeNull();
      expect(dupErr?.code).toBe("22023");

      // 5e. Concept requested by student A but NOT by student B (c1) -> 22023
      const { error: unsharedErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course1.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: [course1.conceptIds[1]],
      });
      expect(unsharedErr).not.toBeNull();
      expect(unsharedErr?.code).toBe("22023");

      // 5f. Non-existent concept / concept from course 2 -> 22023
      const { error: otherCourseErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course1.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: [course2.conceptIds[0]],
      });
      expect(otherCourseErr).not.toBeNull();
      expect(otherCourseErr?.code).toBe("22023");

      // Verify no pool modification and no match created
      const { data: pools } = await harness.serviceClient.from("study_group_pool").select("status").eq("course_id", course1.courseId);
      expect(pools?.every((p) => p.status === "waiting")).toBe(true);

      const { data: matches } = await harness.serviceClient.from("study_group_matches").select("id").eq("course_id", course1.courseId);
      expect(matches).toHaveLength(0);
    });

    it("5b. concept cardinality boundary: rejects 4 jointly requested concepts with 22023, succeeds with 3", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 4 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);

      // Both student A and student B request all 4 course concepts
      await harness.serviceClient.from("study_group_pool").insert([
        {
          student_id: studentA.id,
          course_id: course.courseId,
          concept_ids: course.conceptIds,
          status: "waiting",
        },
        {
          student_id: studentB.id,
          course_id: course.courseId,
          concept_ids: course.conceptIds,
          status: "waiting",
        },
      ]);

      // Calling claim_and_create_match with 4 concepts -> rejects with 22023
      const { data: failMatchId, error: fourConceptsErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: course.conceptIds,
      });
      expect(fourConceptsErr).not.toBeNull();
      expect(fourConceptsErr?.code).toBe("22023");
      expect(failMatchId).toBeFalsy();

      // Verify both entries still waiting and no match created
      const { data: poolsBefore } = await harness.serviceClient
        .from("study_group_pool")
        .select("status")
        .eq("course_id", course.courseId);
      expect(poolsBefore).toHaveLength(2);
      expect(poolsBefore?.every((p) => p.status === "waiting")).toBe(true);

      const { data: matchesBefore } = await harness.serviceClient
        .from("study_group_matches")
        .select("id")
        .eq("course_id", course.courseId);
      expect(matchesBefore).toHaveLength(0);

      // Calling claim_and_create_match with 3 concepts -> succeeds
      const threeConcepts = course.conceptIds.slice(0, 3);
      const { data: matchId, error: successErr } = await harness.serviceClient.rpc("claim_and_create_match", {
        p_course_id: course.courseId,
        p_student_a: studentA.id,
        p_student_b: studentB.id,
        p_concept_ids: threeConcepts,
      });
      expect(successErr).toBeNull();
      expect(matchId).toBeDefined();

      // Verify persisted match: canonical peer ordering and exactly those 3 concept IDs
      const { data: matchRow } = await harness.serviceClient
        .from("study_group_matches")
        .select("*")
        .eq("id", matchId)
        .single();
      expect(matchRow).not.toBeNull();
      const [expectedStudent1, expectedStudent2] = [studentA.id, studentB.id].sort();
      expect(matchRow.student1_id).toBe(expectedStudent1);
      expect(matchRow.student2_id).toBe(expectedStudent2);
      expect(matchRow.concept_ids).toEqual(threeConcepts);

      // Verify both pool entries transitioned to 'matched'
      const { data: poolsAfter } = await harness.serviceClient
        .from("study_group_pool")
        .select("status")
        .eq("course_id", course.courseId);
      expect(poolsAfter).toHaveLength(2);
      expect(poolsAfter?.every((p) => p.status === "matched")).toBe(true);
    });

    it("6. deterministic concurrent winner: session 1 holds lock, session 2 blocks and fails with 55000", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const userC = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);
      const studentC = await enrollmentService.enrollStudent(harness.buildStudentActor(userC), course.joinCode);

      const conceptId = course.conceptIds[0];

      // All 3 in pool
      await harness.serviceClient.from("study_group_pool").insert([
        { student_id: studentA.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
        { student_id: studentB.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
        { student_id: studentC.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
      ]);

      const appNameWinner = `winner_${randomUUID().slice(0, 8)}`;
      const appNameLoser = `loser_${randomUUID().slice(0, 8)}`;

      const session1 = spawnPsqlSession();
      const session2 = spawnPsqlSession();

      try {
        // Session 1: begin transaction, claim A & B, hold transaction
        session1.child.stdin?.write(`
SET application_name = '${appNameWinner}';
BEGIN;
SELECT public.claim_and_create_match(
  '${course.courseId}'::uuid,
  '${studentA.id}'::uuid,
  '${studentB.id}'::uuid,
  ARRAY['${conceptId}']::uuid[]
);
\\echo SESSION1_CLAIMED
`);

        await session1.waitForOutput("SESSION1_CLAIMED");

        // Session 2: attempt to claim A & C (contending on studentA's pool row)
        session2.child.stdin?.write(`
SET application_name = '${appNameLoser}';
SELECT public.claim_and_create_match(
  '${course.courseId}'::uuid,
  '${studentA.id}'::uuid,
  '${studentC.id}'::uuid,
  ARRAY['${conceptId}']::uuid[]
);
\\echo SESSION2_DONE
`);

        // Wait for session 2 to block on row lock
        const blocked = await waitForLock(appNameLoser, 10000);
        expect(blocked).toBe(true);

        // Commit session 1
        session1.child.stdin?.write("COMMIT;\n\\echo SESSION1_COMMITTED\n");
        await session1.waitForOutput("SESSION1_COMMITTED");

        // Session 2 should unblock and fail with 55000
        await session2.waitForOutput("ERROR:");
        expect(session2.output.stderr).toMatch(/55000/);

        // Verify state: A and B are matched, C is still waiting
        const { data: poolRows } = await harness.serviceClient
          .from("study_group_pool")
          .select("student_id, status")
          .in("student_id", [studentA.id, studentB.id, studentC.id]);

        const aRow = poolRows?.find((r) => r.student_id === studentA.id);
        const bRow = poolRows?.find((r) => r.student_id === studentB.id);
        const cRow = poolRows?.find((r) => r.student_id === studentC.id);

        expect(aRow?.status).toBe("matched");
        expect(bRow?.status).toBe("matched");
        expect(cRow?.status).toBe("waiting");

        // Only 1 match exists
        const { data: matches } = await harness.serviceClient
          .from("study_group_matches")
          .select("id")
          .eq("course_id", course.courseId);
        expect(matches).toHaveLength(1);
      } finally {
        await session1.close();
        await session2.close();
      }
    }, 30000);

    it("7. expiry while blocked: acquires lock after expiration, post-lock check catches expiry and fails with 55000", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);

      const conceptId = course.conceptIds[0];

      await harness.serviceClient.from("study_group_pool").insert([
        { student_id: studentA.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
        { student_id: studentB.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
      ]);

      const appNameHolder = `holder_${randomUUID().slice(0, 8)}`;
      const appNameClaimant = `claimant_${randomUUID().slice(0, 8)}`;

      const holderSession = spawnPsqlSession();
      const claimantSession = spawnPsqlSession();

      try {
        // Holder locks studentA's pool row
        holderSession.child.stdin?.write(`
SET application_name = '${appNameHolder}';
BEGIN;
SELECT 1 FROM public.study_group_pool WHERE student_id = '${studentA.id}' FOR UPDATE;
\\echo HOLDER_LOCKED
`);
        await holderSession.waitForOutput("HOLDER_LOCKED");

        // Claimant begins claim_and_create_match and blocks waiting for studentA's lock
        claimantSession.child.stdin?.write(`
SET application_name = '${appNameClaimant}';
SELECT public.claim_and_create_match(
  '${course.courseId}'::uuid,
  '${studentA.id}'::uuid,
  '${studentB.id}'::uuid,
  ARRAY['${conceptId}']::uuid[]
);
\\echo CLAIMANT_DONE
`);

        // Observe claimant is blocked
        const blocked = await waitForLock(appNameClaimant, 10000);
        expect(blocked).toBe(true);

        // While claimant is blocked, holder updates expires_at into the past, then commits
        holderSession.child.stdin?.write(`
UPDATE public.study_group_pool
SET expires_at = clock_timestamp() - INTERVAL '1 minute'
WHERE student_id = '${studentA.id}';
COMMIT;
\\echo HOLDER_COMMITTED
`);
        await holderSession.waitForOutput("HOLDER_COMMITTED");

        // Claimant unblocks, re-evaluates expires_at >= clock_timestamp(), fails with 55000
        await claimantSession.waitForOutput("ERROR:");
        expect(claimantSession.output.stderr).toMatch(/55000/);

        // Neither entry transitioned to matched; no match created
        const { data: poolRows } = await harness.serviceClient
          .from("study_group_pool")
          .select("status")
          .in("student_id", [studentA.id, studentB.id]);
        expect(poolRows?.every((r) => r.status === "waiting")).toBe(true);

        const { data: matches } = await harness.serviceClient
          .from("study_group_matches")
          .select("id")
          .eq("course_id", course.courseId);
        expect(matches).toHaveLength(0);
      } finally {
        await holderSession.close();
        await claimantSession.close();
      }
    }, 30000);

    it("8. transaction rollback on failure: simulated insert failure rolls back pool transitions", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const userA = await harness.createTestUser(currentContext, "student");
      const userB = await harness.createTestUser(currentContext, "student");
      const studentA = await enrollmentService.enrollStudent(harness.buildStudentActor(userA), course.joinCode);
      const studentB = await enrollmentService.enrollStudent(harness.buildStudentActor(userB), course.joinCode);

      const conceptId = course.conceptIds[0];

      await harness.serviceClient.from("study_group_pool").insert([
        { student_id: studentA.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
        { student_id: studentB.id, course_id: course.courseId, concept_ids: [conceptId], status: "waiting" },
      ]);

      const triggerName = `trg_fail_match_${course.courseId.replace(/-/g, "")}`;
      const fnName = `fn_fail_match_${course.courseId.replace(/-/g, "")}`;

      // Install trigger that fails match insert for this course
      const installSql = `
        CREATE OR REPLACE FUNCTION ${fnName}()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.course_id = '${course.courseId}'::uuid THEN
            RAISE EXCEPTION 'Simulated match insert failure' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON public.study_group_matches
        FOR EACH ROW
        EXECUTE FUNCTION ${fnName}();
      `;

      try {
        runPsql(installSql);

        const { error: rpcErr } = await harness.serviceClient.rpc("claim_and_create_match", {
          p_course_id: course.courseId,
          p_student_a: studentA.id,
          p_student_b: studentB.id,
          p_concept_ids: [conceptId],
        });

        expect(rpcErr).not.toBeNull();
        expect(rpcErr?.message).toContain("Simulated match insert failure");

        // Verify pool entries remained 'waiting' (rolled back!)
        const { data: poolRows } = await harness.serviceClient
          .from("study_group_pool")
          .select("status")
          .in("student_id", [studentA.id, studentB.id]);
        expect(poolRows).toHaveLength(2);
        expect(poolRows!.every((r) => r.status === "waiting")).toBe(true);

        // Verify no match exists
        const { data: matches } = await harness.serviceClient
          .from("study_group_matches")
          .select("id")
          .eq("course_id", course.courseId);
        expect(matches).toHaveLength(0);
      } finally {
        const cleanupSql = `
          DROP TRIGGER IF EXISTS ${triggerName} ON public.study_group_matches;
          DROP FUNCTION IF EXISTS ${fnName}();
        `;
        runPsql(cleanupSql);
      }
    });

    it("9. privileges: denies anon/authenticated access and permits service_role for tables and RPC", async () => {
      // 1. Table privileges query
      const tableCheckSql = `
        SELECT 
          has_table_privilege('anon', 'public.student_availability', 'select') AS anon_avail_sel,
          has_table_privilege('anon', 'public.student_availability', 'insert') AS anon_avail_ins,
          has_table_privilege('authenticated', 'public.student_availability', 'select') AS auth_avail_sel,
          has_table_privilege('authenticated', 'public.student_availability', 'insert') AS auth_avail_ins,
          has_table_privilege('service_role', 'public.student_availability', 'select') AS serv_avail_sel,
          has_table_privilege('service_role', 'public.student_availability', 'insert') AS serv_avail_ins,
          has_table_privilege('anon', 'public.study_group_messages', 'select') AS anon_msg_sel,
          has_table_privilege('anon', 'public.study_group_messages', 'insert') AS anon_msg_ins,
          has_table_privilege('authenticated', 'public.study_group_messages', 'select') AS auth_msg_sel,
          has_table_privilege('authenticated', 'public.study_group_messages', 'insert') AS auth_msg_ins,
          has_table_privilege('service_role', 'public.study_group_messages', 'select') AS serv_msg_sel,
          has_table_privilege('service_role', 'public.study_group_messages', 'insert') AS serv_msg_ins;
      `;
      const tableResult = runPsql(tableCheckSql).trim();
      expect(tableResult).toBe("f|f|f|f|t|t|f|f|f|f|t|t");

      // 2. Function privileges query
      const fnCheckSql = `
        SELECT 
          has_function_privilege('anon', 'public.claim_and_create_match(UUID, UUID, UUID, UUID[])', 'execute') AS anon_exec,
          has_function_privilege('authenticated', 'public.claim_and_create_match(UUID, UUID, UUID, UUID[])', 'execute') AS auth_exec,
          has_function_privilege('service_role', 'public.claim_and_create_match(UUID, UUID, UUID, UUID[])', 'execute') AS serv_exec;
      `;
      const fnResult = runPsql(fnCheckSql).trim();
      expect(fnResult).toBe("f|f|t");

      // 3. Execution under anon role must fail with 42501 permission denied
      const anonAvailErr = runPsqlExpectError(`
        BEGIN;
        SET LOCAL ROLE anon;
        INSERT INTO public.student_availability (id, student_id, course_id, starts_at, ends_at)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), NOW(), NOW() + INTERVAL '1 hour');
        ROLLBACK;
      `);
      expect(anonAvailErr.code).toBe("42501");

      const authMsgErr = runPsqlExpectError(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        INSERT INTO public.study_group_messages (id, match_id, sender_id, content)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'unauthorized');
        ROLLBACK;
      `);
      expect(authMsgErr.code).toBe("42501");

      const anonRpcErr = runPsqlExpectError(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT public.claim_and_create_match(
          gen_random_uuid(),
          gen_random_uuid(),
          gen_random_uuid(),
          ARRAY[gen_random_uuid()]::uuid[]
        );
        ROLLBACK;
      `);
      expect(anonRpcErr.code).toBe("42501");
    });
  }
);
