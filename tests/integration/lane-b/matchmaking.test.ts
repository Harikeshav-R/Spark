import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../lane-a/supabase-harness.js";
import { EnrollmentService } from "../../../src/server/core/enrollment/enrollment-service.js";
import { EnrollmentRepository } from "../../../src/server/core/enrollment/enrollment-repository.js";
import { CourseService } from "../../../src/server/core/courses/course-service.js";
import { CourseRepository } from "../../../src/server/core/courses/course-repository.js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator.js";
import type {
  Clock,
  ISOTimestamp,
} from "../../../src/contracts/common.js";
import { FakeRealtimePublisher } from "../../fixtures/classroom.fixture.js";
import {
  PoolRepository,
  type PoolDatabaseClientPort,
  MatchRepository,
  StudyGroupService,
} from "../../../src/server/study-groups/index.js";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowISO(): ISOTimestamp {
    return new Date().toISOString();
  }
}

describe.skipIf(process.env.RUN_LOCAL_SUPABASE !== "1")(
  "P6-B-01: Matchmaking Engine Integration (Local PostgreSQL)",
  () => {
  let harness: SupabaseTestHarness;
  let context: TestContext;
  let enrollmentService: EnrollmentService;
  let courseService: CourseService;
  let idGenerator: CryptoIdGenerator;
  let clock: SystemClock;

  beforeAll(() => {
    harness = new SupabaseTestHarness();
    idGenerator = new CryptoIdGenerator();
    clock = new SystemClock();
    enrollmentService = new EnrollmentService(
      new EnrollmentRepository(harness.serviceClient),
    );
    courseService = new CourseService(
      new CourseRepository(harness.serviceClient),
      idGenerator,
    );
  });

  afterEach(async () => {
    if (context) {
      await harness.cleanup(context);
    }
  });

  it("persists match, updates pool status to matched, and ensures DB state is visible at event publication", async () => {
    context = { users: [], teacherIds: [], courseIds: [] };
    const course = await harness.createTestCourse(context, { conceptCount: 3 });
    const conceptBackprop = course.conceptIds[0];

    // Create 2 test students
    const userHari = await harness.createTestUser(context, "student", {
      name: "Hari",
    });
    const userRahul = await harness.createTestUser(context, "student", {
      name: "Rahul",
    });

    const studentHari = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userHari),
      course.joinCode,
    );
    const studentRahul = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userRahul),
      course.joinCode,
    );

    const actorHari = harness.buildStudentActor(userHari, [
      { studentId: studentHari.id, courseId: course.courseId },
    ]);
    const actorRahul = harness.buildStudentActor(userRahul, [
      { studentId: studentRahul.id, courseId: course.courseId },
    ]);

    // Insert mastery: Hari 0.80, Rahul 0.15 (gap 0.65 >= 0.30)
    await harness.serviceClient.from("student_mastery").upsert(
      [
        {
          student_id: studentHari.id,
          concept_id: conceptBackprop,
          confidence: 0.8,
          attempts: 2,
        },
        {
          student_id: studentRahul.id,
          concept_id: conceptBackprop,
          confidence: 0.15,
          attempts: 1,
        },
      ],
      { onConflict: "student_id,concept_id" },
    );

    // Cast serviceClient to PoolDatabaseClientPort to avoid postgrest deep generic recursion
    const poolRepo = new PoolRepository(harness.serviceClient as unknown as PoolDatabaseClientPort);
    const matchRepo = new MatchRepository(harness.serviceClient);
    const publisher = new FakeRealtimePublisher();

    // Verify DB visibility during event emission
    let dbVisibleAtEmission = false;
    const originalEmit = publisher.emitToStudent.bind(publisher);
    publisher.emitToStudent = async (studentId, event, payload) => {
      await originalEmit(studentId, event, payload);
      // Query DB immediately during event publication
      const { data: matchRows } = await harness.serviceClient
        .from("study_group_matches")
        .select("id, status, student1_id, student2_id")
        .eq("course_id", course.courseId);

      const { data: poolRows } = await harness.serviceClient
        .from("study_group_pool")
        .select("student_id, status")
        .eq("course_id", course.courseId);

      if (
        matchRows &&
        matchRows.length === 1 &&
        matchRows[0].status === "active" &&
        poolRows &&
        poolRows.every((r) => r.status === "matched")
      ) {
        dbVisibleAtEmission = true;
      }
    };

    const service = new StudyGroupService({
      courses: courseService,
      pool: poolRepo,
      matches: matchRepo,
      publisher,
      clock,
      ids: idGenerator,
    });

    // 1. Hari opts into pool -> waiting
    const hariRes = await service.optIntoPool(actorHari, course.courseId, [
      conceptBackprop,
    ]);
    expect(hariRes.status).toBe("waiting");

    // 2. Rahul opts into pool -> matched
    const rahulRes = await service.optIntoPool(actorRahul, course.courseId, [
      conceptBackprop,
    ]);
    expect(rahulRes.status).toBe("matched");
    expect(rahulRes.matchId).toBeDefined();

    // Persistence before broadcast invariant
    expect(dbVisibleAtEmission).toBe(true);

    // Verify match in DB
    const { data: matchRecord } = await harness.serviceClient
      .from("study_group_matches")
      .select("*")
      .eq("id", rahulRes.matchId!)
      .single();

    expect(matchRecord).not.toBeNull();
    expect(matchRecord.course_id).toBe(course.courseId);
    expect(matchRecord.status).toBe("active");

    // Canonical ordering: student1_id < student2_id
    const [expectedS1, expectedS2] =
      studentHari.id < studentRahul.id
        ? [studentHari.id, studentRahul.id]
        : [studentRahul.id, studentHari.id];
    expect(matchRecord.student1_id).toBe(expectedS1);
    expect(matchRecord.student2_id).toBe(expectedS2);
  });

  it("races two concurrent workers for the same waiting peer: exactly one winner, canonical ordering, no double-match", async () => {
    context = { users: [], teacherIds: [], courseIds: [] };
    const course = await harness.createTestCourse(context, { conceptCount: 3 });
    const conceptBackprop = course.conceptIds[0];

    // Create 3 test students: Hari (waiting), Rahul (contender 1), Peer 3 (contender 2)
    const userHari = await harness.createTestUser(context, "student", {
      name: "Hari",
    });
    const userRahul = await harness.createTestUser(context, "student", {
      name: "Rahul",
    });
    const userPeer3 = await harness.createTestUser(context, "student", {
      name: "Peer3",
    });

    const studentHari = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userHari),
      course.joinCode,
    );
    const studentRahul = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userRahul),
      course.joinCode,
    );
    const studentPeer3 = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userPeer3),
      course.joinCode,
    );

    const actorHari = harness.buildStudentActor(userHari, [
      { studentId: studentHari.id, courseId: course.courseId },
    ]);
    const actorRahul = harness.buildStudentActor(userRahul, [
      { studentId: studentRahul.id, courseId: course.courseId },
    ]);
    const actorPeer3 = harness.buildStudentActor(userPeer3, [
      { studentId: studentPeer3.id, courseId: course.courseId },
    ]);

    // Setup complementary mastery:
    // Hari: 0.80, Rahul: 0.15 (gap 0.65), Peer3: 0.10 (gap 0.70)
    await harness.serviceClient.from("student_mastery").upsert(
      [
        {
          student_id: studentHari.id,
          concept_id: conceptBackprop,
          confidence: 0.8,
          attempts: 2,
        },
        {
          student_id: studentRahul.id,
          concept_id: conceptBackprop,
          confidence: 0.15,
          attempts: 1,
        },
        {
          student_id: studentPeer3.id,
          concept_id: conceptBackprop,
          confidence: 0.1,
          attempts: 1,
        },
      ],
      { onConflict: "student_id,concept_id" },
    );

    const poolRepo = new PoolRepository(harness.serviceClient as unknown as PoolDatabaseClientPort);
    const matchRepo = new MatchRepository(harness.serviceClient);

    const serviceWorker1 = new StudyGroupService({
      courses: courseService,
      pool: poolRepo,
      matches: matchRepo,
      publisher: new FakeRealtimePublisher(),
      clock,
      ids: idGenerator,
    });

    const serviceWorker2 = new StudyGroupService({
      courses: courseService,
      pool: poolRepo,
      matches: matchRepo,
      publisher: new FakeRealtimePublisher(),
      clock,
      ids: idGenerator,
    });

    // Hari opts in first and is waiting
    const hariRes = await serviceWorker1.optIntoPool(
      actorHari,
      course.courseId,
      [conceptBackprop],
    );
    expect(hariRes.status).toBe("waiting");

    // Race serviceWorker1 (Rahul) and serviceWorker2 (Peer3) simultaneously
    const [resultRahul, resultPeer3] = await Promise.all([
      serviceWorker1.optIntoPool(actorRahul, course.courseId, [
        conceptBackprop,
      ]),
      serviceWorker2.optIntoPool(actorPeer3, course.courseId, [
        conceptBackprop,
      ]),
    ]);

    // One worker won and matched with Hari; the other remained waiting (or conflict)
    const statuses = [resultRahul.status, resultPeer3.status];
    expect(statuses).toContain("matched");
    expect(statuses).toContain("waiting");

    // Inspect database matches: exactly one match must exist
    const { data: matches } = await harness.serviceClient
      .from("study_group_matches")
      .select("*")
      .eq("course_id", course.courseId);

    expect(matches).not.toBeNull();
    expect(matches).toHaveLength(1);

    const match = matches![0];
    expect(match.status).toBe("active");
    // Hari is in the match
    expect([match.student1_id, match.student2_id]).toContain(studentHari.id);
    // Student ordering is canonical
    expect(match.student1_id < match.student2_id).toBe(true);

    // Inspect pool rows: Hari is matched, exactly one contender is matched, other is waiting
    const { data: poolRows } = await harness.serviceClient
      .from("study_group_pool")
      .select("student_id, status")
      .eq("course_id", course.courseId);

    const hariPool = poolRows?.find((r) => r.student_id === studentHari.id);
    expect(hariPool?.status).toBe("matched");

    const matchedContenders = poolRows?.filter(
      (r) =>
        (r.student_id === studentRahul.id ||
          r.student_id === studentPeer3.id) &&
        r.status === "matched",
    );
    const waitingContenders = poolRows?.filter(
      (r) =>
        (r.student_id === studentRahul.id ||
          r.student_id === studentPeer3.id) &&
        r.status === "waiting",
    );
    expect(matchedContenders).toHaveLength(1);
    expect(waitingContenders).toHaveLength(1);
  });

  it("handles cancellation before candidate opt-in: no match created", async () => {
    context = { users: [], teacherIds: [], courseIds: [] };
    const course = await harness.createTestCourse(context, { conceptCount: 3 });
    const conceptBackprop = course.conceptIds[0];

    const userHari = await harness.createTestUser(context, "student", {
      name: "Hari",
    });
    const userRahul = await harness.createTestUser(context, "student", {
      name: "Rahul",
    });

    const studentHari = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userHari),
      course.joinCode,
    );
    const studentRahul = await enrollmentService.enrollStudent(
      harness.buildStudentActor(userRahul),
      course.joinCode,
    );

    const actorHari = harness.buildStudentActor(userHari, [
      { studentId: studentHari.id, courseId: course.courseId },
    ]);
    const actorRahul = harness.buildStudentActor(userRahul, [
      { studentId: studentRahul.id, courseId: course.courseId },
    ]);

    await harness.serviceClient.from("student_mastery").upsert(
      [
        {
          student_id: studentHari.id,
          concept_id: conceptBackprop,
          confidence: 0.8,
          attempts: 2,
        },
        {
          student_id: studentRahul.id,
          concept_id: conceptBackprop,
          confidence: 0.15,
          attempts: 1,
        },
      ],
      { onConflict: "student_id,concept_id" },
    );

    const service = new StudyGroupService({
      courses: courseService,
      pool: new PoolRepository(harness.serviceClient as unknown as PoolDatabaseClientPort),
      matches: new MatchRepository(harness.serviceClient),
      publisher: new FakeRealtimePublisher(),
      clock,
      ids: idGenerator,
    });

    // 1. Hari opts into pool
    await service.optIntoPool(actorHari, course.courseId, [conceptBackprop]);

    // 2. Hari opts out before Rahul opts in
    await service.optOutOfPool(actorHari, course.courseId);

    // 3. Rahul opts in
    const rahulRes = await service.optIntoPool(actorRahul, course.courseId, [
      conceptBackprop,
    ]);

    // Rahul should be waiting, not matched
    expect(rahulRes.status).toBe("waiting");

    // Zero matches created
    const { data: matches } = await harness.serviceClient
      .from("study_group_matches")
      .select("id")
      .eq("course_id", course.courseId);
    expect(matches).toHaveLength(0);
  });
  },
);
