import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness";
import {
  EnrollmentRepository,
  EnrollmentService,
} from "../../../src/server/core/index.js";

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P4-B-01: Lane A Database Prerequisite (transition_poll & ingest_poll_response RPCs)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let currentContext: TestContext;

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const client = harness.serviceClient;
      enrollmentService = new EnrollmentService(new EnrollmentRepository(client));
    });

    afterEach(async () => {
      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    async function setupCourseAndLecture(lectureStatus: "scheduled" | "live" | "completed" = "live") {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
      const conceptId = course.conceptIds[0];
      const otherConceptId = course.conceptIds[1];

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );

      const lectureId = randomUUID();
      const { error: lectureErr } = await harness.serviceClient
        .from("lecture_sessions")
        .insert({
          id: lectureId,
          course_id: course.courseId,
          title: "Poll Test Lecture",
          status: lectureStatus,
        });
      expect(lectureErr).toBeNull();

      return { course, conceptId, otherConceptId, studentUser, student, lectureId };
    }

    async function createDraftPoll(lectureId: string, conceptId: string, questionText = "What is 2+2?") {
      const pollId = randomUUID();
      const { data, error } = await harness.serviceClient
        .from("poll_questions")
        .insert({
          id: pollId,
          lecture_id: lectureId,
          concept_id: conceptId,
          question: questionText,
          expected_answer: "4",
          status: "draft",
        })
        .select()
        .single();
      expect(error).toBeNull();
      return data;
    }

    it("revokes RPC execution from anon client", async () => {
      const { error: transErr } = await harness.anonClient.rpc("transition_poll", {
        p_actor_auth_id: randomUUID(),
        p_poll_id: randomUUID(),
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      expect(transErr).not.toBeNull();
      // Should be 42501 permission denied or function does not exist for anon
      expect(["42501", "PGRST202", "PGRST301", "P0001"]).toContain(transErr!.code);

      const { error: ingestErr } = await harness.anonClient.rpc("ingest_poll_response", {
        p_actor_auth_id: randomUUID(),
        p_poll_id: randomUUID(),
        p_response_id: randomUUID(),
        p_answer: "test",
        p_answered_at: new Date().toISOString(),
      });
      expect(ingestErr).not.toBeNull();
      expect(["42501", "PGRST202", "PGRST301", "P0001"]).toContain(ingestErr!.code);
    });

    it("transition_poll validates arguments and rejects invalid target status with 22023", async () => {
      const { course, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      const { error: err1 } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "invalid_status",
        p_occurred_at: new Date().toISOString(),
      });
      expect(err1).not.toBeNull();
      expect(err1!.code).toBe("22023");

      const { error: err2 } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: null,
        p_occurred_at: new Date().toISOString(),
      });
      expect(err2).not.toBeNull();
      expect(err2!.code).toBe("22023");
    });

    it("transition_poll enforces teacher course ownership with P0002", async () => {
      const { conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      // Random auth ID not owning course
      const randomAuthId = randomUUID();
      const { error } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: randomAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0002");
    });

    it("transition_poll rejects transitions when lecture is not live with INVALID_LECTURE_STATUS", async () => {
      const { course, conceptId, lectureId } = await setupCourseAndLecture("completed");
      const poll = await createDraftPoll(lectureId, conceptId);

      const { error } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0001");
      expect(error!.message).toContain("INVALID_LECTURE_STATUS");
    });

    it("transition_poll transitions draft -> active and active -> closed, updating timestamps", async () => {
      const { course, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      const activatedAt = new Date().toISOString();
      const { data: actData, error: actErr } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: activatedAt,
      });
      expect(actErr).toBeNull();
      const activePoll = Array.isArray(actData) ? actData[0] : actData;
      expect(activePoll.status).toBe("active");
      expect(new Date(activePoll.activated_at).toISOString()).toBe(new Date(activatedAt).toISOString());

      // Repeating activation on already active poll fails
      const { error: repeatActErr } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      expect(repeatActErr).not.toBeNull();
      expect(repeatActErr!.code).toBe("P0001");
      expect(repeatActErr!.message).toContain("INVALID_POLL_STATUS");

      // Close the active poll
      const closedAt = new Date().toISOString();
      const { data: closeData, error: closeErr } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "closed",
        p_occurred_at: closedAt,
      });
      expect(closeErr).toBeNull();
      const closedPoll = Array.isArray(closeData) ? closeData[0] : closeData;
      expect(closedPoll.status).toBe("closed");
      expect(new Date(closedPoll.closed_at).toISOString()).toBe(new Date(closedAt).toISOString());
      expect(new Date(closedPoll.activated_at).toISOString()).toBe(new Date(activatedAt).toISOString());

      // Closing already closed poll fails
      const { error: repeatCloseErr } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "closed",
        p_occurred_at: new Date().toISOString(),
      });
      expect(repeatCloseErr).not.toBeNull();
      expect(repeatCloseErr!.code).toBe("P0001");
      expect(repeatCloseErr!.message).toContain("INVALID_POLL_STATUS");
    });

    it("transition_poll and partial unique index enforce single active poll per lecture", async () => {
      const { course, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll1 = await createDraftPoll(lectureId, conceptId, "Question 1");
      const poll2 = await createDraftPoll(lectureId, conceptId, "Question 2");

      // Activate poll 1
      const { error: act1Err } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll1.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      expect(act1Err).toBeNull();

      // Attempt to activate poll 2 while poll 1 is active fails with ACTIVE_POLL_EXISTS
      const { error: act2Err } = await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll2.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      expect(act2Err).not.toBeNull();
      expect(act2Err!.code).toBe("P0001");
      expect(act2Err!.message).toContain("ACTIVE_POLL_EXISTS");

      // Direct SQL attempt to activate poll 2 hits partial unique index idx_poll_questions_single_active (23505)
      const { error: directErr } = await harness.serviceClient
        .from("poll_questions")
        .update({ status: "active" })
        .eq("id", poll2.id);
      expect(directErr).not.toBeNull();
      expect(directErr!.code).toBe("23505");
    });

    it("ingest_poll_response validates arguments and nonblank answer with 22023", async () => {
      const { studentUser, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      // Blank answer
      const { error: err1 } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: randomUUID(),
        p_answer: "   ",
        p_answered_at: new Date().toISOString(),
      });
      expect(err1).not.toBeNull();
      expect(err1!.code).toBe("22023");

      // Null response ID
      const { error: err2 } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: null,
        p_answer: "valid answer",
        p_answered_at: new Date().toISOString(),
      });
      expect(err2).not.toBeNull();
      expect(err2!.code).toBe("22023");
    });

    it("ingest_poll_response enforces student enrollment with P0002", async () => {
      const { conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      const nonEnrolledAuthId = randomUUID();
      const { error } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: nonEnrolledAuthId,
        p_poll_id: poll.id,
        p_response_id: randomUUID(),
        p_answer: "valid answer",
        p_answered_at: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0002");
    });

    it("ingest_poll_response rejects responses for draft or closed polls with INVALID_POLL_STATUS", async () => {
      const { course, studentUser, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      // Poll is in draft
      const { error: draftErr } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: randomUUID(),
        p_answer: "my answer",
        p_answered_at: new Date().toISOString(),
      });
      expect(draftErr).not.toBeNull();
      expect(draftErr!.code).toBe("P0001");
      expect(draftErr!.message).toContain("INVALID_POLL_STATUS");

      // Activate poll, then close it
      await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });
      await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "closed",
        p_occurred_at: new Date().toISOString(),
      });

      // Poll is now closed
      const { error: closedErr } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: randomUUID(),
        p_answer: "my answer",
        p_answered_at: new Date().toISOString(),
      });
      expect(closedErr).not.toBeNull();
      expect(closedErr!.code).toBe("P0001");
      expect(closedErr!.message).toContain("INVALID_POLL_STATUS");
    });

    it("ingest_poll_response inserts pending row, deduplicates identical answer, and rejects different answer", async () => {
      const { course, studentUser, student, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId);

      // Activate poll
      await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });

      const responseId1 = randomUUID();
      const answeredAt1 = new Date().toISOString();
      const rawAnswer = "The core definition of linear independence.";

      // 1. Initial submission -> inserted: true
      const { data: res1, error: err1 } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: responseId1,
        p_answer: rawAnswer,
        p_answered_at: answeredAt1,
      });
      expect(err1).toBeNull();
      const row1 = Array.isArray(res1) ? res1[0] : res1;
      expect(row1.inserted).toBe(true);
      expect(row1.response.id).toBe(responseId1);
      expect(row1.response.student_id).toBe(student.id);
      expect(row1.response.answer).toBe(rawAnswer);
      expect(row1.response.status).toBe("pending");
      expect(row1.response.evaluation).toBeNull();

      // 2. Replay identical answer with new response UUID -> returns original stored row, inserted: false
      const responseId2 = randomUUID();
      const { data: res2, error: err2 } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: responseId2,
        p_answer: rawAnswer,
        p_answered_at: new Date().toISOString(),
      });
      expect(err2).toBeNull();
      const row2 = Array.isArray(res2) ? res2[0] : res2;
      expect(row2.inserted).toBe(false);
      expect(row2.response.id).toBe(responseId1); // preserves original ID
      expect(row2.response.answer).toBe(rawAnswer);

      // 3. Different answer -> RESPONSE_ALREADY_SUBMITTED (P0001)
      const { error: err3 } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: randomUUID(),
        p_answer: "Completely different answer.",
        p_answered_at: new Date().toISOString(),
      });
      expect(err3).not.toBeNull();
      expect(err3!.code).toBe("P0001");
      expect(err3!.message).toContain("RESPONSE_ALREADY_SUBMITTED");

      // 4. Whitespace-different answer (raw byte equality) -> rejected with RESPONSE_ALREADY_SUBMITTED
      const { error: err4 } = await harness.serviceClient.rpc("ingest_poll_response", {
        p_actor_auth_id: studentUser.authId,
        p_poll_id: poll.id,
        p_response_id: randomUUID(),
        p_answer: " " + rawAnswer,
        p_answered_at: new Date().toISOString(),
      });
      expect(err4).not.toBeNull();
      expect(err4!.code).toBe("P0001");
      expect(err4!.message).toContain("RESPONSE_ALREADY_SUBMITTED");
    });

    it("concurrent activation of two different draft polls in same live lecture has exactly one winner", async () => {
      const { course, conceptId, lectureId } = await setupCourseAndLecture("live");
      const pollA = await createDraftPoll(lectureId, conceptId, "Poll A");
      const pollB = await createDraftPoll(lectureId, conceptId, "Poll B");

      const results = await Promise.all([
        harness.serviceClient.rpc("transition_poll", {
          p_actor_auth_id: course.teacherAuthId,
          p_poll_id: pollA.id,
          p_target_status: "active",
          p_occurred_at: new Date().toISOString(),
        }),
        harness.serviceClient.rpc("transition_poll", {
          p_actor_auth_id: course.teacherAuthId,
          p_poll_id: pollB.id,
          p_target_status: "active",
          p_occurred_at: new Date().toISOString(),
        }),
      ]);

      const successes = results.filter((r) => r.error === null);
      const failures = results.filter((r) => r.error !== null);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].error!.message).toContain("ACTIVE_POLL_EXISTS");

      // Check PostgreSQL state: exactly one poll is active
      const { data: activePolls, error: pollErr } = await harness.serviceClient
        .from("poll_questions")
        .select("id, status")
        .eq("lecture_id", lectureId)
        .eq("status", "active");
      expect(pollErr).toBeNull();
      expect(activePolls).toHaveLength(1);
    });

    it("concurrent close and admission: admission rejected once poll is closed", async () => {
      const { course, studentUser, conceptId, lectureId } = await setupCourseAndLecture("live");
      const poll = await createDraftPoll(lectureId, conceptId, "Poll Race");

      // Activate poll first
      await harness.serviceClient.rpc("transition_poll", {
        p_actor_auth_id: course.teacherAuthId,
        p_poll_id: poll.id,
        p_target_status: "active",
        p_occurred_at: new Date().toISOString(),
      });

      // Run close and admission concurrently
      const [closeResult, ingestResult] = await Promise.all([
        harness.serviceClient.rpc("transition_poll", {
          p_actor_auth_id: course.teacherAuthId,
          p_poll_id: poll.id,
          p_target_status: "closed",
          p_occurred_at: new Date().toISOString(),
        }),
        harness.serviceClient.rpc("ingest_poll_response", {
          p_actor_auth_id: studentUser.authId,
          p_poll_id: poll.id,
          p_response_id: randomUUID(),
          p_answer: "Racing answer",
          p_answered_at: new Date().toISOString(),
        }),
      ]);

      expect(closeResult.error).toBeNull();

      // If close committed first, ingest must fail with INVALID_POLL_STATUS.
      // If ingest committed first, ingest succeeded before close.
      // In either case, the poll status in DB must now be closed!
      const { data: finalPoll } = await harness.serviceClient
        .from("poll_questions")
        .select("status")
        .eq("id", poll.id)
        .single();
      expect(finalPoll?.status).toBe("closed");

      if (ingestResult.error) {
        expect(ingestResult.error.message).toContain("INVALID_POLL_STATUS");
      }
    });
  },
);
