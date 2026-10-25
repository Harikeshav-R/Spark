import { describe, it, expect, vi } from "vitest";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  UUID,
} from "../../../src/contracts/common.js";
import type { RealtimePublisher, StudyGroupUpdatedEvent } from "../../../src/contracts/realtime.js";
import { AppError } from "../../../src/contracts/errors.js";
import type { ZoomMeetingService } from "../../../src/server/zoom/index.js";
import {
  MessagingRepository,
  SchedulerRepository,
  Scheduler,
} from "../../../src/server/study-groups/index.js";
import { createFixtureSupabaseClient } from "../../integration/lane-b/helpers/socket-fixture.js";

class TestClock implements Clock {
  currentTime: Date;
  constructor(iso = "2026-10-24T12:00:00.000Z") {
    this.currentTime = new Date(iso);
  }
  now(): Date {
    return this.currentTime;
  }
  nowISO(): string {
    return this.currentTime.toISOString();
  }
  setTime(iso: string) {
    this.currentTime = new Date(iso);
  }
  advance(ms: number) {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

class TestIdGenerator implements IdGenerator {
  private counter = 0;
  private prefix = "99999999-9999-4999-8999-";
  generateId(): UUID {
    this.counter++;
    return `${this.prefix}${this.counter.toString(16).padStart(12, "0")}`;
  }
  generateJoinCode(): string {
    return "ABC123";
  }
}

describe("P6-B-03: Availability Scheduler Unit Tests", () => {
  const courseId1 = "11111111-1111-4111-8111-111111111111";
  const courseId2 = "11111111-1111-4111-8111-111111111112";

  const studentId1 = "22222222-2222-4222-8222-222222222221";
  const studentAuthId1 = "33333333-3333-4333-8333-333333333331";

  const studentId2 = "22222222-2222-4222-8222-222222222222";
  const studentAuthId2 = "33333333-3333-4333-8333-333333333332";

  const studentId3 = "22222222-2222-4222-8222-222222222223";
  const studentAuthId3 = "33333333-3333-4333-8333-333333333333";

  // Multi-course student: student1 enrolled in course1 as studentId1 and in course2 as studentId1Alt
  const studentId1Alt = "22222222-2222-4222-8222-222222222224";

  const matchId1 = "44444444-4444-4444-8444-444444444441";

  const actorStudent1: ActorContext = {
    userId: studentAuthId1,
    authId: studentAuthId1,
    role: "student",
    name: "Ada Lovelace",
    email: "ada@example.edu",
    enrolledCourses: [
      { studentId: studentId1, courseId: courseId1 },
      { studentId: studentId1Alt, courseId: courseId2 },
    ],
  };

  // Multi-course actor whose relevant course enrollment is NOT first in array
  const actorStudent1Reverse: ActorContext = {
    userId: studentAuthId1,
    authId: studentAuthId1,
    role: "student",
    name: "Ada Lovelace",
    email: "ada@example.edu",
    enrolledCourses: [
      { studentId: studentId1Alt, courseId: courseId2 },
      { studentId: studentId1, courseId: courseId1 },
    ],
  };

  const actorStudent2: ActorContext = {
    userId: studentAuthId2,
    authId: studentAuthId2,
    role: "student",
    name: "Charles Babbage",
    email: "babbage@example.edu",
    enrolledCourses: [{ studentId: studentId2, courseId: courseId1 }],
  };

  const actorStudent3Outsider: ActorContext = {
    userId: studentAuthId3,
    authId: studentAuthId3,
    role: "student",
    name: "Outsider Student",
    email: "outsider@example.edu",
    enrolledCourses: [{ studentId: studentId3, courseId: courseId1 }],
  };

  const actorTeacher: ActorContext = {
    userId: "55555555-5555-4555-8555-555555555555",
    authId: "55555555-5555-4555-8555-555555555555",
    role: "teacher",
    teacherId: "66666666-6666-4666-8666-666666666666",
    name: "Prof. Euler",
    email: "euler@example.edu",
    enrolledCourses: [],
  };

  interface HarnessOptions {
    matchOverrides?: Partial<Record<string, unknown>>;
    availability?: Record<string, unknown>[];
    dbError?: boolean;
    clockTime?: string;
    meetings?: Pick<ZoomMeetingService, "createForCourse">;
  }

  function setupTestHarness(options: HarnessOptions = {}) {
    const defaultMatch = {
      id: matchId1,
      course_id: courseId1,
      student1_id: studentId1,
      student2_id: studentId2,
      concept_ids: ["77777777-7777-4777-8777-777777777777"],
      scheduling_status: "pending",
      proposed_start: null,
      proposed_end: null,
      student1_accepted: false,
      student2_accepted: false,
      meeting_status: "pending",
      zoom_meeting_id: null,
      zoom_link: null,
      status: "active",
      ...options.matchOverrides,
    };

    const fixtureDb = createFixtureSupabaseClient({
      databaseError: options.dbError,
      tableRows: {
        students: [
          { id: studentId1, auth_id: studentAuthId1, course_id: courseId1 },
          { id: studentId1Alt, auth_id: studentAuthId1, course_id: courseId2 },
          { id: studentId2, auth_id: studentAuthId2, course_id: courseId1 },
          { id: studentId3, auth_id: studentAuthId3, course_id: courseId1 },
        ],
        study_group_matches: [defaultMatch],
        student_availability: options.availability ?? [],
      },
    });

    const membership = new MessagingRepository(fixtureDb);
    const repository = new SchedulerRepository(fixtureDb);
    const publishedEvents: { matchId: UUID; eventName: string; payload: unknown }[] = [];
    const publisher: RealtimePublisher = {
      emitToLecture: vi.fn(async () => {}),
      emitToTeacher: vi.fn(async () => {}),
      emitToStudent: vi.fn(async () => {}),
      emitToStudyGroup: vi.fn(async (matchId, eventName, payload) => {
        publishedEvents.push({ matchId, eventName, payload });
      }),
    };
    const clock = new TestClock(options.clockTime ?? "2026-10-24T12:00:00.000Z");
    const ids = new TestIdGenerator();
    const meetings = options.meetings ?? {
      createForCourse: vi.fn(async () => ({
        meetingId: "9876543210",
        joinUrl: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
      })),
    };

    const scheduler = new Scheduler({
      membership,
      repository,
      meetings,
      publisher,
      clock,
      ids,
    });

    return {
      fixtureDb,
      membership,
      repository,
      meetings,
      publisher,
      publishedEvents,
      clock,
      ids,
      scheduler,
    };
  }

  describe("Availability Overlap Detection", () => {
    it("proposes exactly earliest 30-minute slot when windows overlap: 14:00-16:00 vs 15:00-17:00 => 15:00-15:30", async () => {
      const { scheduler, repository, publishedEvents } = setupTestHarness({
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T16:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T17:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);

      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      });

      // Verify persisted state
      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("proposed");
      expect(match?.proposedSlot).toEqual(res.proposedSlot);
      expect(match?.student1Accepted).toBe(false);
      expect(match?.student2Accepted).toBe(false);

      // Verify event was emitted
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.eventName).toBe("study-group:updated");
      const event = publishedEvents[0]?.payload as StudyGroupUpdatedEvent;
      expect(event.schedulingStatus).toBe("proposed");
      expect(event.proposedSlot).toEqual(res.proposedSlot);
    });

    it("chooses earliest overlap among unsorted multiple windows", async () => {
      const { scheduler } = setupTestHarness({
        availability: [
          // Student 1 has windows at 18:00-20:00 and 15:00-16:00 (unsorted)
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T18:00:00.000Z",
            ends_at: "2026-10-24T20:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T16:00:00.000Z",
          },
          // Student 2 is available 14:00-21:00
          {
            id: "aaaaaaaa-0000-4000-8000-000000000003",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T21:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent2, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      });
    });

    it("succeeds with exact 30-minute window overlap", async () => {
      const { scheduler } = setupTestHarness({
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T15:30:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T15:30:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      });
    });

    it("persists no-overlap with null proposal when intervals touch only at endpoints", async () => {
      const { scheduler, repository } = setupTestHarness({
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T15:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T16:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("no-overlap");
      expect(res.proposedSlot).toBeUndefined();

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("no-overlap");
      expect(match?.proposedSlot).toBeNull();
      expect(match?.student1Accepted).toBe(false);
      expect(match?.student2Accepted).toBe(false);
    });

    it("persists no-overlap when overlap is strictly sub-30m (e.g. 29m 59.999s)", async () => {
      const { scheduler } = setupTestHarness({
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T16:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T15:30:00.001Z",
            ends_at: "2026-10-24T16:30:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("no-overlap");
      expect(res.proposedSlot).toBeUndefined();
    });

    it("persists no-overlap when availability list is empty", async () => {
      const { scheduler, repository } = setupTestHarness({ availability: [] });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("no-overlap");
      expect(res.proposedSlot).toBeUndefined();

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("no-overlap");
      expect(match?.proposedSlot).toBeNull();
    });
  });

  describe("Window Unions, Clipping, and Normalization", () => {
    it("merges overlapping and adjacent own windows into continuous union", async () => {
      const { scheduler } = setupTestHarness({
        availability: [
          // Student 1 has two overlapping/adjacent intervals: 14:00-15:00 and 15:00-16:00 => 14:00-16:00
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T15:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T15:00:00.000Z",
            ends_at: "2026-10-24T16:00:00.000Z",
          },
          // Student 2 is available 14:30-15:30 (crossing student 1's boundary)
          {
            id: "aaaaaaaa-0000-4000-8000-000000000003",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T14:30:00.000Z",
            ends_at: "2026-10-24T15:30:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T14:30:00.000Z",
        endsAt: "2026-10-24T15:00:00.000Z",
      });
    });

    it("never bridges real gaps between disjoint own intervals", async () => {
      const { scheduler } = setupTestHarness({
        availability: [
          // Student 1: 14:00-14:20 is invalid duration by schema (<30m), but let's test two 30m intervals with a gap:
          // 14:00-14:30 and 14:40-15:10
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T14:30:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T14:40:00.000Z",
            ends_at: "2026-10-24T15:10:00.000Z",
          },
          // Student 2 only available during the gap: 14:20-14:50 (30m)
          // Overlap with first: 14:20-14:30 (10m). Overlap with second: 14:40-14:50 (10m). Neither is 30m!
          {
            id: "aaaaaaaa-0000-4000-8000-000000000003",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T14:20:00.000Z",
            ends_at: "2026-10-24T14:50:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("no-overlap");
      expect(res.proposedSlot).toBeUndefined();
    });

    it("drops expired availability and clips ongoing window at current clock instant", async () => {
      // Clock is at 14:15. Student 1 and Student 2 both have availability 14:00-15:00.
      // Proposing at 14:15 must propose 14:15-14:45, NOT 14:00-14:30.
      const { scheduler } = setupTestHarness({
        clockTime: "2026-10-24T14:15:00.000Z",
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T15:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T14:00:00.000Z",
            ends_at: "2026-10-24T15:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T14:15:00.000Z",
        endsAt: "2026-10-24T14:45:00.000Z",
      });
    });

    it("handles UTC day boundary correctly", async () => {
      const { scheduler } = setupTestHarness({
        clockTime: "2026-10-24T23:30:00.000Z",
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T23:45:00.000Z",
            ends_at: "2026-10-25T01:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T23:45:00.000Z",
            ends_at: "2026-10-25T01:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T23:45:00.000Z",
        endsAt: "2026-10-25T00:15:00.000Z",
      });
    });

    it("normalizes PostgreSQL +00:00 formatted timestamps into UTC ISO string", async () => {
      const { scheduler } = setupTestHarness({
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24 15:00:00+00",
            ends_at: "2026-10-24 16:00:00+00",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24 15:00:00+00",
            ends_at: "2026-10-24 16:00:00+00",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual({
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      });
    });
  });

  describe("Bilateral Consent & State Machine", () => {
    const validSlot = {
      startsAt: "2026-10-24T15:00:00.000Z",
      endsAt: "2026-10-24T15:30:00.000Z",
    };

    it("first student accepts: sets only student1_accepted, retains proposed status, bothAccepted is false", async () => {
      const { scheduler, repository, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: false,
          student2_accepted: false,
        },
      });

      const res = await scheduler.acceptSchedule(actorStudent1, matchId1, validSlot);
      expect(res.bothAccepted).toBe(false);

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("proposed");
      expect(match?.student1Accepted).toBe(true);
      expect(match?.student2Accepted).toBe(false);

      expect(publishedEvents).toHaveLength(1);
      const event = publishedEvents[0]?.payload as StudyGroupUpdatedEvent;
      expect(event.schedulingStatus).toBe("proposed");
      expect(event.student1Accepted).toBe(true);
      expect(event.student2Accepted).toBe(false);
    });

    it("repeated acceptance by same student is idempotent and cannot impersonate peer", async () => {
      const { scheduler, repository, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
        },
      });

      const res = await scheduler.acceptSchedule(actorStudent1, matchId1, validSlot);
      expect(res.bothAccepted).toBe(false);

      // No new write or event
      expect(publishedEvents).toHaveLength(0);

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("proposed");
      expect(match?.student1Accepted).toBe(true);
      expect(match?.student2Accepted).toBe(false); // Student 2 remains false
    });

    it("second distinct student accepts: sets student2_accepted, advances status to accepted, bothAccepted is true", async () => {
      const { scheduler, repository, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
        },
      });

      const res = await scheduler.acceptSchedule(actorStudent2, matchId1, validSlot);
      expect(res.bothAccepted).toBe(true);

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("accepted");
      expect(match?.student1Accepted).toBe(true);
      expect(match?.student2Accepted).toBe(true);

      expect(publishedEvents).toHaveLength(1);
      const event = publishedEvents[0]?.payload as StudyGroupUpdatedEvent;
      expect(event.schedulingStatus).toBe("accepted");
      expect(event.student1Accepted).toBe(true);
      expect(event.student2Accepted).toBe(true);
    });

    it("replaying acceptance on an already accepted schedule is idempotent", async () => {
      const { scheduler, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "accepted",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: true,
          meeting_status: "created",
          zoom_meeting_id: "9876543210",
          zoom_link: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
        },
      });

      const res1 = await scheduler.acceptSchedule(actorStudent1, matchId1, validSlot);
      expect(res1.bothAccepted).toBe(true);

      const res2 = await scheduler.acceptSchedule(actorStudent2, matchId1, validSlot);
      expect(res2.bothAccepted).toBe(true);

      expect(publishedEvents).toHaveLength(0);
    });

    it("multi-course actor whose relevant enrollment is not first is properly identified", async () => {
      const { scheduler, repository } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: false,
          student2_accepted: false,
        },
      });

      // actorStudent1Reverse has course2 first, course1 second
      const res = await scheduler.acceptSchedule(actorStudent1Reverse, matchId1, validSlot);
      expect(res.bothAccepted).toBe(false);

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.student1Accepted).toBe(true);
      expect(match?.student2Accepted).toBe(false);
    });

    it("creates meeting on bilateral consent, persists it before broadcast, and reuses on duplicate acceptance", async () => {
      const { scheduler, repository, meetings, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
          meeting_status: "pending",
          zoom_meeting_id: null,
          zoom_link: null,
        },
      });

      const res = await scheduler.acceptSchedule(actorStudent2, matchId1, validSlot);
      expect(res.bothAccepted).toBe(true);
      expect(res.zoomMeetingId).toBe("9876543210");
      expect(res.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

      expect(meetings.createForCourse).toHaveBeenCalledTimes(1);
      expect(meetings.createForCourse).toHaveBeenCalledWith(
        actorStudent2,
        courseId1,
        "Peer Study Session",
        validSlot.startsAt,
        30
      );

      // Verified from repository
      const updatedMatch = await repository.getMatch(courseId1, matchId1);
      expect(updatedMatch?.schedulingStatus).toBe("accepted");
      expect(updatedMatch?.meetingStatus).toBe("created");
      expect(updatedMatch?.zoomMeetingId).toBe("9876543210");
      expect(updatedMatch?.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

      // Verified event published with created meeting status and link
      expect(publishedEvents.length).toBe(1);
      const eventPayload = publishedEvents[0]!.payload as StudyGroupUpdatedEvent;
      expect(eventPayload.schedulingStatus).toBe("accepted");
      expect(eventPayload.meetingStatus).toBe("created");
      expect(eventPayload.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");

      // Repeated acceptance from Student 1 reuses existing meeting without calling Zoom
      const resDup = await scheduler.acceptSchedule(actorStudent1, matchId1, validSlot);
      expect(resDup.bothAccepted).toBe(true);
      expect(resDup.zoomMeetingId).toBe("9876543210");
      expect(resDup.zoomLink).toBe("https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123");
      expect(meetings.createForCourse).toHaveBeenCalledTimes(1);
    });

    it("handles provider failure during bilateral consent by persisting unavailable, emitting event, and propagating error", async () => {
      const failingMeetings = {
        createForCourse: vi.fn(async () => {
          throw new AppError({
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            message: "Zoom credentials are not configured",
          });
        }),
      };

      const { scheduler, repository, publishedEvents } = setupTestHarness({
        meetings: failingMeetings,
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
          meeting_status: "pending",
          zoom_meeting_id: null,
          zoom_link: null,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent2, matchId1, validSlot)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom credentials are not configured",
        })
      );

      // Repository still records accepted consent, but meetingStatus is unavailable
      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("accepted");
      expect(match?.student1Accepted).toBe(true);
      expect(match?.student2Accepted).toBe(true);
      expect(match?.meetingStatus).toBe("unavailable");
      expect(match?.zoomMeetingId).toBeNull();
      expect(match?.zoomLink).toBeNull();

      // Event was emitted for unavailable status without a join link
      expect(publishedEvents.length).toBe(1);
      const eventPayload = publishedEvents[0]!.payload as StudyGroupUpdatedEvent;
      expect(eventPayload.schedulingStatus).toBe("accepted");
      expect(eventPayload.meetingStatus).toBe("unavailable");
      expect(eventPayload.zoomLink).toBeUndefined();

      // Subsequent accept calls throw 503 unavailable
      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, validSlot)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom meeting is unavailable for this session",
        })
      );
    });

    it("throws 503 if attempting to accept an already accepted match whose meeting is still pending", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "accepted",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: true,
          meeting_status: "pending",
          zoom_meeting_id: null,
          zoom_link: null,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, validSlot)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "SERVICE_UNAVAILABLE",
          statusCode: 503,
          message: "Zoom meeting creation is incomplete",
        })
      );
    });
  });

  describe("Validation & Error Boundaries", () => {
    const validSlot = {
      startsAt: "2026-10-24T15:00:00.000Z",
      endsAt: "2026-10-24T15:30:00.000Z",
    };

    it("rejects invalid slot format with 400 VALIDATION_ERROR", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, {
          startsAt: "invalid-date",
          endsAt: "invalid-date",
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects slot with duration < 30 minutes with 400 VALIDATION_ERROR", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, {
          startsAt: "2026-10-24T15:00:00.000Z",
          endsAt: "2026-10-24T15:20:00.000Z",
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("rejects acceptSchedule when match has no active proposal (pending or no-overlap) with 409 CONFLICT", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "pending",
          proposed_start: null,
          proposed_end: null,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, validSlot)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });
    });

    it("rejects acceptSchedule with mismatched slot endpoints with 409 CONFLICT", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
        },
      });

      const differentSlot = {
        startsAt: "2026-10-24T16:00:00.000Z",
        endsAt: "2026-10-24T16:30:00.000Z",
      };

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, differentSlot)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });
    });

    it("rejects acceptSchedule for a not-yet-accepted proposal whose start has already passed with 409 CONFLICT", async () => {
      const { scheduler } = setupTestHarness({
        clockTime: "2026-10-24T16:00:00.000Z", // Past the proposed slot 15:00
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: false,
          student2_accepted: false,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, validSlot)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });
    });

    it("rejects acceptSchedule and proposeSchedule on non-active match (completed or cancelled) with 409 CONFLICT", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          status: "completed",
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, validSlot)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      await expect(
        scheduler.proposeSchedule(actorStudent1, matchId1)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });
    });

    it("rejects re-proposing an already accepted schedule with 409 CONFLICT", async () => {
      const { scheduler } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "accepted",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: true,
          student2_accepted: true,
        },
      });

      await expect(
        scheduler.proposeSchedule(actorStudent1, matchId1)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });
    });

    it("rejects non-members and teachers with 403 FORBIDDEN and performs no mutation", async () => {
      const { scheduler, repository, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
        },
      });

      // Outsider student enrolled in course but not member of match
      await expect(
        scheduler.acceptSchedule(actorStudent3Outsider, matchId1, validSlot)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      await expect(
        scheduler.proposeSchedule(actorStudent3Outsider, matchId1)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      // Teacher role
      await expect(
        scheduler.acceptSchedule(actorTeacher, matchId1, validSlot)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });

      expect(publishedEvents).toHaveLength(0);
      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.student1Accepted).toBe(false);
      expect(match?.student2Accepted).toBe(false);
    });
  });

  describe("Re-proposals & Consent Reset", () => {
    it("re-proposing unchanged slot preserves existing student consent", async () => {
      const slot = {
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      };

      const { scheduler, repository, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: slot.startsAt,
          proposed_end: slot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
        },
        availability: [
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: slot.startsAt,
            ends_at: "2026-10-24T16:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: slot.startsAt,
            ends_at: "2026-10-24T16:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual(slot);

      // Proposal is identical, so no mutation / no event
      expect(publishedEvents).toHaveLength(0);

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.student1Accepted).toBe(true);
    });

    it("re-proposing when availability changes to a new slot resets both acceptance flags to false", async () => {
      const oldSlot = {
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      };
      const newSlot = {
        startsAt: "2026-10-24T16:00:00.000Z",
        endsAt: "2026-10-24T16:30:00.000Z",
      };

      const { scheduler, repository, publishedEvents } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: oldSlot.startsAt,
          proposed_end: oldSlot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
        },
        availability: [
          // Availability shifted to 16:00-17:00
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: "2026-10-24T16:00:00.000Z",
            ends_at: "2026-10-24T17:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: "2026-10-24T16:00:00.000Z",
            ends_at: "2026-10-24T17:00:00.000Z",
          },
        ],
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("proposed");
      expect(res.proposedSlot).toEqual(newSlot);

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.proposedSlot).toEqual(newSlot);
      expect(match?.student1Accepted).toBe(false); // Reset to false!
      expect(match?.student2Accepted).toBe(false);

      expect(publishedEvents).toHaveLength(1);
      const event = publishedEvents[0]?.payload as StudyGroupUpdatedEvent;
      expect(event.student1Accepted).toBe(false);
      expect(event.student2Accepted).toBe(false);
    });

    it("re-proposing with no remaining overlap changes status to no-overlap and removes stale slot", async () => {
      const oldSlot = {
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      };

      const { scheduler, repository } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: oldSlot.startsAt,
          proposed_end: oldSlot.endsAt,
          student1_accepted: true,
          student2_accepted: false,
        },
        availability: [], // No availability
      });

      const res = await scheduler.proposeSchedule(actorStudent1, matchId1);
      expect(res.schedulingStatus).toBe("no-overlap");
      expect(res.proposedSlot).toBeUndefined();

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.schedulingStatus).toBe("no-overlap");
      expect(match?.proposedSlot).toBeNull();
      expect(match?.student1Accepted).toBe(false);
      expect(match?.student2Accepted).toBe(false);
    });
  });

  describe("Concurrency & Stale Snapshot CAS", () => {
    const validSlot = {
      startsAt: "2026-10-24T15:00:00.000Z",
      endsAt: "2026-10-24T15:30:00.000Z",
    };

    it("rejects concurrent stale CAS update with 409 conflict, preserves winner's consent, and fresh retry succeeds", async () => {
      const { scheduler, repository, membership, meetings, publisher, clock, ids } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
          student1_accepted: false,
          student2_accepted: false,
        },
      });

      // Both students read the match snapshot where student1_accepted = false and student2_accepted = false
      const initialSnapshot = await repository.getMatch(courseId1, matchId1);
      expect(initialSnapshot).not.toBeNull();

      // Student 1 accepts successfully
      const res1 = await scheduler.acceptSchedule(actorStudent1, matchId1, validSlot);
      expect(res1.bothAccepted).toBe(false);

      // Now Student 2 attempts CAS using the stale initial snapshot
      // (where student1_accepted was false)
      const staleDesired = {
        schedulingStatus: "accepted" as const,
        proposedSlot: initialSnapshot!.proposedSlot,
        student1Accepted: initialSnapshot!.student1Accepted, // false! But in DB it's now true!
        student2Accepted: true,
      };

      const casResult = await repository.compareAndSet(initialSnapshot!, staleDesired);
      expect(casResult).toBeNull(); // CAS failed due to predicate mismatch!

      // Verify Student 1's accepted consent was NOT lost or overwritten
      const midMatch = await repository.getMatch(courseId1, matchId1);
      expect(midMatch?.student1Accepted).toBe(true);
      expect(midMatch?.student2Accepted).toBe(false);

      // Now Student 2 retries via fresh Scheduler call (which fetches fresh state)
      const freshScheduler = new Scheduler({
        membership,
        repository,
        meetings,
        publisher,
        clock,
        ids,
      });

      const res2 = await freshScheduler.acceptSchedule(actorStudent2, matchId1, validSlot);
      expect(res2.bothAccepted).toBe(true);

      const finalMatch = await repository.getMatch(courseId1, matchId1);
      expect(finalMatch?.schedulingStatus).toBe("accepted");
      expect(finalMatch?.student1Accepted).toBe(true);
      expect(finalMatch?.student2Accepted).toBe(true);
    });

    it("prevents combining consent across different proposal intervals when re-proposal races with acceptance", async () => {
      const slotA = {
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      };
      const slotB = {
        startsAt: "2026-10-24T16:00:00.000Z",
        endsAt: "2026-10-24T16:30:00.000Z",
      };

      const { scheduler, repository } = setupTestHarness({
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: slotA.startsAt,
          proposed_end: slotA.endsAt,
          student1_accepted: false,
          student2_accepted: false,
        },
        availability: [
          // New availability matches slot B
          {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            student_id: studentId1,
            course_id: courseId1,
            starts_at: slotB.startsAt,
            ends_at: "2026-10-24T17:00:00.000Z",
          },
          {
            id: "aaaaaaaa-0000-4000-8000-000000000002",
            student_id: studentId2,
            course_id: courseId1,
            starts_at: slotB.startsAt,
            ends_at: "2026-10-24T17:00:00.000Z",
          },
        ],
      });

      // Re-propose: status stays proposed, but slot changes to slotB
      await scheduler.proposeSchedule(actorStudent1, matchId1);

      // Student 2 tries to accept stale slotA: must fail with 409 CONFLICT!
      await expect(
        scheduler.acceptSchedule(actorStudent2, matchId1, slotA)
      ).rejects.toMatchObject({
        code: "CONFLICT",
        statusCode: 409,
      });

      const match = await repository.getMatch(courseId1, matchId1);
      expect(match?.proposedSlot).toEqual(slotB);
      expect(match?.student1Accepted).toBe(false);
      expect(match?.student2Accepted).toBe(false);
    });
  });

  describe("Event Emission Guarantee (Persist Before Broadcast)", () => {
    it("at the moment publisher is called, persisted state already matches the event", async () => {
      const validSlot = {
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      };

      let verifiedStateAtPublish: boolean | null = null;

      const fixtureDb = createFixtureSupabaseClient({
        tableRows: {
          students: [
            { id: studentId1, auth_id: studentAuthId1, course_id: courseId1 },
            { id: studentId2, auth_id: studentAuthId2, course_id: courseId1 },
          ],
          study_group_matches: [
            {
              id: matchId1,
              course_id: courseId1,
              student1_id: studentId1,
              student2_id: studentId2,
              concept_ids: ["77777777-7777-4777-8777-777777777777"],
              scheduling_status: "proposed",
              proposed_start: validSlot.startsAt,
              proposed_end: validSlot.endsAt,
              student1_accepted: false,
              student2_accepted: false,
              meeting_status: "pending",
              zoom_meeting_id: null,
              zoom_link: null,
              status: "active",
            },
          ],
          student_availability: [],
        },
      });

      const membership = new MessagingRepository(fixtureDb);
      const repository = new SchedulerRepository(fixtureDb);

      const publisher: RealtimePublisher = {
        emitToLecture: vi.fn(async () => {}),
        emitToTeacher: vi.fn(async () => {}),
        emitToStudent: vi.fn(async () => {}),
        emitToStudyGroup: vi.fn(async (_matchId, _event, payload) => {
          // GATE 5 verification: query repository right now!
          const persisted = await repository.getMatch(courseId1, matchId1);
          const eventPayload = payload as StudyGroupUpdatedEvent;
          verifiedStateAtPublish =
            persisted !== null &&
            persisted.student1Accepted === eventPayload.student1Accepted &&
            persisted.student1Accepted === true;
        }),
      };

      const scheduler = new Scheduler({
        membership,
        repository,
        meetings: {
          createForCourse: vi.fn(async () => ({
            meetingId: "9876543210",
            joinUrl: "https://us05web.zoom.us/j/9876543210?pwd=syntheticMeetingPassword123",
          })),
        },
        publisher,
        clock: new TestClock(),
        ids: new TestIdGenerator(),
      });

      await scheduler.acceptSchedule(actorStudent1, matchId1, validSlot);

      expect(verifiedStateAtPublish).toBe(true);
    });

    it("never emits an event or reports success when persistence fails", async () => {
      const validSlot = {
        startsAt: "2026-10-24T15:00:00.000Z",
        endsAt: "2026-10-24T15:30:00.000Z",
      };

      const { scheduler, publishedEvents } = setupTestHarness({
        dbError: true, // Database fails
        matchOverrides: {
          scheduling_status: "proposed",
          proposed_start: validSlot.startsAt,
          proposed_end: validSlot.endsAt,
        },
      });

      await expect(
        scheduler.acceptSchedule(actorStudent1, matchId1, validSlot)
      ).rejects.toThrow();

      expect(publishedEvents).toHaveLength(0);
    });
  });
});
