import { describe, expect, it } from "vitest";
import type { UUID } from "../../../src/contracts/common.js";
import {
  computeReviewState,
  isConceptReady,
  OVERDUE_THRESHOLD_MS,
  selectDailyQuestCandidates,
} from "../../../src/server/core/game/daily-quest-generator.js";
import {
  calculateMascotEvolution,
  calculateStreakDays,
} from "../../../src/server/core/game/game-service.js";
import { calculateEclipse } from "../../../src/server/core/game/eclipse-service.js";

const c1 = "11111111-1111-4111-8111-111111111111" as UUID;
const c2 = "22222222-2222-4222-8222-222222222222" as UUID;
const c3 = "33333333-3333-4333-8333-333333333333" as UUID;
const c4 = "44444444-4444-4444-8444-444444444444" as UUID;
const c5 = "55555555-5555-4555-8555-555555555555" as UUID;
const studentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as UUID;

describe("daily-quest-generator", () => {
  describe("isConceptReady (INV-XP03)", () => {
    it("identifies roots as ready by definition", () => {
      const edges: { sourceId: UUID; targetId: UUID }[] = [];
      const masteries = new Map<UUID, number>();
      expect(isConceptReady(c1, edges, masteries)).toBe(true);
    });

    it("requires all direct prerequisites to have confidence >= 0.70", () => {
      const edges = [
        { sourceId: c1, targetId: c2 },
        { sourceId: c3, targetId: c2 },
      ];

      // c1 ready, c3 unmastered
      const m1 = new Map<UUID, number>([
        [c1, 0.85],
        [c3, 0.5],
      ]);
      expect(isConceptReady(c2, edges, m1)).toBe(false);

      // both mastered
      const m2 = new Map<UUID, number>([
        [c1, 0.7],
        [c3, 0.9],
      ]);
      expect(isConceptReady(c2, edges, m2)).toBe(true);
    });

    it("treats missing prerequisite mastery as 0.0 confidence", () => {
      const edges = [{ sourceId: c1, targetId: c2 }];
      const emptyMasteries = new Map<UUID, number>();
      expect(isConceptReady(c2, edges, emptyMasteries)).toBe(false);
    });
  });

  describe("computeReviewState", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");

    it("returns unreviewed when no review date exists", () => {
      expect(computeReviewState(null, now)).toBe("unreviewed");
      expect(computeReviewState(undefined, now)).toBe("unreviewed");
    });

    it("returns current when reviewed within 72 hours", () => {
      const recent = new Date(now.getTime() - 24 * 3600 * 1000);
      expect(computeReviewState(recent, now)).toBe("current");

      // Exactly 72h
      const exact72h = new Date(now.getTime() - OVERDUE_THRESHOLD_MS);
      expect(computeReviewState(exact72h, now)).toBe("current");
    });

    it("returns overdue when review is older than 72 hours", () => {
      const older = new Date(now.getTime() - (OVERDUE_THRESHOLD_MS + 1000));
      expect(computeReviewState(older, now)).toBe("overdue");
    });
  });

  describe("selectDailyQuestCandidates (INV-XP04)", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");

    it("filters out concepts whose prerequisites are not met", () => {
      const nodes = [{ id: c1 }, { id: c2 }];
      const edges = [{ sourceId: c1, targetId: c2 }];
      const masteries = new Map<UUID, number>([
        [c1, 0.4], // c1 not mastered
        [c2, 0.2],
      ]);
      const latestReviews = new Map<UUID, Date>();
      const importance = new Map<UUID, number>([
        [c1, 0.5],
        [c2, 0.5],
      ]);

      const candidates = selectDailyQuestCandidates({
        nodes,
        edges,
        masteries,
        latestReviews,
        importanceMap: importance,
        now,
      });

      // c1 is a root and ready, c2 is blocked
      expect(candidates).toEqual([c1]);
    });

    it("sorts by urgency first, confidence ascending, importance descending, then UUID ascending", () => {
      // All roots (ready)
      const nodes = [{ id: c1 }, { id: c2 }, { id: c3 }, { id: c4 }, { id: c5 }];
      const edges: { sourceId: UUID; targetId: UUID }[] = [];

      // c1: confidence 0.8, overdue review (has overdue priority)
      // c2: confidence 0.3, recent review (current review, under-confident)
      // c3: confidence 0.2, overdue review (has overdue priority)
      // c4: confidence 0.2, unreviewed (has overdue priority, same conf as c3)
      // c5: confidence 0.9, recent review (current review, mastered -> excluded!)
      const masteries = new Map<UUID, number>([
        [c1, 0.8],
        [c2, 0.3],
        [c3, 0.2],
        [c4, 0.2],
        [c5, 0.9],
      ]);

      const latestReviews = new Map<UUID, Date>([
        [c1, new Date(now.getTime() - 100 * 3600 * 1000)], // overdue
        [c2, new Date(now.getTime() - 10 * 3600 * 1000)], // current
        [c3, new Date(now.getTime() - 80 * 3600 * 1000)], // overdue
        // c4: missing -> unreviewed
        [c5, new Date(now.getTime() - 10 * 3600 * 1000)], // current & mastered
      ]);

      // Importance tie-breaker for c3 vs c4: c3 has higher importance
      const importance = new Map<UUID, number>([
        [c1, 0.5],
        [c2, 0.5],
        [c3, 0.9],
        [c4, 0.3],
        [c5, 0.5],
      ]);

      const candidates = selectDailyQuestCandidates({
        nodes,
        edges,
        masteries,
        latestReviews,
        importanceMap: importance,
        now,
      });

      // Eligible:
      // Overdue-priority: c3 (conf 0.2, imp 0.9), c4 (conf 0.2, imp 0.3), c1 (conf 0.8, imp 0.5)
      // Non-overdue: c2 (conf 0.3)
      // Top 3 selected must be: c3, c4, c1
      expect(candidates).toHaveLength(3);
      expect(candidates[0]).toBe(c3);
      expect(candidates[1]).toBe(c4);
      expect(candidates[2]).toBe(c1);
    });

    it("breaks equal confidence and importance by UUID ascending", () => {
      const nodes = [{ id: c3 }, { id: c1 }, { id: c2 }];
      const edges: { sourceId: UUID; targetId: UUID }[] = [];
      const masteries = new Map<UUID, number>([
        [c1, 0.5],
        [c2, 0.5],
        [c3, 0.5],
      ]);
      const latestReviews = new Map<UUID, Date>(); // all unreviewed
      const importance = new Map<UUID, number>([
        [c1, 0.5],
        [c2, 0.5],
        [c3, 0.5],
      ]);

      const candidates = selectDailyQuestCandidates({
        nodes,
        edges,
        masteries,
        latestReviews,
        importanceMap: importance,
        now,
      });

      expect(candidates).toEqual([c1, c2, c3]);
    });
  });
});

