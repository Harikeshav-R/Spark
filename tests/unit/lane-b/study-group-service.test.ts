import { describe, it, expect, vi } from "vitest";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  ISOTimestamp,
  UUID,
} from "../../../src/contracts/common.js";
import type { Course } from "../../../src/contracts/course.js";
import { AppError } from "../../../src/contracts/errors.js";
import type { StudyGroupMatchedEvent } from "../../../src/contracts/realtime.js";
import { FakeRealtimePublisher } from "../../fixtures/classroom.fixture.js";
import {
  StudyGroupService,
  type StudyGroupServiceDependencies,
} from "../../../src/server/study-groups/study-group-service.js";
import type {
  PoolEntry,
  InsertPoolEntryInput,
} from "../../../src/server/study-groups/pool-repository.js";
import type { MatchProfile } from "../../../src/server/study-groups/matchmaker.js";

class TestClock implements Clock {
  private currentTime: number;

  constructor(initialIso: string = "2026-10-24T12:00:00.000Z") {
    this.currentTime = new Date(initialIso).getTime();
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  nowISO(): ISOTimestamp {
    return new Date(this.currentTime).toISOString();
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }

  setTime(iso: string): void {
    this.currentTime = new Date(iso).getTime();
  }
}

class TestIdGenerator implements IdGenerator {
  private count = 0;

  generateId(): UUID {
    this.count++;
    return `00000000-0000-4000-8000-${this.count.toString().padStart(12, "0")}`;
  }

