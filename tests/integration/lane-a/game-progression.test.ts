import { execFileSync as nodeExecFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { io as createClientSocket, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Clock, UUID } from "../../../src/contracts/common.js";
import { gameUpdatedEventSchema } from "../../../src/contracts/realtime.js";
import { OpenRouterClient } from "../../../src/server/ai/index.js";
import {
  ConcreteGameService,
  CourseEffortService,
  CourseRepository,
  CourseService,
  CryptoIdGenerator,
  EnrollmentRepository,
  EnrollmentService,
  GameRepository,
  GraphRepository,
  HeatmapService,
  LearningEvidenceService,
  MasteryRepository,
  MasteryService,
} from "../../../src/server/core/index.js";
import { createAuthGateway } from "../../../src/server/platform/index.js";
import { createServer, type ServerInstance } from "../../../server/index.js";
import {
  SupabaseTestHarness,
  type TestContext,
} from "./supabase-harness.js";

const isLocalSupabase = process.env.RUN_LOCAL_SUPABASE === "1";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_spark";

function runPsql(sql: string): string {
  return nodeExecFileSync(
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
    { encoding: "utf8" },
  );
}

describe.skipIf(!isLocalSupabase)(
  "P5-A-02: Game Progression Integration Tests (live local PostgreSQL)",
  () => {
    let harness: SupabaseTestHarness;
    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let masteryService: MasteryService;
    let learningEvidenceService: LearningEvidenceService;
    let graphRepository: GraphRepository;
    let gameRepository: GameRepository;
    let gameService: ConcreteGameService;
    let courseEffortService: CourseEffortService;
    let currentContext: TestContext;
    let activeServers: ServerInstance[] = [];
    let activeSockets: ClientSocket[] = [];

    beforeAll(() => {
      harness = new SupabaseTestHarness();
      const client = harness.serviceClient;
      enrollmentService = new EnrollmentService(new EnrollmentRepository(client));
      const courseRepo = new CourseRepository(client);
      courseService = new CourseService(courseRepo, new CryptoIdGenerator());
      const masteryRepo = new MasteryRepository(client);
      masteryService = new MasteryService(masteryRepo);
      learningEvidenceService = new LearningEvidenceService(client, courseService, masteryService);
      graphRepository = new GraphRepository(client, courseRepo);
      gameRepository = new GameRepository(client);

      const heatmapService = new HeatmapService({
        client,
        courses: courseService,
        publisher: {
          emitToTeacher: async () => {},
        },
        clock: {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        },
        ids: new CryptoIdGenerator(),
      });

      courseEffortService = new CourseEffortService({
        client,
        courses: courseService,
        heatmap: heatmapService,
      });

      gameService = new ConcreteGameService({
        repository: gameRepository,
        courses: courseService,
        graph: graphRepository,
        mastery: masteryService,
        courseEffort: courseEffortService,
        publisher: {
          emitToStudent: async () => {},
        },
        clock: {
          now: () => new Date("2026-10-24T12:00:00.000Z"),
          nowISO: () => "2026-10-24T12:00:00.000Z",
        },
        ids: new CryptoIdGenerator(),
      });
    });

    afterEach(async () => {
      for (const socket of activeSockets) {
        if (socket.connected) {
          socket.disconnect();
        }
      }
      activeSockets = [];

      for (const s of activeServers) {
        const { promise, resolve } = Promise.withResolvers<void>();
        s.httpServer.close(() => resolve());
        await promise;
      }
      activeServers = [];

      if (currentContext) {
        await harness.cleanup(currentContext);
      }
    });

    it("1 & 2: Queue persistence, readiness, review evidence, and determinism", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 5 });
      const [c1, c2, _c3, c4, c5] = course.conceptIds as [UUID, UUID, UUID, UUID, UUID];

      // Build graph: c1 (root), c2 (root), c3 (root), c4 requires c1, c5 requires c2
      // c1 -> c4, c2 -> c5
      const { error: edgeErr } = await harness.serviceClient.from("concept_edges").insert([
        { course_id: course.courseId, source_id: c1, target_id: c4 },
        { course_id: course.courseId, source_id: c2, target_id: c5 },
      ]);
      expect(edgeErr).toBeNull();

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      // c1 is mastered (>= 0.70) => c4 is ready!
      // c2 is NOT mastered (< 0.70) => c5 is blocked (not ready!)
      await masteryService.applyEvidence(studentActor, student.id, c1, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(studentActor, student.id, c2, {
        type: "quiz",
        score: 0.4,
        sourceId: randomUUID(),
      });

      // Insert poll evidence for c1 older than 72h (poll does NOT clear overdue!)
      const testClockDate = new Date("2026-10-24T12:00:00.000Z");
      const olderThan72h = new Date(testClockDate.getTime() - 100 * 3600 * 1000).toISOString();
      await harness.serviceClient.from("mastery_evidence").insert({
        student_id: student.id,
        concept_id: c1,
        evidence_type: "poll",
        source_id: randomUUID(),
        prior_confidence: 0.0,
        new_confidence: 0.1,
        created_at: olderThan72h,
      });

      const fixedClock: Clock = {
        now: () => testClockDate,
        nowISO: () => testClockDate.toISOString(),
      };

      const customGameService = new ConcreteGameService({
        repository: gameRepository,
        courses: courseService,
        graph: graphRepository,
        mastery: masteryService,
        courseEffort: courseEffortService,
        publisher: { emitToStudent: async () => {} },
        clock: fixedClock,
        ids: new CryptoIdGenerator(),
      });

      // Concurrent first reads
      const [quest1, quest2] = await Promise.all([
        customGameService.getDailyQuest(studentActor, student.id),
        customGameService.getDailyQuest(studentActor, student.id),
      ]);

      expect(quest1.id).toBe(quest2.id);
      expect(quest1.items.map((i) => i.conceptId)).toEqual(quest2.items.map((i) => i.conceptId));
      expect(quest1.items.length).toBeLessThanOrEqual(3);

      // Blocked c5 MUST NOT be in the queue
      const questConceptIds = quest1.items.map((i) => i.conceptId);
      expect(questConceptIds).not.toContain(c5);

      // Reopening view returns identical ordered list
      const reopened = await customGameService.getDailyQuest(studentActor, student.id);
      expect(reopened.id).toBe(quest1.id);
      expect(reopened.items.map((i) => i.conceptId)).toEqual(questConceptIds);
    });

    it("3 & 4: Practice reward path, quest clear, exact-once, and streak evaluation", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 3 });
      const [c1, c2, c3] = course.conceptIds as [UUID, UUID, UUID];

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const testDate = new Date("2026-10-24T12:00:00.000Z");
      const fixedClock: Clock = {
        now: () => testDate,
        nowISO: () => testDate.toISOString(),
      };

      const customGameService = new ConcreteGameService({
        repository: gameRepository,
        courses: courseService,
        graph: graphRepository,
        mastery: masteryService,
        courseEffort: courseEffortService,
        publisher: { emitToStudent: async () => {} },
        clock: fixedClock,
        ids: new CryptoIdGenerator(),
      });

      // Initialize daily quest with [c1, c2, c3]
      const quest = await customGameService.getDailyQuest(studentActor, student.id);
      expect(quest.items).toHaveLength(3);

      // 1. Create linked encounter for c1 with hints [2, 0, 0, 0, 0]
      const encounterId = randomUUID();
      const qIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await harness.serviceClient.from("encounters").insert({
        id: encounterId,
        student_id: student.id,
        concept_id: c1,
        source: "daily",
        quest_id: quest.id,
        status: "active",
        question_ids: qIds,
        option_permutations: {},
        hints_used: { "1": 2, "2": 0, "3": 0, "4": 0, "5": 0 },
      });

      // Persist 4/5 attempt for c1
      const attempt1Id = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attempt1Id,
        student_id: student.id,
        concept_id: c1,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [
          { questionId: qIds[0], correct: true },
          { questionId: qIds[1], correct: true },
          { questionId: qIds[2], correct: true },
          { questionId: qIds[3], correct: true },
          { questionId: qIds[4], correct: false },
        ],
        encounter_id: encounterId,
        submitted_at: testDate.toISOString(),
      });

      // Apply quiz attempt evidence through canonical LearningEvidenceService
      await learningEvidenceService.applyQuizAttempt(studentActor, course.courseId, attempt1Id);

      // Call recordPracticeReward
      // Answers: 4 correct (first with 2 hints -> max(8, 30-12)=18, 3 with 0 hints -> 30 each), 1 wrong -> 8
      // Expected XP = 18 + 30 + 30 + 30 + 8 = 116
      const reward1 = await customGameService.recordPracticeReward(
        studentActor,
        student.id,
        attempt1Id,
        [
          { correct: true, hintsUsed: 2 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: false, hintsUsed: 0 },
        ],
      );

      expect(reward1.xpAwarded).toBe(116);
      expect(reward1.summary.xp).toBe(116);
      expect(reward1.dailyQuest?.items.find((i) => i.conceptId === c1)?.completed).toBe(true);
      expect(reward1.dailyQuest?.clearedAt).toBeNull();

      // Replay same attempt: awards 0 XP (exact-once)
      const replay = await customGameService.recordPracticeReward(
        studentActor,
        student.id,
        attempt1Id,
        [
          { correct: true, hintsUsed: 2 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: false, hintsUsed: 0 },
        ],
      );
      expect(replay.xpAwarded).toBe(0);
      expect(replay.summary.xp).toBe(116);

      // Complete concept c2 (4/5, 0 hints -> 128 XP)
      const attempt2Id = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attempt2Id,
        student_id: student.id,
        concept_id: c2,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
        submitted_at: testDate.toISOString(),
      });
      await learningEvidenceService.applyQuizAttempt(studentActor, course.courseId, attempt2Id);
      const reward2 = await customGameService.recordPracticeReward(
        studentActor,
        student.id,
        attempt2Id,
        [
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: false, hintsUsed: 0 },
        ],
      );
      expect(reward2.xpAwarded).toBe(128);
      expect(reward2.summary.xp).toBe(116 + 128);
      expect(reward2.dailyQuest?.clearedAt).toBeNull();

      // Complete concept c3 (4/5, 0 hints -> 128 XP) -> quest clears! (25 bonus)
      const attempt3Id = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attempt3Id,
        student_id: student.id,
        concept_id: c3,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
        submitted_at: testDate.toISOString(),
      });
      await learningEvidenceService.applyQuizAttempt(studentActor, course.courseId, attempt3Id);
      const reward3 = await customGameService.recordPracticeReward(
        studentActor,
        student.id,
        attempt3Id,
        [
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: false, hintsUsed: 0 },
        ],
      );
      expect(reward3.xpAwarded).toBe(128);
      // Total XP = 116 + 128 + 128 + 25 = 397
      expect(reward3.summary.xp).toBe(397);
      expect(reward3.dailyQuest?.clearedAt).not.toBeNull();
      expect(reward3.summary.streakDays).toBe(1);

      // Assert student_mastery.attempts was NOT incremented by practice attempts (INV-M03)
      const { data: masteryRow } = await harness.serviceClient
        .from("student_mastery")
        .select("attempts")
        .eq("student_id", student.id)
        .eq("concept_id", c1)
        .single();
      expect(masteryRow?.attempts).toBe(0);
    });

    it("5: Streak transitions and UTC date independence", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0]!;

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      let simulatedNow = new Date("2026-10-20T12:00:00.000Z");
      const localClock = {
        now: () => simulatedNow,
        nowISO: () => simulatedNow.toISOString(),
      };
      const localGameService = new ConcreteGameService({
        repository: gameRepository,
        courses: courseService,
        graph: graphRepository,
        mastery: masteryService,
        courseEffort: courseEffortService,
        publisher: { emitToStudent: async () => {} },
        clock: localClock,
        ids: new CryptoIdGenerator(),
      });

      // Day 1: 2026-10-20 clear -> streak 1
      await harness.serviceClient.from("daily_quests").insert({
        student_id: student.id,
        quest_date: "2026-10-20",
        concept_ids: [conceptId],
        completed_ids: [conceptId],
        cleared_at: "2026-10-20T10:00:00.000Z",
      });
      let summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(1);

      // Advance and clear October 21 -> streak 2
      simulatedNow = new Date("2026-10-21T12:00:00.000Z");
      await harness.serviceClient.from("daily_quests").insert({
        student_id: student.id,
        quest_date: "2026-10-21",
        concept_ids: [conceptId],
        completed_ids: [conceptId],
        cleared_at: "2026-10-21T10:00:00.000Z",
      });
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(2);

      // October 22 without clear -> retains active streak 2 (ending yesterday)
      simulatedNow = new Date("2026-10-22T12:00:00.000Z");
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(2);

      // October 23 before clearing -> streak lapses to 0 (October 22 was not cleared)
      simulatedNow = new Date("2026-10-23T12:00:00.000Z");
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(0);

      // Clear October 23 -> streak 1
      await harness.serviceClient.from("daily_quests").insert({
        student_id: student.id,
        quest_date: "2026-10-23",
        concept_ids: [conceptId],
        completed_ids: [conceptId],
        cleared_at: "2026-10-23T10:00:00.000Z",
      });
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(1);

      // Repeated read -> remains 1
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(1);

      // October 24 -> retains active streak 1 (ending yesterday)
      simulatedNow = new Date("2026-10-24T12:00:00.000Z");
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(1);

      // October 25 without another clear -> lapses to 0
      simulatedNow = new Date("2026-10-25T12:00:00.000Z");
      summary = await localGameService.getSummary(studentActor, student.id);
      expect(summary.streakDays).toBe(0);

      // Verify read did not create/clear quests or award XP
      const { data: quests } = await harness.serviceClient
        .from("daily_quests")
        .select("id")
        .eq("student_id", student.id);
      expect(quests).toHaveLength(3);

      const { data: xpRows } = await harness.serviceClient
        .from("xp_events")
        .select("id")
        .eq("student_id", student.id);
      expect(xpRows).toHaveLength(0);
    });

    it("6: Transactional rollback proof via trigger and PL/pgSQL sub-block", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0]!;

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      const questId = randomUUID();
      await harness.serviceClient.from("daily_quests").insert({
        id: questId,
        student_id: student.id,
        quest_date: "2026-10-24",
        concept_ids: [conceptId],
        completed_ids: [],
        version: 1,
      });

      const attemptId = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student.id,
        concept_id: conceptId,
        score: 1.0,
        correct_count: 5,
        total_questions: 5,
        submitted_answers: [],
        submitted_at: "2026-10-24T12:00:00.000Z",
      });
      await learningEvidenceService.applyQuizAttempt(studentActor, course.courseId, attemptId);

      // Execute transaction test using runPsql:
      // Install trigger that fails on amount = 25, run record_practice_reward in sub-block,
      // catch error, assert no xp_events and quest untouched, then ROLLBACK.
      const rollbackSql = `
        BEGIN;

        CREATE OR REPLACE FUNCTION public.test_reject_quest_bonus()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.amount = 25 AND NEW.student_id = '${student.id}'::uuid THEN
            RAISE EXCEPTION 'TEST_REJECT_BONUS' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_test_reject_bonus
        BEFORE INSERT ON public.xp_events
        FOR EACH ROW EXECUTE FUNCTION public.test_reject_quest_bonus();

        DO $$
        DECLARE
          v_res JSONB;
        BEGIN
          BEGIN
            SELECT public.record_practice_reward(
              '${studentUser.authId}'::uuid,
              '${student.id}'::uuid,
              '${attemptId}'::uuid,
              '[{"correct":true,"hintsUsed":0},{"correct":true,"hintsUsed":0},{"correct":true,"hintsUsed":0},{"correct":true,"hintsUsed":0},{"correct":true,"hintsUsed":0}]'::jsonb,
              '2026-10-24T12:00:00.000Z'::timestamptz
            ) INTO v_res;
          EXCEPTION WHEN OTHERS THEN
            -- Caught expected rejection
            NULL;
          END;
        END;
        $$;

        SELECT count(*) FROM public.xp_events WHERE student_id = '${student.id}'::uuid;
        SELECT cleared_at IS NOT NULL FROM public.daily_quests WHERE id = '${questId}'::uuid;

        ROLLBACK;
      `;

      const psqlOutput = runPsql(rollbackSql);
      // Verify count(*) is 0 and cleared_at IS NOT NULL is f
      expect(psqlOutput).toContain("0");
      expect(psqlOutput).toContain("f");
    });

    it("7: Eclipse diagnostics with examAt and target bounding", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 4 });
      const [c1, c2, c3, _c4] = course.conceptIds as [UUID, UUID, UUID, UUID];

      // Set exam_at on course
      const examDate = "2026-12-15T09:00:00.000Z";
      await harness.serviceClient
        .from("courses")
        .update({ exam_at: examDate })
        .eq("id", course.courseId);

      const studentUser = await harness.createTestUser(currentContext, "student");
      const student = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        course.joinCode,
      );
      const studentActor = harness.buildStudentActor(studentUser, [
        { studentId: student.id, courseId: course.courseId },
      ]);

      // Apply confidence: c1 = 0.25, c2 = 0.50, c3 = 0.75 (mastered >= 0.70 -> not an Eclipse target)
      await masteryService.applyEvidence(studentActor, student.id, c1, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });

      await masteryService.applyEvidence(studentActor, student.id, c2, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(studentActor, student.id, c2, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });

      await masteryService.applyEvidence(studentActor, student.id, c3, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(studentActor, student.id, c3, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });
      await masteryService.applyEvidence(studentActor, student.id, c3, {
        type: "quiz",
        score: 1.0,
        sourceId: randomUUID(),
      });
      const eclipse = await gameService.getEclipse(studentActor, student.id);
      expect(eclipse.examAt).toBe(examDate);
      expect(eclipse.targets.length).toBeLessThanOrEqual(3);
      // Mastered c3 should not be in targets
      expect(eclipse.targets.map((t) => t.conceptId)).not.toContain(c3);
    });

    it("8 & 9: Full HTTP router authorization, headers, and real-time Socket.IO emission", async () => {
      currentContext = { users: [], teacherIds: [], courseIds: [] };
      const course = await harness.createTestCourse(currentContext, { conceptCount: 1 });
      const conceptId = course.conceptIds[0]!;

      const studentUser1 = await harness.createTestUser(currentContext, "student");
      const studentUser2 = await harness.createTestUser(currentContext, "student");
      const teacherUser = currentContext.users.find((u) => u.authId === course.teacherAuthId)!;

      const student1 = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser1),
        course.joinCode,
      );
      const student2 = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser2),
        course.joinCode,
      );
      expect(student2.id).toBeDefined();

      // Sign in users
      const { data: s1Auth } = await harness.anonClient.auth.signInWithPassword({
        email: studentUser1.email,
        password: "TestPassword123!",
      });
      const s1Token = s1Auth.session!.access_token;

      const { data: s2Auth } = await harness.anonClient.auth.signInWithPassword({
        email: studentUser2.email,
        password: "TestPassword123!",
      });
      const s2Token = s2Auth.session!.access_token;

      const { data: tAuth } = await harness.anonClient.auth.signInWithPassword({
        email: teacherUser.email,
        password: "TestPassword123!",
      });
      const tToken = tAuth.session!.access_token;

      // Start full server instance
      const authGateway = createAuthGateway(harness.anonClient, harness.serviceClient);
      const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });

      const serverInstance = createServer({
        auth: authGateway,
        databaseClient: harness.serviceClient,
        aiClient,
        clock: {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        },
        ids: new CryptoIdGenerator(),
      });
      activeServers.push(serverInstance);

      const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers<number>();
      serverInstance.httpServer.listen(0, "127.0.0.1", () => {
        const addr = serverInstance.httpServer.address() as AddressInfo;
        listenResolve(addr.port);
      });
      const port = await listenPromise;
      const baseUrl = `http://127.0.0.1:${port}`;

      // Connect student 1 socket
      const student1Socket = createClientSocket(baseUrl, {
        auth: { token: s1Token },
        transports: ["websocket"],
      });
      activeSockets.push(student1Socket);

      const { promise: socketConnPromise, resolve: socketConnResolve } = Promise.withResolvers<void>();
      student1Socket.on("connect", () => socketConnResolve());
      await socketConnPromise;

      // Listen for game:updated
      const { promise: eventPromise, resolve: eventResolve } = Promise.withResolvers<unknown>();
      student1Socket.on("game:updated", (payload) => {
        eventResolve(payload);
      });

      // 1. HTTP GET /api/students/:studentId/game-summary
      // Unauthenticated -> 401
      const resUnauth = await fetch(`${baseUrl}/api/students/${student1.id}/game-summary`);
      expect(resUnauth.status).toBe(401);

      // Student 2 accessing Student 1 -> 403
      const resOtherStudent = await fetch(`${baseUrl}/api/students/${student1.id}/game-summary`, {
        headers: { Authorization: `Bearer ${s2Token}` },
      });
      expect(resOtherStudent.status).toBe(403);

      // Teacher accessing Student 1 -> 403
      const resTeacher = await fetch(`${baseUrl}/api/students/${student1.id}/game-summary`, {
        headers: { Authorization: `Bearer ${tToken}` },
      });
      expect(resTeacher.status).toBe(403);

      // Malformed student IDs across daily-quest, game-summary, and eclipse:
      // Missing token with malformed studentId -> 401
      for (const endpoint of ["daily-quest", "game-summary", "eclipse"]) {
        const unauthMalformed = await fetch(`${baseUrl}/api/students/not-a-uuid/${endpoint}`);
        expect(unauthMalformed.status).toBe(401);
      }

      // Authenticated with malformed studentId -> 400 VALIDATION_ERROR
      for (const endpoint of ["daily-quest", "game-summary", "eclipse"]) {
        const authMalformed = await fetch(`${baseUrl}/api/students/not-a-uuid/${endpoint}`, {
          headers: { Authorization: `Bearer ${s1Token}` },
        });
        expect(authMalformed.status).toBe(400);
        const errBody = (await authMalformed.json()) as { error?: { code?: string } };
        expect(errBody.error?.code).toBe("VALIDATION_ERROR");
      }
      // Student 1 accessing self -> 200 with Cache-Control: private, no-store
      const resSelf = await fetch(`${baseUrl}/api/students/${student1.id}/game-summary`, {
        headers: { Authorization: `Bearer ${s1Token}` },
      });
      expect(resSelf.status).toBe(200);
      expect(resSelf.headers.get("cache-control")).toBe("private, no-store");
      const summaryBody = (await resSelf.json()) as { studentId: string; xp: number };
      expect(summaryBody.studentId).toBe(student1.id);

      // GET daily-quest
      const resQuest = await fetch(`${baseUrl}/api/students/${student1.id}/daily-quest`, {
        headers: { Authorization: `Bearer ${s1Token}` },
      });
      expect(resQuest.status).toBe(200);
      expect(resQuest.headers.get("cache-control")).toBe("private, no-store");

      // GET eclipse
      const resEclipse = await fetch(`${baseUrl}/api/students/${student1.id}/eclipse`, {
        headers: { Authorization: `Bearer ${s1Token}` },
      });
      expect(resEclipse.status).toBe(200);
      expect(resEclipse.headers.get("cache-control")).toBe("private, no-store");

      // Trigger reward via core service with server's publisher
      const attemptId = randomUUID();
      await harness.serviceClient.from("quiz_attempts").insert({
        id: attemptId,
        student_id: student1.id,
        concept_id: conceptId,
        score: 0.8,
        correct_count: 4,
        total_questions: 5,
        submitted_answers: [],
        submitted_at: new Date().toISOString(),
      });
      const s1Actor = harness.buildStudentActor(studentUser1, [
        { studentId: student1.id, courseId: course.courseId },
      ]);
      await learningEvidenceService.applyQuizAttempt(s1Actor, course.courseId, attemptId);

      // Reward service configured with runtime publisher
      const runtimeGameService = new ConcreteGameService({
        repository: gameRepository,
        courses: courseService,
        graph: graphRepository,
        mastery: masteryService,
        courseEffort: courseEffortService,
        publisher: serverInstance.io ? {
          emitToStudent: async (sId, event, payload) => {
            serverInstance.io.to(`student:${sId}`).emit(event, payload);
          },
        } : { emitToStudent: async () => {} },
        clock: {
          now: () => new Date(),
          nowISO: () => new Date().toISOString(),
        },
        ids: new CryptoIdGenerator(),
      });

      await runtimeGameService.recordPracticeReward(
        s1Actor,
        student1.id,
        attemptId,
        [
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: true, hintsUsed: 0 },
          { correct: false, hintsUsed: 0 },
        ],
      );

      // Wait for Socket.IO event and validate schema
      const receivedEvent = await eventPromise;
      const parsedEvent = gameUpdatedEventSchema.safeParse(receivedEvent);
      expect(parsedEvent.success).toBe(true);
      if (parsedEvent.success) {
        expect(parsedEvent.data.studentId).toBe(student1.id);
        expect(parsedEvent.data.summary.xp).toBeGreaterThan(0);
      }
    });

    it(
      "7: Mascot evolution selects form from unrounded mean across concepts (INV-XP08)",
      async () => {
        currentContext = { users: [], teacherIds: [], courseIds: [] };
        const course = await harness.createTestCourse(currentContext, { conceptCount: 25 });
        expect(course.conceptIds).toHaveLength(25);

        const studentUser = await harness.createTestUser(currentContext, "student");
        const student = await enrollmentService.enrollStudent(
          harness.buildStudentActor(studentUser),
          course.joinCode,
        );
        const studentActor = harness.buildStudentActor(studentUser, [
          { studentId: student.id, courseId: course.courseId },
        ]);

        // 24 concepts: 0.25 confidence via two quiz attempts (scores 0.8 then 0.6)
        for (let i = 0; i < 24; i++) {
          const conceptId = course.conceptIds[i]!;
          await masteryService.applyEvidence(studentActor, student.id, conceptId, {
            type: "quiz",
            score: 0.8,
            sourceId: randomUUID(),
          });
          await masteryService.applyEvidence(studentActor, student.id, conceptId, {
            type: "quiz",
            score: 0.6,
            sourceId: randomUUID(),
          });
        }

        // 25th concept: 0.24 confidence via tutor (+0.20) and two quiz attempts with score 0 (+0.02 each)
        const lastConceptId = course.conceptIds[24]!;
        await masteryService.applyEvidence(studentActor, student.id, lastConceptId, {
          type: "tutor",
          sourceId: randomUUID(),
        });
        await masteryService.applyEvidence(studentActor, student.id, lastConceptId, {
          type: "quiz",
          score: 0.0,
          sourceId: randomUUID(),
        });
        await masteryService.applyEvidence(studentActor, student.id, lastConceptId, {
          type: "quiz",
          score: 0.0,
          sourceId: randomUUID(),
        });

        // Summary must compute unrounded mean: 6.24 / 25 = 0.2496 -> form "ember"
        const summary = await gameService.getSummary(studentActor, student.id);
        expect(summary.skyBrightness).toBeCloseTo(0.2496, 4);
        expect(summary.form).toBe("ember");
      },
      30_000,
    );

    it(
      "8: Repository pagination over 501 rows preserves chronological boundaries and latest updates",
      async () => {
        currentContext = { users: [], teacherIds: [], courseIds: [] };
        const course = await harness.createTestCourse(currentContext, { conceptCount: 2 });
        const conceptA = course.conceptIds[0]!;
        const conceptB = course.conceptIds[1]!;

        const studentUser = await harness.createTestUser(currentContext, "student");
        const student = await enrollmentService.enrollStudent(
          harness.buildStudentActor(studentUser),
          course.joinCode,
        );

        const baseTime = new Date("2025-01-01T12:00:00.000Z").getTime();
        const msPerDay = 86_400_000;

        const xpRows: Array<{
          id: string;
          student_id: string;
          amount: number;
          reason: "encounter";
          source_id: string;
          award_date: string;
          concept_id: string;
          created_at: string;
        }> = [];

        const questRows: Array<{
          id: string;
          student_id: string;
          quest_date: string;
          concept_ids: string[];
          completed_ids: string[];
          cleared_at: string;
          version: number;
        }> = [];

        const evidenceRows: Array<{
          id: string;
          student_id: string;
          concept_id: string;
          evidence_type: "quiz";
          source_id: string;
          prior_confidence: number;
          new_confidence: number;
          created_at: string;
        }> = [];

        for (let i = 0; i < 501; i++) {
          const timestamp = new Date(baseTime + i * msPerDay).toISOString();
          const dateStr = timestamp.slice(0, 10);
          const isLast = i === 500;

          xpRows.push({
            id: randomUUID(),
            student_id: student.id,
            amount: isLast ? 9 : 1,
            reason: "encounter",
            source_id: randomUUID(),
            award_date: dateStr,
            concept_id: conceptA,
            created_at: timestamp,
          });

          questRows.push({
            id: randomUUID(),
            student_id: student.id,
            quest_date: dateStr,
            concept_ids: isLast ? [conceptA, conceptB] : [conceptA],
            completed_ids: isLast ? [conceptA, conceptB] : [conceptA],
            cleared_at: timestamp,
            version: 1,
          });

          evidenceRows.push({
            id: randomUUID(),
            student_id: student.id,
            concept_id: i === 0 ? conceptB : conceptA,
            evidence_type: "quiz",
            source_id: randomUUID(),
            prior_confidence: 0.0,
            new_confidence: 0.0,
            created_at: timestamp,
          });
        }

        const insertXp = await harness.serviceClient.from("xp_events").insert(xpRows);
        expect(insertXp.error).toBeNull();

        const insertQuests = await harness.serviceClient.from("daily_quests").insert(questRows);
        expect(insertQuests.error).toBeNull();

        const insertEvidence = await harness.serviceClient.from("mastery_evidence").insert(evidenceRows);
        expect(insertEvidence.error).toBeNull();

        // 1. Verify XP pagination: 500*1 + 9 = 509 total XP, latest timestamp 2026-05-16T12:00:00.000Z
        const xpResult = await gameRepository.getTotalXpAndLatestTimestamp(student.id);
        expect(xpResult.totalXp).toBe(509);
        expect(xpResult.latestXpTimestamp).toBe("2026-05-16T12:00:00.000Z");

        // 2. Verify Review evidence pagination:
        // Concept B only on oldest date (2025-01-01), Concept A on all other 500 dates (latest 2026-05-16)
        const reviews = await gameRepository.getLatestCommittedReviews(student.id);
        expect(reviews.get(conceptB)?.toISOString()).toBe("2025-01-01T12:00:00.000Z");
        expect(reviews.get(conceptA)?.toISOString()).toBe("2026-05-16T12:00:00.000Z");

        // 3. Verify Cleared quests pagination:
        // 501 cleared quests, final row is May 16 with [conceptA, conceptB]
        const clearedQuests = await gameRepository.getAllClearedQuests(student.id);
        expect(clearedQuests).toHaveLength(501);
        const lastQuest = clearedQuests[clearedQuests.length - 1]!;
        expect(lastQuest.questDate).toBe("2026-05-16");
        expect(lastQuest.conceptIds).toEqual([conceptA, conceptB]);
        expect(lastQuest.completedIds).toEqual([conceptA, conceptB]);
      },
      30_000,
    );
  },
);