describe("eclipse-service (INV-XP07)", () => {
  it("returns strength 0 when no target concepts exist", () => {
    const result = calculateEclipse({
      studentId,
      nodes: [{ id: c1 }],
      edges: [],
      masteries: new Map<UUID, number>([[c1, 0.85]]),
      examAt: null,
    });

    expect(result.strength).toBe(0);
    expect(result.targets).toHaveLength(0);
    expect(result.examAt).toBeNull();
  });

  it("calculates exact strength for 1 target (c = 0.35 => 50)", () => {
    const result = calculateEclipse({
      studentId,
      nodes: [{ id: c1 }],
      edges: [],
      masteries: new Map<UUID, number>([[c1, 0.35]]),
      examAt: "2026-12-01T00:00:00.000Z",
    });

    expect(result.strength).toBe(50);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.conceptId).toBe(c1);
    expect(result.targets[0]?.band).toBe("red");
    expect(result.examAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("calculates exact strength for 2 targets (c = 0.35, 0.50 => 39)", () => {
    const result = calculateEclipse({
      studentId,
      nodes: [{ id: c1 }, { id: c2 }],
      edges: [],
      masteries: new Map<UUID, number>([
        [c1, 0.35],
        [c2, 0.5],
      ]),
      examAt: null,
    });

    expect(result.strength).toBe(39);
    expect(result.targets).toHaveLength(2);
  });

  it("excludes unready concepts from Eclipse targets", () => {
    const result = calculateEclipse({
      studentId,
      nodes: [{ id: c1 }, { id: c2 }],
      edges: [{ sourceId: c1, targetId: c2 }],
      masteries: new Map<UUID, number>([
        [c1, 0.3], // c1 not mastered, so c2 is not ready
        [c2, 0.1],
      ]),
      examAt: null,
    });

    expect(result.targets.map((t) => t.conceptId)).toEqual([c1]);
  });
});

describe("calculateStreakDays (INV-XP04)", () => {
  it("returns 0 for no cleared quests", () => {
    expect(calculateStreakDays([], new Date("2026-10-22T12:00:00.000Z"))).toBe(0);
  });

  it("ignores empty quests (conceptIds = [])", () => {
    expect(
      calculateStreakDays(
        [
          { questDate: "2026-10-20", conceptIds: [] },
          { questDate: "2026-10-21", conceptIds: [] },
        ],
        new Date("2026-10-21T12:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("counts consecutive UTC days ending at most recent clear", () => {
    const clears = [
      { questDate: "2026-10-20", conceptIds: [c1] },
      { questDate: "2026-10-21", conceptIds: [c1, c2] },
      { questDate: "2026-10-22", conceptIds: [c1] },
    ];
    expect(calculateStreakDays(clears, new Date("2026-10-22T12:00:00.000Z"))).toBe(3);
  });

  it("deduplicates multiple clears on same date without artificially inflating streak", () => {
    const clears = [
      { questDate: "2026-10-20", conceptIds: [c1] },
      { questDate: "2026-10-21", conceptIds: [c1] },
      { questDate: "2026-10-21", conceptIds: [c2] },
    ];
    expect(calculateStreakDays(clears, new Date("2026-10-21T12:00:00.000Z"))).toBe(2);
  });

  it("resets streak to 1 after a skipped calendar date", () => {
    const clears = [
      { questDate: "2026-10-18", conceptIds: [c1] },
      { questDate: "2026-10-19", conceptIds: [c1] },
      { questDate: "2026-10-22", conceptIds: [c1] }, // 20 and 21 skipped
    ];
    expect(calculateStreakDays(clears, new Date("2026-10-22T12:00:00.000Z"))).toBe(1);
  });

  it("evaluates a run ending October 22 on October 23 as active (3) vs October 24 as lapsed (0)", () => {
    const clears = [
      { questDate: "2026-10-20", conceptIds: [c1] },
      { questDate: "2026-10-21", conceptIds: [c1] },
      { questDate: "2026-10-22", conceptIds: [c1] },
    ];
    expect(calculateStreakDays(clears, new Date("2026-10-23T12:00:00.000Z"))).toBe(3);
    expect(calculateStreakDays(clears, new Date("2026-10-24T12:00:00.000Z"))).toBe(0);
  });

  it("treats 2026-10-23T20:00:00-04:00 as UTC October 24 midnight, lapsing an October 22 run to 0", () => {
    const clears = [
      { questDate: "2026-10-20", conceptIds: [c1] },
      { questDate: "2026-10-21", conceptIds: [c1] },
      { questDate: "2026-10-22", conceptIds: [c1] },
    ];
    expect(calculateStreakDays(clears, new Date("2026-10-23T20:00:00-04:00"))).toBe(0);
  });

  it("handles year boundary: clears December 30-31, 2025 and January 1, 2026 evaluated on January 2 (3)", () => {
    const clears = [
      { questDate: "2025-12-30", conceptIds: [c1] },
      { questDate: "2025-12-31", conceptIds: [c1] },
      { questDate: "2026-01-01", conceptIds: [c1] },
    ];
    expect(calculateStreakDays(clears, new Date("2026-01-02T12:00:00.000Z"))).toBe(3);
  });
});

describe("calculateMascotEvolution (INV-XP08)", () => {
  it("correctly identifies ember form and progress", () => {
    const e1 = calculateMascotEvolution(0.0);
    expect(e1.form).toBe("ember");
    expect(e1.formProgress).toBe(0.0);

    const e2 = calculateMascotEvolution(0.125);
    expect(e2.form).toBe("ember");
    expect(e2.formProgress).toBe(0.5);
  });

  it("correctly identifies spark form and progress", () => {
    const s1 = calculateMascotEvolution(0.25);
    expect(s1.form).toBe("spark");
    expect(s1.formProgress).toBe(0.0);

    const s2 = calculateMascotEvolution(0.4);
    expect(s2.form).toBe("spark");
    expect(s2.formProgress).toBe(0.5);
  });

  it("correctly identifies glow form and progress", () => {
    const g1 = calculateMascotEvolution(0.55);
    expect(g1.form).toBe("glow");
    expect(g1.formProgress).toBe(0.0);

    const g2 = calculateMascotEvolution(0.65);
    expect(g2.form).toBe("glow");
    expect(g2.formProgress).toBe(0.5);
  });

  it("correctly identifies nova form and progress", () => {
    const n1 = calculateMascotEvolution(0.75);
    expect(n1.form).toBe("nova");
    expect(n1.formProgress).toBe(1.0);

    const n2 = calculateMascotEvolution(1.0);
    expect(n2.form).toBe("nova");
    expect(n2.formProgress).toBe(1.0);
  });
});