  generateJoinCode(): string {
    return "TEST01";
  }
}

describe("P6-B-01: StudyGroupService", () => {
  const courseId: UUID = "11111111-1111-4111-8111-111111111111";
  const otherCourseId: UUID = "22222222-2222-4222-8222-222222222222";

  const studentHariId: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const studentRahulId: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const studentPeer2Id: UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const conceptBackprop: UUID = "99999999-9999-4999-8999-999999999999";
  const conceptGradientDescent: UUID = "88888888-8888-4888-8888-888888888888";
  const conceptOtherCourse: UUID = "77777777-7777-4777-8777-777777777777";

  const actorHari: ActorContext = {
    userId: studentHariId,
    authId: "00000000-0000-4000-8000-000000000001",
    email: "hari@example.com",
    name: "Hari",
    role: "student",
    enrolledCourses: [{ courseId, studentId: studentHariId }],
  };

  const actorRahul: ActorContext = {
    userId: studentRahulId,
    authId: "00000000-0000-4000-8000-000000000002",
    email: "rahul@example.com",
    name: "Rahul",
    role: "student",
    enrolledCourses: [{ courseId, studentId: studentRahulId }],
  };

  const actorTeacher: ActorContext = {
    userId: "00000000-0000-4000-8000-000000000099",
    authId: "00000000-0000-4000-8000-000000000099",
    email: "teacher@example.com",
    name: "Prof Teacher",
    role: "teacher",
    enrolledCourses: [],
  };

  function setupService(overrides?: {
    initialPoolEntries?: PoolEntry[];
    courseConcepts?: UUID[];
    profiles?: Map<UUID, MatchProfile>;
    claimMatchHandler?: (
      courseId: UUID,
      sA: UUID,
      sB: UUID,
      c: UUID[],
    ) => Promise<UUID | null>;
  }) {
    const clock = new TestClock("2026-10-24T12:00:00.000Z");
    const ids = new TestIdGenerator();
    const publisher = new FakeRealtimePublisher();

    const poolEntries = new Map<string, PoolEntry>();
    if (overrides?.initialPoolEntries) {
      for (const e of overrides.initialPoolEntries) {
        poolEntries.set(`${e.studentId}:${e.courseId}`, { ...e });
      }
    }

    const courseConcepts = new Set(
      overrides?.courseConcepts ?? [conceptBackprop, conceptGradientDescent],
    );

    const profiles = new Map<UUID, MatchProfile>(
      overrides?.profiles ?? [
        [
          studentHariId,
          {
            studentId: studentHariId,
            name: "Hari",
            confidences: new Map([
              [conceptBackprop, 0.8],
              [conceptGradientDescent, 0.5],
            ]),
          },
        ],
        [
          studentRahulId,
          {
            studentId: studentRahulId,
            name: "Rahul",
            confidences: new Map([
              [conceptBackprop, 0.15],
              [conceptGradientDescent, 0.5],
            ]),
          },
        ],
      ],
    );

    const fakeCourses = {
      getCourse: async (
        actor: ActorContext,
        targetCourseId: UUID,
      ): Promise<Course> => {
        if (targetCourseId !== courseId) {
          throw new AppError({
            code: "NOT_FOUND",
            statusCode: 404,
            message: "Course not found",
          });
        }
        const hasEnrollment = actor.enrolledCourses?.some(
          (e) => e.courseId === targetCourseId,
        );
        if (!hasEnrollment && actor.role !== "teacher") {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Actor not enrolled in course",
          });
        }
        return {
          id: targetCourseId,
          name: "Deep Learning",
          joinCode: "DL2026",
          teacherId: "00000000-0000-4000-8000-000000000099",
          createdAt: "2026-09-01T00:00:00.000Z",
        };
      },
    };

    const fakePool = {
      insertPoolEntry: async (
        input: InsertPoolEntryInput,
      ): Promise<PoolEntry> => {
        const key = `${input.studentId}:${input.courseId}`;
        const existing = poolEntries.get(key);
        if (existing) {
          throw new AppError({
            code: "CONFLICT",
            statusCode: 409,
            message: "Student already has a pool entry for this course",
          });
        }
        const entry: PoolEntry = {
          id: input.id ?? ids.generateId(),
          studentId: input.studentId,
          courseId: input.courseId,
          conceptIds: input.conceptIds,
          status: "waiting",
          createdAt: input.createdAt ?? clock.nowISO(),
          expiresAt:
            input.expiresAt ??
            new Date(clock.now().getTime() + 300_000).toISOString(),
        };
        poolEntries.set(key, entry);
        return entry;
      },

      getActiveEntries: async (
        cId: UUID,
        now: ISOTimestamp,
      ): Promise<PoolEntry[]> => {
        const nowMs = new Date(now).getTime();
        return Array.from(poolEntries.values()).filter(
          (e) =>
            e.courseId === cId &&
            e.status === "waiting" &&
            new Date(e.expiresAt).getTime() >= nowMs,
        );
      },

      getEntryByStudent: async (
        sId: UUID,
        cId: UUID,
      ): Promise<PoolEntry | null> => {
        const key = `${sId}:${cId}`;
        const entry = poolEntries.get(key);
        if (!entry) return null;
        return { ...entry };
      },

      cancelWaitingEntry: async (
        sId: UUID,
        cId: UUID,
      ): Promise<PoolEntry | null> => {
        const key = `${sId}:${cId}`;
        const entry = poolEntries.get(key);
        if (!entry || entry.status !== "waiting") return null;
        entry.status = "cancelled";
        return { ...entry };
      },

      cleanupExpiredForCourse: async (
        cId: UUID,
        now: ISOTimestamp,
      ): Promise<number> => {
        const nowMs = new Date(now).getTime();
        let cleaned = 0;
        for (const entry of poolEntries.values()) {
          if (
            entry.courseId === cId &&
            entry.status === "waiting" &&
            new Date(entry.expiresAt).getTime() < nowMs
          ) {
            entry.status = "expired";
            cleaned++;
          }
        }
        return cleaned;
      },

      reactivateInactiveEntry: async (
        sId: UUID,
        cId: UUID,
        conceptIds: UUID[],
        createdAt: ISOTimestamp,
        expiresAt: ISOTimestamp,
      ): Promise<PoolEntry | null> => {
        const key = `${sId}:${cId}`;
        const entry = poolEntries.get(key);
        if (!entry) return null;
        if (entry.status === "expired" || entry.status === "cancelled") {
          entry.status = "waiting";
          entry.conceptIds = conceptIds;
          entry.createdAt = createdAt;
          entry.expiresAt = expiresAt;
          return { ...entry };
        }
        return null;
      },
    };

    const defaultClaimMatch = async (
      cId: UUID,
      sA: UUID,
      sB: UUID,
      _cIds: UUID[],
    ): Promise<UUID | null> => {
      const entryA = poolEntries.get(`${sA}:${cId}`);
      const entryB = poolEntries.get(`${sB}:${cId}`);
      const nowMs = clock.now().getTime();

      if (
        !entryA ||
        entryA.status !== "waiting" ||
        new Date(entryA.expiresAt).getTime() < nowMs
      ) {
        return null;
      }
      if (
        !entryB ||
        entryB.status !== "waiting" ||
        new Date(entryB.expiresAt).getTime() < nowMs
      ) {
        return null;
      }

      entryA.status = "matched";
      entryB.status = "matched";
      return ids.generateId();
    };

    const claimHandler = overrides?.claimMatchHandler ?? defaultClaimMatch;

    const fakeMatches = {
      getCourseConceptIds: async (
        cId: UUID,
        cIds: UUID[],
      ): Promise<UUID[]> => {
        if (cId !== courseId) return [];
        return cIds.filter((id) => courseConcepts.has(id));
      },

      getProfiles: async (
        cId: UUID,
        sIds: UUID[],
        _cIds: UUID[],
      ): Promise<Map<UUID, MatchProfile>> => {
        if (cId !== courseId) return new Map();
        const map = new Map<UUID, MatchProfile>();
        for (const id of sIds) {
          const p = profiles.get(id);
          if (p) map.set(id, p);
        }
        return map;
      },

      claimMatch: vi.fn(claimHandler),
    };

    const deps: StudyGroupServiceDependencies = {
      courses: fakeCourses,
      pool: fakePool,
      matches: fakeMatches,
      publisher,
      clock,
      ids,
    };

    const service = new StudyGroupService(deps);

    return {
      service,
      deps,
      clock,
      ids,
      publisher,
      poolEntries,
      profiles,
    };
  }

