import { describe, it, expect } from "vitest";
import {
  sparkFormSchema,
  encounterSourceSchema,
  hintLevelSchema,
  dailyQuestSchema,
  gameSummarySchema,
  eclipseSchema,
  createEncounterInputSchema,
  encounterSchema,
  encounterResultSchema,
  courseEffortSchema,
  classSkyConceptSchema,
  classSkySnapshotSchema,
  encounterHintResponseSchema,
  gameUpdatedEventSchema,
  partyQuestUpdatedEventSchema,
} from "../../../src/contracts/index.js";
import {
  FIXTURE_DAILY_QUEST,
  FIXTURE_GAME_SUMMARY,
  FIXTURE_ECLIPSE,
  FIXTURE_ENCOUNTER,
  FIXTURE_ENCOUNTER_HINT,
  FIXTURE_ENCOUNTER_RESULT,
  FIXTURE_COURSE_EFFORT,
  FIXTURE_CLASS_SKY_SNAPSHOT,
  FIXTURE_GAME_UPDATED_PAYLOAD,
  FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD,
} from "../../fixtures/game.fixture.js";

const VALID_UUID = "44444444-4444-4444-8444-444444444402";
const VALID_UUID_2 = "33333333-3333-4333-8333-333333333317";

describe("Lane A: Shared Game, Encounter & Party Extension Contracts (P1-A-05)", () => {
  describe("1. Fixture Conformance (docs/contracts/examples.md Section 5)", () => {
    it("parses FIXTURE_DAILY_QUEST into documented shape", () => {
      const parsed = dailyQuestSchema.parse(FIXTURE_DAILY_QUEST);
      expect(parsed.id).toBe(FIXTURE_DAILY_QUEST.id);
      expect(parsed.studentId).toBe(FIXTURE_DAILY_QUEST.studentId);
      expect(parsed.date).toBe("2026-10-21");
      expect(parsed.items).toHaveLength(3);
      expect(parsed.clearedAt).toBeNull();
      expect(parsed.version).toBe(1);
    });

    it("parses FIXTURE_GAME_SUMMARY into documented shape", () => {
      const parsed = gameSummarySchema.parse(FIXTURE_GAME_SUMMARY);
      expect(parsed.studentId).toBe(FIXTURE_GAME_SUMMARY.studentId);
      expect(parsed.courseId).toBe(FIXTURE_GAME_SUMMARY.courseId);
      expect(parsed.xp).toBe(420);
      expect(parsed.streakDays).toBe(3);
      expect(parsed.skyBrightness).toBe(0.58);
      expect(parsed.form).toBe("glow");
      expect(parsed.formProgress).toBe(0.15);
      expect(parsed.updatedAt).toBe("2026-10-21T14:30:00.000Z");
    });

    it("parses FIXTURE_ECLIPSE into documented shape", () => {
      const parsed = eclipseSchema.parse(FIXTURE_ECLIPSE);
      expect(parsed.studentId).toBe(FIXTURE_ECLIPSE.studentId);
      expect(parsed.strength).toBe(39);
      expect(parsed.targets).toHaveLength(2);
      expect(parsed.examAt).toBe("2026-11-01T14:00:00.000Z");
    });

    it("parses FIXTURE_ENCOUNTER into documented shape", () => {
      const parsed = encounterSchema.parse(FIXTURE_ENCOUNTER);
      expect(parsed.id).toBe(FIXTURE_ENCOUNTER.id);
      expect(parsed.source).toBe("daily");
      expect(parsed.questId).toBe(FIXTURE_ENCOUNTER.questId);
      expect(parsed.partyQuestId).toBeNull();
      expect(parsed.status).toBe("active");
      expect(parsed.questions).toHaveLength(5);
      expect(parsed.questions[0].options).toHaveLength(4);
      expect(parsed.version).toBe(1);
    });

    it("parses FIXTURE_ENCOUNTER_HINT into documented shape", () => {
      const parsed = encounterHintResponseSchema.parse(FIXTURE_ENCOUNTER_HINT);
      expect(parsed.questionId).toBe(FIXTURE_ENCOUNTER_HINT.questionId);
      expect(parsed.level).toBe(1);
      expect(parsed.text).toBe(FIXTURE_ENCOUNTER_HINT.text);
    });

    it("parses FIXTURE_ENCOUNTER_RESULT into documented shape", () => {
      const parsed = encounterResultSchema.parse(FIXTURE_ENCOUNTER_RESULT);
      expect(parsed.encounterId).toBe(FIXTURE_ENCOUNTER_RESULT.encounterId);
      expect(parsed.attemptId).toBe(FIXTURE_ENCOUNTER_RESULT.attemptId);
      expect(parsed.score).toBe(0.8);
      expect(parsed.correctCount).toBe(4);
      expect(parsed.totalQuestions).toBe(5);
      expect(parsed.newConfidence).toBe(0.35);
      expect(parsed.newBand).toBe("red");
      expect(parsed.feedback).toHaveLength(5);
      expect(parsed.xpAwarded).toBe(88);
      expect(parsed.summary.xp).toBe(508);
      expect(parsed.dailyQuest).not.toBeNull();
    });

    it("parses FIXTURE_COURSE_EFFORT into documented shape", () => {
      const parsed = FIXTURE_COURSE_EFFORT.map((item: unknown) => courseEffortSchema.parse(item));
      expect(parsed).toHaveLength(2);
      expect(parsed[0].flag).toBe("high_effort_low_mastery");
      expect(parsed[0].enrolledAt).toBe("2026-10-01T10:00:00.000Z");
      expect(parsed[0].unassessed).toBe(false);
      expect(parsed[1].flag).toBeNull();
      expect(parsed[1].enrolledAt).toBe("2026-10-01T10:05:00.000Z");
      expect(parsed[1].unassessed).toBe(false);
    });

    it("parses FIXTURE_CLASS_SKY_SNAPSHOT into documented shape", () => {
      const parsed = classSkySnapshotSchema.parse(FIXTURE_CLASS_SKY_SNAPSHOT);
      expect(parsed.courseId).toBe(FIXTURE_CLASS_SKY_SNAPSHOT.courseId);
      expect(parsed.totalStudents).toBe(2);
      expect(parsed.concepts).toHaveLength(2);
      for (const concept of parsed.concepts) {
        expect(() => classSkyConceptSchema.parse(concept)).not.toThrow();
      }
      expect(parsed.concepts[0].band).toBe("red");
      expect(parsed.concepts[0].taught).toBe(true);
      expect(parsed.concepts[1].band).toBe("green");
      expect(parsed.concepts[1].taught).toBe(false);
    });

    it("parses FIXTURE_GAME_UPDATED_PAYLOAD into documented shape", () => {
      const parsed = gameUpdatedEventSchema.parse(FIXTURE_GAME_UPDATED_PAYLOAD);
      expect(parsed.eventId).toBe(FIXTURE_GAME_UPDATED_PAYLOAD.eventId);
      expect(parsed.studentId).toBe(FIXTURE_GAME_UPDATED_PAYLOAD.studentId);
      expect(parsed.summary.xp).toBe(508);
      expect(parsed.dailyQuest?.items).toHaveLength(1);
    });

    it("parses FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD into documented shape", () => {
      const parsed = partyQuestUpdatedEventSchema.parse(FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD);
      expect(parsed.eventId).toBe(FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD.eventId);
      expect(parsed.matchId).toBe(FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD.matchId);
      expect(parsed.status).toBe("completed");
      expect(parsed.totalPairs).toBe(2);
      expect(parsed.completedPairs).toBe(2);
    });
  });

  describe("2. Enum & Literal Domains", () => {
    it("enforces SparkForm allowed values", () => {
      for (const form of ["ember", "spark", "glow", "nova"]) {
        expect(sparkFormSchema.safeParse(form).success).toBe(true);
      }
      expect(sparkFormSchema.safeParse("blaze").success).toBe(false);
      expect(sparkFormSchema.safeParse("fire").success).toBe(false);
      expect(sparkFormSchema.safeParse("").success).toBe(false);
    });

    it("enforces EncounterSource allowed values", () => {
      for (const source of ["star", "daily", "eclipse", "party"]) {
        expect(encounterSourceSchema.safeParse(source).success).toBe(true);
      }
      expect(encounterSourceSchema.safeParse("weekly").success).toBe(false);
      expect(encounterSourceSchema.safeParse("boss").success).toBe(false);
    });

    it("enforces HintLevel 1 | 2 | 3", () => {
      expect(hintLevelSchema.safeParse(1).success).toBe(true);
      expect(hintLevelSchema.safeParse(2).success).toBe(true);
      expect(hintLevelSchema.safeParse(3).success).toBe(true);
      expect(hintLevelSchema.safeParse(0).success).toBe(false);
      expect(hintLevelSchema.safeParse(4).success).toBe(false);
      expect(hintLevelSchema.safeParse(-1).success).toBe(false);
      expect(hintLevelSchema.safeParse(1.5).success).toBe(false);
      expect(hintLevelSchema.safeParse(NaN).success).toBe(false);
      expect(hintLevelSchema.safeParse(Infinity).success).toBe(false);
    });
  });

  describe("3. Numeric Boundaries & Invariants", () => {
    it("validates skyBrightness and formProgress in [0, 1] as finite numbers", () => {
      const base = { ...FIXTURE_GAME_SUMMARY };

      expect(gameSummarySchema.safeParse({ ...base, skyBrightness: 0.0, formProgress: 0.0 }).success).toBe(true);
      expect(gameSummarySchema.safeParse({ ...base, skyBrightness: 1.0, formProgress: 1.0 }).success).toBe(true);
      expect(gameSummarySchema.safeParse({ ...base, skyBrightness: -0.01 }).success).toBe(false);
      expect(gameSummarySchema.safeParse({ ...base, skyBrightness: 1.01 }).success).toBe(false);
      expect(gameSummarySchema.safeParse({ ...base, skyBrightness: NaN }).success).toBe(false);
      expect(gameSummarySchema.safeParse({ ...base, skyBrightness: Infinity }).success).toBe(false);
      expect(gameSummarySchema.safeParse({ ...base, formProgress: -0.01 }).success).toBe(false);
      expect(gameSummarySchema.safeParse({ ...base, formProgress: 1.01 }).success).toBe(false);
      expect(gameSummarySchema.safeParse({ ...base, formProgress: NaN }).success).toBe(false);
    });

    it("validates eclipse strength integer [0, 100]", () => {
      const base = { ...FIXTURE_ECLIPSE };

      expect(eclipseSchema.safeParse({ ...base, strength: 0 }).success).toBe(true);
      expect(eclipseSchema.safeParse({ ...base, strength: 100 }).success).toBe(true);
      expect(eclipseSchema.safeParse({ ...base, strength: -1 }).success).toBe(false);
      expect(eclipseSchema.safeParse({ ...base, strength: 101 }).success).toBe(false);
      expect(eclipseSchema.safeParse({ ...base, strength: 50.5 }).success).toBe(false);
      expect(eclipseSchema.safeParse({ ...base, strength: NaN }).success).toBe(false);
    });

    it("validates hintsUsed integer in [0, 3]", () => {
      const makeEncounter = (hintsUsed: number) => ({
        ...FIXTURE_ENCOUNTER,
        questions: FIXTURE_ENCOUNTER.questions.map((q: unknown, idx: number) =>
          idx === 0 ? { ...(q as Record<string, unknown>), hintsUsed } : q
        ),
      });

      expect(encounterSchema.safeParse(makeEncounter(0)).success).toBe(true);
      expect(encounterSchema.safeParse(makeEncounter(3)).success).toBe(true);
      expect(encounterSchema.safeParse(makeEncounter(-1)).success).toBe(false);
      expect(encounterSchema.safeParse(makeEncounter(4)).success).toBe(false);
      expect(encounterSchema.safeParse(makeEncounter(1.5)).success).toBe(false);
      expect(encounterSchema.safeParse(makeEncounter(NaN)).success).toBe(false);
      expect(encounterSchema.safeParse(makeEncounter(Infinity)).success).toBe(false);
    });
  });

  describe("4. Array Length Constraints & Calendar Dates", () => {
    it("validates DailyQuest items between 0 and 3, and nullable clearedAt", () => {
      const base = { ...FIXTURE_DAILY_QUEST };

      // 0 items
      expect(dailyQuestSchema.safeParse({ ...base, items: [] }).success).toBe(true);
      // clearedAt nullable
      expect(dailyQuestSchema.safeParse({ ...base, clearedAt: "2026-10-21T16:00:00.000Z" }).success).toBe(true);
      expect(dailyQuestSchema.safeParse({ ...base, clearedAt: null }).success).toBe(true);
      // clearedAt cannot be undefined
      const withoutClearedAt = { ...base };
      delete (withoutClearedAt as Record<string, unknown>).clearedAt;
      expect(dailyQuestSchema.safeParse(withoutClearedAt).success).toBe(false);

      // 4 items must fail
      const fourItems = [
        ...base.items,
        {
          conceptId: VALID_UUID_2,
          confidence: 0.1,
          band: "red" as const,
          reviewState: "unreviewed" as const,
          completed: false,
        },
      ];
      expect(dailyQuestSchema.safeParse({ ...base, items: fourItems }).success).toBe(false);
    });

    it("validates ISO calendar date format and rejects invalid dates", () => {
      const base = { ...FIXTURE_DAILY_QUEST };

      expect(dailyQuestSchema.safeParse({ ...base, date: "2026-10-21" }).success).toBe(true);
      expect(dailyQuestSchema.safeParse({ ...base, date: "2026-02-30" }).success).toBe(false);
      expect(dailyQuestSchema.safeParse({ ...base, date: "10-21-2026" }).success).toBe(false);
      expect(dailyQuestSchema.safeParse({ ...base, date: "not-a-date" }).success).toBe(false);
    });

    it("validates Eclipse targets between 0 and 3, and nullable examAt", () => {
      const base = { ...FIXTURE_ECLIPSE };

      expect(eclipseSchema.safeParse({ ...base, targets: [] }).success).toBe(true);
      expect(eclipseSchema.safeParse({ ...base, examAt: null }).success).toBe(true);
      expect(eclipseSchema.safeParse({ ...base, examAt: "2026-12-01T10:00:00.000Z" }).success).toBe(true);

      const fourTargets = [
        ...base.targets,
        { conceptId: VALID_UUID_2, confidence: 0.2, band: "red" as const },
        { conceptId: VALID_UUID, confidence: 0.4, band: "yellow" as const },
      ];
      expect(eclipseSchema.safeParse({ ...base, targets: fourTargets }).success).toBe(false);
    });

    it("enforces encounter exactly 5 questions and 4 options per question", () => {
      const base = { ...FIXTURE_ENCOUNTER };

      // 4 questions
      expect(encounterSchema.safeParse({ ...base, questions: base.questions.slice(0, 4) }).success).toBe(false);
      // 6 questions
      expect(encounterSchema.safeParse({ ...base, questions: [...base.questions, base.questions[0]] }).success).toBe(false);

      // Question with 3 options
      const invalidQ = { ...base.questions[0], options: ["A", "B", "C"] as unknown as [string, string, string, string] };
      expect(encounterSchema.safeParse({ ...base, questions: [invalidQ, ...base.questions.slice(1)] }).success).toBe(false);
    });

    it("enforces encounter result totalQuestions literal 5 and feedback length 5", () => {
      const base = { ...FIXTURE_ENCOUNTER_RESULT };

      expect(encounterResultSchema.safeParse({ ...base, totalQuestions: 4 as unknown as 5 }).success).toBe(false);
      expect(encounterResultSchema.safeParse({ ...base, correctCount: -1 }).success).toBe(false);
      expect(encounterResultSchema.safeParse({ ...base, correctCount: 6 }).success).toBe(false);
      expect(encounterResultSchema.safeParse({ ...base, feedback: base.feedback.slice(0, 4) }).success).toBe(false);

      // Out of range correctOption
      const badFeedback = { ...base.feedback[0], correctOption: 4 };
      expect(encounterResultSchema.safeParse({ ...base, feedback: [badFeedback, ...base.feedback.slice(1)] }).success).toBe(false);
    });
  });

  describe("5. Creation Discriminated Union & Strict Linkage", () => {
    it("validates star and eclipse sources require conceptId only and reject linkage fields", () => {
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "star" }).success).toBe(true);
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "eclipse" }).success).toBe(true);

      // Rejects questId for star
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "star", questId: VALID_UUID_2 }).success).toBe(false);
      // Rejects partyQuestId for eclipse
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "eclipse", partyQuestId: VALID_UUID_2 }).success).toBe(false);
    });

    it("validates daily source requires questId and rejects partyQuestId", () => {
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "daily", questId: VALID_UUID_2 }).success).toBe(true);
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "daily" }).success).toBe(false);
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "daily", questId: VALID_UUID_2, partyQuestId: VALID_UUID_2 }).success).toBe(false);
    });

    it("validates party source requires partyQuestId and rejects questId", () => {
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "party", partyQuestId: VALID_UUID_2 }).success).toBe(true);
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "party" }).success).toBe(false);
      expect(createEncounterInputSchema.safeParse({ conceptId: VALID_UUID, source: "party", partyQuestId: VALID_UUID_2, questId: VALID_UUID_2 }).success).toBe(false);
    });
  });

  describe("6. Stripping Unknown Fields & Private Answer Leakage", () => {
    it("strips correctAnswer, correctOption, explanation, and hints from encounter questions", () => {
      const leakedQuestion = {
        ...FIXTURE_ENCOUNTER.questions[0],
        correctAnswer: "Because local gradients evaluate partial derivatives at forward activation values",
        correctOption: 1,
        explanation: "This is private explanation text",
        hints: ["Hint 1", "Hint 2", "Hint 3"],
      };

      const payloadWithLeak = {
        ...FIXTURE_ENCOUNTER,
        questions: [leakedQuestion, ...FIXTURE_ENCOUNTER.questions.slice(1)],
      };

      const parsed = encounterSchema.parse(payloadWithLeak);
      const firstQ = parsed.questions[0] as Record<string, unknown>;

      expect(firstQ.questionId).toBe(leakedQuestion.questionId);
      expect(firstQ.question).toBe(leakedQuestion.question);
      expect(firstQ.options).toEqual(leakedQuestion.options);
      expect(firstQ.hintsUsed).toBe(0);

      // Private fields stripped
      expect(firstQ.correctAnswer).toBeUndefined();
      expect(firstQ.correctOption).toBeUndefined();
      expect(firstQ.explanation).toBeUndefined();
      expect(firstQ.hints).toBeUndefined();
    });

    it("preserves correctOption and explanation in EncounterResult feedback", () => {
      const parsed = encounterResultSchema.parse(FIXTURE_ENCOUNTER_RESULT);
      expect(parsed.feedback[0].correctOption).toBe(1);
      expect(parsed.feedback[0].explanation).toContain("Local gradients");
    });
  });

  describe("7. Party Quest Updated Event Invariants", () => {
    it("accepts valid totalPairs (2, 4, 6) with completedPairs <= totalPairs", () => {
      const base = { ...FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD };

      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 2, completedPairs: 0 }).success).toBe(true);
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 2, completedPairs: 2 }).success).toBe(true);
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 4, completedPairs: 3 }).success).toBe(true);
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 6, completedPairs: 6 }).success).toBe(true);
    });

    it("rejects invalid totalPairs or completedPairs > totalPairs", () => {
      const base = { ...FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD };

      // Invalid totalPairs (must be 2, 4, or 6)
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 3, completedPairs: 2 }).success).toBe(false);
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 5, completedPairs: 2 }).success).toBe(false);
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 8, completedPairs: 2 }).success).toBe(false);

      // completedPairs > totalPairs
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 2, completedPairs: 3 }).success).toBe(false);
      // Negative completedPairs
      expect(partyQuestUpdatedEventSchema.safeParse({ ...base, totalPairs: 2, completedPairs: -1 }).success).toBe(false);
    });
  });

  describe("8. Class Sky and Course Effort Contracts (P4-A-03)", () => {
    const validClassSkyConcept = {
      conceptId: VALID_UUID,
      label: "Recursion",
      category: "Algorithms",
      averageConfidence: 0.75,
      distribution: { gray: 0, red: 0, yellow: 1, green: 1 },
      band: "yellow",
      taught: true,
    };

    const validClassSkySnapshot = {
      courseId: VALID_UUID_2,
      totalStudents: 2,
      concepts: [validClassSkyConcept],
    };

    it("rejects missing or non-boolean unassessed in courseEffortSchema", () => {
      const base = { ...FIXTURE_COURSE_EFFORT[0] };

      expect(courseEffortSchema.safeParse({ ...base, unassessed: true }).success).toBe(true);
      expect(courseEffortSchema.safeParse({ ...base, unassessed: false }).success).toBe(true);

      const missingUnassessed = { ...base };
      delete (missingUnassessed as Record<string, unknown>).unassessed;
      expect(courseEffortSchema.safeParse(missingUnassessed).success).toBe(false);

      expect(courseEffortSchema.safeParse({ ...base, unassessed: "true" }).success).toBe(false);
      expect(courseEffortSchema.safeParse({ ...base, unassessed: 1 }).success).toBe(false);
      expect(courseEffortSchema.safeParse({ ...base, unassessed: null }).success).toBe(false);
    });

    it("rejects CourseEffortDTO with invalid enrolledAt timestamp", () => {
      const invalidEffort = {
        ...FIXTURE_COURSE_EFFORT[0],
        enrolledAt: "not-a-timestamp",
      };
      expect(courseEffortSchema.safeParse(invalidEffort).success).toBe(false);
    });

    it("validates ClassSkyConcept shape and rejects invalid confidence", () => {
      expect(classSkyConceptSchema.safeParse(validClassSkyConcept).success).toBe(true);

      expect(classSkyConceptSchema.safeParse({ ...validClassSkyConcept, taught: "yes" }).success).toBe(false);
      expect(classSkyConceptSchema.safeParse({ ...validClassSkyConcept, band: "purple" }).success).toBe(false);
      expect(classSkyConceptSchema.safeParse({ ...validClassSkyConcept, averageConfidence: -0.1 }).success).toBe(false);
      expect(classSkyConceptSchema.safeParse({ ...validClassSkyConcept, averageConfidence: 1.1 }).success).toBe(false);
      expect(classSkyConceptSchema.safeParse({ ...validClassSkyConcept, averageConfidence: NaN }).success).toBe(false);
      expect(classSkyConceptSchema.safeParse({ ...validClassSkyConcept, averageConfidence: Infinity }).success).toBe(false);
    });

    it("enforces distribution sum invariant in ClassSkySnapshot via safeExtend", () => {
      expect(classSkySnapshotSchema.safeParse(validClassSkySnapshot).success).toBe(true);

      // Distribution sum (1) != totalStudents (2) -> must reject
      const invalidDistribution = {
        ...validClassSkySnapshot,
        concepts: [{
          ...validClassSkyConcept,
          distribution: { gray: 1, red: 0, yellow: 0, green: 0 }, // sum 1 !== 2
        }],
      };
      expect(classSkySnapshotSchema.safeParse(invalidDistribution).success).toBe(false);

      // Empty concepts array is valid with totalStudents: 0
      expect(classSkySnapshotSchema.safeParse({
        courseId: VALID_UUID_2,
        totalStudents: 0,
        concepts: [],
      }).success).toBe(true);
    });
  });
});
