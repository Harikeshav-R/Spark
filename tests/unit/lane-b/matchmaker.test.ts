import { describe, it, expect } from "vitest";
import type { UUID } from "../../../src/contracts/common.js";
import {
  findComplementaryCandidates,
  type MatchProfile,
} from "../../../src/server/study-groups/matchmaker.js";
import type { PoolEntry } from "../../../src/server/study-groups/pool-repository.js";

describe("P6-B-01: Matchmaker Algorithm (CP-P6-B-01)", () => {
  const courseId: UUID = "11111111-1111-4111-8111-111111111111";
  const otherCourseId: UUID = "22222222-2222-4222-8222-222222222222";

  const studentHari: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const studentRahul: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const studentPeer2: UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  const conceptBackprop: UUID = "99999999-9999-4999-8999-999999999999";
  const conceptGradientDescent: UUID = "88888888-8888-4888-8888-888888888888";
  const conceptUnrelated: UUID = "77777777-7777-4777-8777-777777777777";

  const t0 = new Date("2026-10-24T12:00:00.000Z");
  const t0Plus3Min = new Date("2026-10-24T12:03:00.000Z");
  const t0Plus5Min = new Date("2026-10-24T12:05:00.000Z");
  const t0Plus5MinAnd1Ms = new Date("2026-10-24T12:05:00.001Z");

  const hariEntry: PoolEntry = {
    id: "e-hari-0000-0000-0000-000000000001",
    studentId: studentHari,
    courseId,
    conceptIds: [conceptBackprop],
    status: "waiting",
    createdAt: t0.toISOString(),
    expiresAt: t0Plus5Min.toISOString(),
  };

  const rahulEntry: PoolEntry = {
    id: "e-rahul-0000-0000-0000-000000000002",
    studentId: studentRahul,
    courseId,
    conceptIds: [conceptBackprop],
    status: "waiting",
    createdAt: t0.toISOString(),
    expiresAt: t0Plus5Min.toISOString(),
  };

  it("Hari (conf 0.80) and Rahul (conf 0.15) match on Backpropagation with gap 0.65", () => {
    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([[conceptBackprop, 0.8]]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptBackprop, 0.15]]),
        },
      ],
    ]);

    const candidates = findComplementaryCandidates(
      hariEntry,
      [rahulEntry],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].entry.studentId).toBe(studentRahul);
    expect(candidates[0].conceptIds).toEqual([conceptBackprop]);
    expect(candidates[0].gap).toBeCloseTo(0.65, 5);
  });

  it("two students with identical confidence (<0.30 gap) do not match", () => {
    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([[conceptBackprop, 0.8]]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptBackprop, 0.8]]),
        },
      ],
    ]);

    const candidates = findComplementaryCandidates(
      hariEntry,
      [rahulEntry],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(0);
  });

  it("exact threshold boundary: gap 0.30 is accepted, gap 0.2999 is rejected", () => {
    const profileHari = {
      studentId: studentHari,
      name: "Hari",
      confidences: new Map([[conceptBackprop, 0.3]]),
    };

    // Candidate 1: confidence 0.0 -> gap = |0.3 - 0.0| = 0.30 (accepted)
    const entry1: PoolEntry = {
      ...rahulEntry,
      id: "entry-001",
      studentId: studentRahul,
    };
    const profile1: MatchProfile = {
      studentId: studentRahul,
      name: "Student 1",
      confidences: new Map([[conceptBackprop, 0.0]]),
    };

    // Candidate 2: confidence 0.0001 -> gap = |0.3 - 0.0001| = 0.2999 (rejected)
    const entry2: PoolEntry = {
      ...rahulEntry,
      id: "entry-002",
      studentId: studentPeer2,
    };
    const profile2: MatchProfile = {
      studentId: studentPeer2,
      name: "Student 2",
      confidences: new Map([[conceptBackprop, 0.0001]]),
    };

    const profiles = new Map<UUID, MatchProfile>([
      [studentHari, profileHari],
      [studentRahul, profile1],
      [studentPeer2, profile2],
    ]);

    const candidates = findComplementaryCandidates(
      hariEntry,
      [entry1, entry2],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].entry.id).toBe("entry-001");
    expect(candidates[0].gap).toBeCloseTo(0.3, 5);
  });

  it("computes mean absolute gap over multiple shared concepts; unshared concepts do not affect score", () => {
    const entryA: PoolEntry = {
      ...hariEntry,
      conceptIds: [conceptBackprop, conceptGradientDescent, conceptUnrelated],
    };
    const entryB: PoolEntry = {
      ...rahulEntry,
      conceptIds: [conceptBackprop, conceptGradientDescent],
    };

    // Shared concepts: Backprop and GradientDescent (2 concepts)
    // Confidences:
    // Backprop: A=0.8, B=0.2 -> diff = 0.6
    // GradientDescent: A=0.4, B=0.6 -> diff = 0.2
    // Mean absolute gap = (0.6 + 0.2) / 2 = 0.40 >= 0.30
    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([
            [conceptBackprop, 0.8],
            [conceptGradientDescent, 0.4],
            [conceptUnrelated, 0.9],
          ]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([
            [conceptBackprop, 0.2],
            [conceptGradientDescent, 0.6],
          ]),
        },
      ],
    ]);

    const candidates = findComplementaryCandidates(
      entryA,
      [entryB],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].conceptIds).toEqual(
      [conceptBackprop, conceptGradientDescent].sort(),
    );
    expect(candidates[0].gap).toBeCloseTo(0.4, 5);
  });

  it("filters out self, other course, non-waiting, and disjoint concepts", () => {
    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([
            [conceptBackprop, 0.8],
            [conceptUnrelated, 0.1],
          ]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptUnrelated, 0.9]]),
        },
      ],
    ]);

    // 1. Self candidate
    const selfEntry: PoolEntry = { ...hariEntry, id: "self-entry" };

    // 2. Other course
    const otherCourseEntry: PoolEntry = {
      ...rahulEntry,
      courseId: otherCourseId,
    };

    // 3. Non-waiting
    const matchedEntry: PoolEntry = { ...rahulEntry, status: "matched" };

    // 4. Disjoint concepts (Rahul requests conceptUnrelated, Hari requests conceptBackprop)
    const disjointEntry: PoolEntry = {
      ...rahulEntry,
      conceptIds: [conceptUnrelated],
    };

    const candidates = findComplementaryCandidates(
      hariEntry,
      [selfEntry, otherCourseEntry, matchedEntry, disjointEntry],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(0);
  });

  it("omits candidate if either student lacks mastery on any shared concept (no zero substitution)", () => {
    const entryA: PoolEntry = {
      ...hariEntry,
      conceptIds: [conceptBackprop, conceptGradientDescent],
    };
    const entryB: PoolEntry = {
      ...rahulEntry,
      conceptIds: [conceptBackprop, conceptGradientDescent],
    };

    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([
            [conceptBackprop, 0.9],
            [conceptGradientDescent, 0.8],
          ]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          // Missing GradientDescent confidence
          confidences: new Map([[conceptBackprop, 0.1]]),
        },
      ],
    ]);

    const candidates = findComplementaryCandidates(
      entryA,
      [entryB],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(0);
  });

  it("throws data integrity error on invalid confidence (non-finite or outside [0, 1])", () => {
    const profilesNaN = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([[conceptBackprop, Number.NaN]]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptBackprop, 0.2]]),
        },
      ],
    ]);

    expect(() =>
      findComplementaryCandidates(
        hariEntry,
        [rahulEntry],
        profilesNaN,
        t0Plus3Min,
      ),
    ).toThrowError(/Invalid present confidence/);

    const profilesOutOfRange = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([[conceptBackprop, 1.5]]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptBackprop, 0.2]]),
        },
      ],
    ]);

    expect(() =>
      findComplementaryCandidates(
        hariEntry,
        [rahulEntry],
        profilesOutOfRange,
        t0Plus3Min,
      ),
    ).toThrowError(/Invalid present confidence/);
  });

  it("respects inclusive expiry: eligible at exact expiresAt, ineligible 1ms later", () => {
    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([[conceptBackprop, 0.8]]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptBackprop, 0.1]]),
        },
      ],
    ]);

    // At exact expiresAt (t0Plus5Min): eligible
    const candidatesAtExpiry = findComplementaryCandidates(
      hariEntry,
      [rahulEntry],
      profiles,
      t0Plus5Min,
    );
    expect(candidatesAtExpiry).toHaveLength(1);

    // 1ms after expiresAt: candidate expired
    const candidatesAfterExpiry = findComplementaryCandidates(
      hariEntry,
      [rahulEntry],
      profiles,
      t0Plus5MinAnd1Ms,
    );
    expect(candidatesAfterExpiry).toHaveLength(0);

    // Requester expired 1ms after expiresAt: returns empty array
    const candidatesRequesterExpired = findComplementaryCandidates(
      { ...hariEntry, expiresAt: t0.toISOString() },
      [rahulEntry],
      profiles,
      t0Plus3Min,
    );
    expect(candidatesRequesterExpired).toHaveLength(0);
  });

  it("sorts complementary candidates in createdAt ascending, then entry ID ascending order", () => {
    const p1: PoolEntry = {
      ...rahulEntry,
      id: "entry-z",
      studentId: studentRahul,
      createdAt: "2026-10-24T12:02:00.000Z",
    };
    const p2: PoolEntry = {
      ...rahulEntry,
      id: "entry-a",
      studentId: studentPeer2,
      createdAt: "2026-10-24T12:01:00.000Z", // Earlier creation
    };
    const p3: PoolEntry = {
      ...rahulEntry,
      id: "entry-b",
      studentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      createdAt: "2026-10-24T12:01:00.000Z", // Same creation as p2, but ID 'entry-b' > 'entry-a'
    };

    const profiles = new Map<UUID, MatchProfile>([
      [
        studentHari,
        {
          studentId: studentHari,
          name: "Hari",
          confidences: new Map([[conceptBackprop, 0.9]]),
        },
      ],
      [
        studentRahul,
        {
          studentId: studentRahul,
          name: "Rahul",
          confidences: new Map([[conceptBackprop, 0.1]]),
        },
      ],
      [
        studentPeer2,
        {
          studentId: studentPeer2,
          name: "Peer 2",
          confidences: new Map([[conceptBackprop, 0.2]]),
        },
      ],
      [
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        {
          studentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: "Peer 3",
          confidences: new Map([[conceptBackprop, 0.15]]),
        },
      ],
    ]);

    const candidates = findComplementaryCandidates(
      hariEntry,
      [p1, p2, p3],
      profiles,
      t0Plus3Min,
    );

    expect(candidates).toHaveLength(3);
    // Order: p2 (12:01, entry-a), p3 (12:01, entry-b), p1 (12:02, entry-z)
    expect(candidates[0].entry.id).toBe("entry-a");
    expect(candidates[1].entry.id).toBe("entry-b");
    expect(candidates[2].entry.id).toBe("entry-z");
  });
});