  it("Hari (conf 0.80) and Rahul (conf 0.15) match on Backpropagation with gap 0.65 and individualized events", async () => {
    // 1. Hari opts into pool first -> waiting
    const { service, publisher, poolEntries } = setupService();

    const hariRes = await service.optIntoPool(actorHari, courseId, [
      conceptBackprop,
    ]);
    expect(hariRes.status).toBe("waiting");
    expect(hariRes.matchId).toBeUndefined();
    expect(publisher.studentEmissions).toHaveLength(0);

    // 2. Rahul opts into pool -> complementary match
    const rahulRes = await service.optIntoPool(actorRahul, courseId, [
      conceptBackprop,
    ]);
    expect(rahulRes.status).toBe("matched");
    expect(rahulRes.matchId).toBeDefined();

    // Pool statuses updated to 'matched'
    expect(poolEntries.get(`${studentHariId}:${courseId}`)?.status).toBe(
      "matched",
    );
    expect(poolEntries.get(`${studentRahulId}:${courseId}`)?.status).toBe(
      "matched",
    );

    // Socket events emitted to both private student rooms
    expect(publisher.studentEmissions).toHaveLength(2);

    // Hari's event has peerName = 'Rahul'
    const hariEmission = publisher.studentEmissions.find(
      (e) => e.studentId === studentHariId,
    );
    expect(hariEmission).toBeDefined();
    expect(hariEmission?.event).toBe("study-group:matched");
    const hariPayload = hariEmission?.payload as StudyGroupMatchedEvent;
    expect(hariPayload.matchId).toBe(rahulRes.matchId);
    expect(hariPayload.peerName).toBe("Rahul");
    expect(hariPayload.conceptIds).toEqual([conceptBackprop]);

    // Rahul's event has peerName = 'Hari'
    const rahulEmission = publisher.studentEmissions.find(
      (e) => e.studentId === studentRahulId,
    );
    expect(rahulEmission).toBeDefined();
    expect(rahulEmission?.event).toBe("study-group:matched");
    const rahulPayload = rahulEmission?.payload as StudyGroupMatchedEvent;
    expect(rahulPayload.matchId).toBe(rahulRes.matchId);
    expect(rahulPayload.peerName).toBe("Hari");
    expect(rahulPayload.conceptIds).toEqual([conceptBackprop]);
  });

