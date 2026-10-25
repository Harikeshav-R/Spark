import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceTracker } from "../../../src/server/realtime/presence-tracker.js";
import type { UUID } from "../../../src/contracts/index.js";

const LECTURE_A = "11111111-1111-4111-8111-111111111111" as UUID;
const LECTURE_B = "22222222-2222-4222-8222-222222222222" as UUID;
const STUDENT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as UUID;
const STUDENT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as UUID;

describe("PresenceTracker", () => {
  let tracker: PresenceTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new PresenceTracker();
  });

  afterEach(() => {
    tracker.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("adds student on join and lists in active attendees", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);
  });

  it("handles duplicate joins idempotently without duplicate entries", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);
  });

  it("retains active presence when 1 of 2 tabs disconnects", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.join(LECTURE_A, STUDENT_1, "socket-2");

    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-1");

    // Advance 30s: presence should still remain because socket-2 is still connected
    vi.advanceTimersByTime(30_000);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);
  });

  it("retains presence during 30s grace window after last socket disconnects, then removes", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-1");

    // At 29,999ms, still present
    vi.advanceTimersByTime(29_999);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);

    // At 30,000ms, grace expires
    vi.advanceTimersByTime(1);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
  });

  it("cancels grace timer if student reconnects within grace window", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-1");

    // 15 seconds into grace, student reconnects on a new socket
    vi.advanceTimersByTime(15_000);
    tracker.join(LECTURE_A, STUDENT_1, "socket-2");

    // Advance another 20s (total 35s since first disconnect)
    vi.advanceTimersByTime(20_000);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);

    // Now disconnect socket-2; fresh 30s grace should start
    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-2");
    vi.advanceTimersByTime(29_999);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);

    vi.advanceTimersByTime(1);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
  });

  it("removes student immediately on explicit leave without grace period", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.leave(LECTURE_A, STUDENT_1, "socket-1");

    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
  });

  it("leaving 1 of 2 tabs retains active presence for remaining tab", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.join(LECTURE_A, STUDENT_1, "socket-2");

    tracker.leave(LECTURE_A, STUDENT_1, "socket-1");
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);
  });

  it("ignores unknown leave or disconnect calls without error", () => {
    expect(() => {
      tracker.leave(LECTURE_A, STUDENT_1, "unknown-socket");
      tracker.disconnect(LECTURE_A, STUDENT_1, "unknown-socket");
    }).not.toThrow();
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
  });

  it("does not extend grace timer on duplicate disconnect calls", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-1");

    vi.advanceTimersByTime(15_000);
    // Duplicate disconnect of already disconnected socket
    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-1");

    // Should expire at original 30s mark (15s remaining, not 30s)
    vi.advanceTimersByTime(15_000);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
  });

  it("maintains strict isolation between lectures and students", () => {
    tracker.join(LECTURE_A, STUDENT_1, "s1");
    tracker.join(LECTURE_A, STUDENT_2, "s2");
    tracker.join(LECTURE_B, STUDENT_1, "s3");

    expect(tracker.getAttendingStudentIds(LECTURE_A).sort()).toEqual([STUDENT_1, STUDENT_2].sort());
    expect(tracker.getAttendingStudentIds(LECTURE_B)).toEqual([STUDENT_1]);

    // Disconnect student 1 in lecture A
    tracker.disconnect(LECTURE_A, STUDENT_1, "s1");
    vi.advanceTimersByTime(30_000);

    // Student 1 gone from A, but Student 2 in A and Student 1 in B still present
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_2]);
    expect(tracker.getAttendingStudentIds(LECTURE_B)).toEqual([STUDENT_1]);
  });

  it("returns defensive copy of attending student IDs array", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    const attendees = tracker.getAttendingStudentIds(LECTURE_A);
    attendees.push(STUDENT_2);

    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([STUDENT_1]);
  });

  it("cleans up all timers on dispose and prevents resurrection", () => {
    tracker.join(LECTURE_A, STUDENT_1, "socket-1");
    tracker.disconnect(LECTURE_A, STUDENT_1, "socket-1");

    tracker.dispose();

    // Advance time after dispose
    vi.advanceTimersByTime(30_000);
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);

    // Further calls after dispose are no-ops
    tracker.join(LECTURE_A, STUDENT_1, "socket-2");
    expect(tracker.getAttendingStudentIds(LECTURE_A)).toEqual([]);
  });
});