  it("equal confidence (<0.30 gap) leaves both students waiting with zero match events", async () => {
    const { service, publisher } = setupService({
      profiles: new Map([
        [
          studentHariId,
          {
            studentId: studentHariId,
            name: "Hari",
            confidences: new Map([[conceptBackprop, 0.8]]),
          },
        ],
        [
          studentRahulId,
          {
            studentId: studentRahulId,
            name: "Rahul",
            confidences: new Map([[conceptBackprop, 0.8]]), // Equal confidence
          },
        ],
      ]),
    });

    const hariRes = await service.optIntoPool(actorHari, courseId, [
      conceptBackprop,
    ]);
    expect(hariRes.status).toBe("waiting");

    const rahulRes = await service.optIntoPool(actorRahul, courseId, [
      conceptBackprop,
    ]);
    expect(rahulRes.status).toBe("waiting");

    expect(publisher.studentEmissions).toHaveLength(0);
  });

  it("enforces exact 5-minute (300,000ms) pool entry expiry", async () => {
    const { service, clock } = setupService();
    const t0 = "2026-10-24T12:00:00.000Z";
    clock.setTime(t0);

    const res = await service.optIntoPool(actorHari, courseId, [
      conceptBackprop,
    ]);
    expect(res.expiresAt).toBe("2026-10-24T12:05:00.000Z");
  });

  it("reactivates expired or cancelled entries under unconditional uniqueness", async () => {
    const { service, poolEntries } = setupService({
      initialPoolEntries: [
        {
          id: "existing-entry-id",
          studentId: studentHariId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "expired",
          createdAt: "2026-10-24T11:00:00.000Z",
          expiresAt: "2026-10-24T11:05:00.000Z",
        },
      ],
    });

    const res = await service.optIntoPool(actorHari, courseId, [
      conceptGradientDescent,
    ]);
    expect(res.status).toBe("waiting");

    const entry = poolEntries.get(`${studentHariId}:${courseId}`);
    expect(entry?.id).toBe("existing-entry-id"); // Preserves row ID
    expect(entry?.status).toBe("waiting");
    expect(entry?.conceptIds).toEqual([conceptGradientDescent]);
  });

  it("rejects duplicate active opt-in with 409 CONFLICT", async () => {
    const { service } = setupService({
      initialPoolEntries: [
        {
          id: "active-entry-id",
          studentId: studentHariId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:00:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
      ],
    });

    await expect(
      service.optIntoPool(actorHari, courseId, [conceptBackprop]),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
    });
  });

  it("rejects unauthorized actors (teachers or unenrolled students) with 403 FORBIDDEN", async () => {
    const { service } = setupService();

    // Teacher
    await expect(
      service.optIntoPool(actorTeacher, courseId, [conceptBackprop]),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });

    // Unenrolled student
    const unenrolledActor: ActorContext = {
      userId: studentHariId,
      authId: "00000000-0000-4000-8000-000000000003",
      email: "other@example.com",
      name: "Other Student",
      role: "student",
      enrolledCourses: [{ courseId: otherCourseId, studentId: studentHariId }],
    };
    await expect(
      service.optIntoPool(unenrolledActor, courseId, [conceptBackprop]),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("rejects concepts from other courses with 400 VALIDATION_ERROR and no pool mutation", async () => {
    const { service, poolEntries } = setupService();

    await expect(
      service.optIntoPool(actorHari, courseId, [conceptOtherCourse]),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });

    expect(poolEntries.size).toBe(0);
  });

  it("delivers notifications only after successful commit; zero notifications before claim", async () => {
    const { promise: claimPromise, resolve: resolveClaimPromise } =
      Promise.withResolvers<UUID | null>();

    const { service, publisher } = setupService({
      initialPoolEntries: [
        {
          id: "entry-rahul",
          studentId: studentRahulId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:00:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
      ],
      claimMatchHandler: async () => claimPromise,
    });

    const optInPromise = service.optIntoPool(actorHari, courseId, [
      conceptBackprop,
    ]);

    // Before claim resolution: zero socket emissions
    expect(publisher.studentEmissions).toHaveLength(0);

    // Resolve claim successfully
    resolveClaimPromise("match-committed-uuid");
    const res = await optInPromise;

    expect(res.status).toBe("matched");
    expect(res.matchId).toBe("match-committed-uuid");
    expect(publisher.studentEmissions).toHaveLength(2);
  });

  it("survives failed publication to one recipient: attempts other student without rolling back", async () => {
    const { service, publisher } = setupService({
      initialPoolEntries: [
        {
          id: "entry-rahul",
          studentId: studentRahulId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:00:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
      ],
    });

    // Make Hari's emission fail
    vi.spyOn(publisher, "emitToStudent").mockImplementation(
      async (studentId, event, payload) => {
        if (studentId === studentHariId) {
          throw new Error("Socket disconnected for Hari");
        }
        publisher.studentEmissions.push({ studentId, event, payload });
      },
    );

    const res = await service.optIntoPool(actorHari, courseId, [
      conceptBackprop,
    ]);

    // Match remains committed and successful
    expect(res.status).toBe("matched");
    // Rahul's emission succeeded
    expect(publisher.studentEmissions).toHaveLength(1);
    expect(publisher.studentEmissions[0].studentId).toBe(studentRahulId);
  });

  it("handles lost candidate claim (contention) by proceeding to next eligible candidate", async () => {
    let callCount = 0;
    const { service } = setupService({
      initialPoolEntries: [
        {
          id: "entry-rahul-1",
          studentId: studentRahulId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:01:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
        {
          id: "entry-peer2",
          studentId: studentPeer2Id,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:02:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
      ],
      profiles: new Map([
        [
          studentHariId,
          {
            studentId: studentHariId,
            name: "Hari",
            confidences: new Map([[conceptBackprop, 0.8]]),
          },
        ],
        [
          studentRahulId,
          {
            studentId: studentRahulId,
            name: "Rahul",
            confidences: new Map([[conceptBackprop, 0.15]]),
          },
        ],
        [
          studentPeer2Id,
          {
            studentId: studentPeer2Id,
            name: "Peer 2",
            confidences: new Map([[conceptBackprop, 0.1]]),
          },
        ],
      ]),
      claimMatchHandler: async (_c, _sA, sB) => {
        callCount++;
        // First candidate (Rahul) fails due to contention (returns null)
        if (sB === studentRahulId) {
          return null;
        }
        // Second candidate (Peer 2) succeeds
        return "match-with-peer2-uuid";
      },
    });

    const res = await service.optIntoPool(actorHari, courseId, [
      conceptBackprop,
    ]);
    expect(callCount).toBe(2);
    expect(res.status).toBe("matched");
    expect(res.matchId).toBe("match-with-peer2-uuid");
  });

  it("detects when requester itself was claimed by another worker and returns 409 CONFLICT", async () => {
    const { service, poolEntries } = setupService({
      initialPoolEntries: [
        {
          id: "entry-rahul-1",
          studentId: studentRahulId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:01:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
      ],
      claimMatchHandler: async () => {
        // Simulate concurrent worker claiming Hari's entry right now!
        const hariRow = poolEntries.get(`${studentHariId}:${courseId}`);
        if (hariRow) hariRow.status = "matched";
        return null; // Our claim failed
      },
    });

    await expect(
      service.optIntoPool(actorHari, courseId, [conceptBackprop]),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
    });
  });

  it("optOutOfPool cancels waiting entry and is a safe no-op if no waiting entry", async () => {
    const { service, poolEntries } = setupService({
      initialPoolEntries: [
        {
          id: "entry-hari",
          studentId: studentHariId,
          courseId,
          conceptIds: [conceptBackprop],
          status: "waiting",
          createdAt: "2026-10-24T12:00:00.000Z",
          expiresAt: "2026-10-24T12:05:00.000Z",
        },
      ],
    });

    await service.optOutOfPool(actorHari, courseId);
    expect(poolEntries.get(`${studentHariId}:${courseId}`)?.status).toBe(
      "cancelled",
    );

    // Calling optOutOfPool again is a safe no-op
    await expect(
      service.optOutOfPool(actorHari, courseId),
    ).resolves.toBeUndefined();
  });
});
