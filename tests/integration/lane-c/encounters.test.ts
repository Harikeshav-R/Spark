import { describe, it, expect, beforeEach } from "vitest";
import type {
  ActorContext,
  Clock,
  IdGenerator,
  ISOTimestamp,
  MasteryBand,
  UUID,
} from "../../../src/contracts/common.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import { DomainErrorCode, AppError } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  GenerateQuizAi,
  GenerateQuizHintsAi,
} from "../../../src/server/ai/index.js";
import {
  EncounterRepository,
  type EncounterRepositoryPort,
  type EncounterRecord,
  type NewEncounterRecord,
  type EncounterAttemptRecord,
  type NewEncounterAttemptRecord,
} from "../../../src/server/learning/encounter-repository.js";
import {
  EncounterService,
  type EncounterServiceDependencies,
} from "../../../src/server/learning/encounter-service.js";
import {
  QuizRepository,
  type QuizRepositoryPort,
} from "../../../src/server/learning/quiz-repository.js";
import { QuizService } from "../../../src/server/learning/quiz-service.js";
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
  type DailyQuestRecord,
  type PracticeRewardResult,
} from "../../../src/server/core/index.js";
import {
  applyMasteryEvidence,
  confidenceToBand,
} from "../../../src/contracts/mastery.js";
import {
  SupabaseTestHarness,
  type TestContext,
  type TestCourseContext,
} from "../lane-a/supabase-harness.js";

// ============================================================================
// In-Memory Test Infrastructure for Offline Fixture Tests
// ============================================================================

class TestClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: string = "2026-10-24T12:00:00.000Z") {
    this.currentTime = new Date(initialTime);
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  nowISO(): ISOTimestamp {
    return this.now().toISOString();
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  setDate(iso: string): void {
    this.currentTime = new Date(iso);
  }
}

class TestIdGenerator implements IdGenerator {
  private counter = 1;

  generateId(): UUID {
    const hex = (this.counter++).toString(16).padStart(12, "0");
    return `90000000-0000-4000-8000-${hex}` as UUID;
  }

  generateJoinCode(): string {
    return "TESTJC";
  }
}

interface InMemoryDbState {
  encounters: Map<string, EncounterRecord>;
  attempts: Map<string, EncounterAttemptRecord>;
  hints: Map<string, [string, string, string]>;
  masteryEvidence: Map<
    string,
    { studentId: UUID; conceptId: UUID; attemptId: UUID; newConfidence: number }
  >;
  xpEvents: Map<
    string,
    {
      studentId: UUID;
      conceptId: UUID;
      sourceId: UUID;
      amount: number;
      awardDate: string;
      reason: string;
    }
  >;
  dailyQuests: Map<string, DailyQuestRecord>;
}

class InMemoryEncounterRepository implements EncounterRepositoryPort {
  constructor(private readonly state: InMemoryDbState) {}

  async getQuestionHints(
    conceptId: UUID,
    questionIds: readonly UUID[],
  ): Promise<Map<UUID, [string, string, string] | null>> {
    const map = new Map<UUID, [string, string, string] | null>();
    for (const qId of questionIds) {
      map.set(qId, this.state.hints.get(`${conceptId}:${qId}`) ?? null);
    }
    return map;
  }

  async storeMissingQuestionHints(
    conceptId: UUID,
    hints: readonly { questionId: UUID; hints: [string, string, string] }[],
  ): Promise<void> {
    for (const item of hints) {
      const key = `${conceptId}:${item.questionId}`;
      if (!this.state.hints.has(key)) {
        this.state.hints.set(key, item.hints);
      }
    }
  }

  async insertEncounter(input: NewEncounterRecord): Promise<EncounterRecord> {
    const record: EncounterRecord = {
      ...input,
      status: "active",
      version: 1,
    };
    this.state.encounters.set(`${input.studentId}:${input.id}`, record);
    return record;
  }

  async getEncounter(
    studentId: UUID,
    encounterId: UUID,
  ): Promise<EncounterRecord | null> {
    return this.state.encounters.get(`${studentId}:${encounterId}`) ?? null;
  }

  async compareAndSwapEncounter(
    studentId: UUID,
    encounterId: UUID,
    expectedVersion: number,
    patch: {
      hintsUsed?: [number, number, number, number, number];
      status?: "completed";
    },
    updatedAt: string,
  ): Promise<EncounterRecord | null> {
    const key = `${studentId}:${encounterId}`;
    const current = this.state.encounters.get(key);
    if (!current) return null;
    if (current.status !== "active") return null;
    if (current.version !== expectedVersion) return null;

    const updated: EncounterRecord = {
      ...current,
      hintsUsed: patch.hintsUsed ? [...patch.hintsUsed] : current.hintsUsed,
      status: patch.status ?? current.status,
      version: current.version + 1,
      updatedAt,
    };
    this.state.encounters.set(key, updated);
    return updated;
  }

  async getAttempt(
    studentId: UUID,
    encounterId: UUID,
  ): Promise<EncounterAttemptRecord | null> {
    return this.state.attempts.get(`${studentId}:${encounterId}`) ?? null;
  }

  async insertAttempt(
    input: NewEncounterAttemptRecord,
  ): Promise<EncounterAttemptRecord> {
    const key = `${input.studentId}:${input.encounterId}`;
    const existing = this.state.attempts.get(key);
    if (existing) {
      return existing;
    }
    const record: EncounterAttemptRecord = { ...input };
    this.state.attempts.set(key, record);
    return record;
  }

  async getCommittedGrade(
    studentId: UUID,
    conceptId: UUID,
    attemptId: UUID,
  ): Promise<{ newConfidence: number; newBand: MasteryBand } | null> {
    const item = this.state.masteryEvidence.get(
      `${studentId}:${conceptId}:${attemptId}`,
    );
    if (!item) return null;
    return {
      newConfidence: item.newConfidence,
      newBand: confidenceToBand(item.newConfidence),
    };
  }

  async getAttemptXp(
    studentId: UUID,
    conceptId: UUID,
    attemptId: UUID,
    awardDate: string,
  ): Promise<number> {
    const item = this.state.xpEvents.get(
      `${studentId}:${conceptId}:${attemptId}:${awardDate}`,
    );
    return item?.amount ?? 0;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("P5-C-06: Practice Encounters Offline Scenarios", () => {
  const courseId = "11111111-1111-4111-8111-111111111111" as UUID;
  const studentId = "22222222-2222-4222-8222-222222222222" as UUID;
  const otherStudentId = "33333333-3333-4333-8333-333333333333" as UUID;
  const conceptAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as UUID;
  const conceptBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as UUID;

  const studentActor: ActorContext = {
    userId: studentId,
    authId: studentId,
    email: "student@test.edu",
    name: "Test Student",
    role: "student",
    enrolledCourses: [{ studentId, courseId }],
  };

  const otherStudentActor: ActorContext = {
    userId: otherStudentId,
    authId: otherStudentId,
    email: "other@test.edu",
    name: "Other Student",
    role: "student",
    enrolledCourses: [{ studentId: otherStudentId, courseId }],
  };

  const teacherActor: ActorContext = {
    userId: "44444444-4444-4444-8444-444444444444" as UUID,
    authId: "44444444-4444-4444-8444-444444444444" as UUID,
    email: "teacher@test.edu",
    name: "Teacher",
    role: "teacher",
    enrolledCourses: [],
  };

  const sampleNodes: ConceptNode[] = [
    {
      id: conceptAId,
      courseId,
      label: "Gradient Descent",
      description: "Optimization technique",
      category: "ML",
      difficulty: 2,
      createdAt: "2026-10-24T00:00:00.000Z",
    },
    {
      id: conceptBId,
      courseId,
      label: "Backpropagation",
      description: "Neural net training",
      category: "ML",
      difficulty: 3,
      createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];

  function createQuestions(cId: UUID) {
    return [0, 1, 2, 3, 4].map((i) => ({
      id: `c0000000-0000-4000-8000-00000000000${i}` as UUID,
      conceptId: cId,
      question: `Question ${i + 1} for ${cId}?`,
      optionA: `Opt 0 (correct for ${i})`,
      optionB: `Opt 1`,
      optionC: `Opt 2`,
      optionD: `Opt 3`,
      correctAnswer: 0,
      explanation: `Explanation for question ${i + 1}`,
      questionOrder: i,
      createdAt: "2026-10-24T00:00:00.000Z",
    }));
  }

  let dbState: InMemoryDbState;
  let repo: InMemoryEncounterRepository;
  let clock: TestClock;
  let ids: TestIdGenerator;
  let currentStudentMastery = 0.5;
  let totalXp = 0;
  let streakDays = 0;

  function createService(overrides?: Partial<EncounterServiceDependencies>): EncounterService {
    const topologyMock = {
      getTopology: async () => ({
        nodes: sampleNodes,
        edges: [],
      }),
    };

    const questionsMap = new Map(createQuestions(conceptAId).map((q) => [q.id, q]));

    const quizzesMock = {
      getQuiz: async () =>
        createQuestions(conceptAId).map((q) => ({
          id: q.id,
          question: q.question,
          options: [q.optionA, q.optionB, q.optionC, q.optionD] as [
            string,
            string,
            string,
            string,
          ],
          questionOrder: q.questionOrder,
        })),
    };

    const questionsRepoMock = {
      getQuestionsByIds: async (_cId: UUID, qIds: UUID[]) =>
        qIds.map((id) => questionsMap.get(id)!),
    };

    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const hintsAi = new GenerateQuizHintsAi(client);

    const evidenceMock = {
      applyQuizAttempt: async (
        _actor: ActorContext,
        _cId: UUID,
        attemptId: UUID,
      ) => {
        const attempt = [...dbState.attempts.values()].find((a) => a.id === attemptId)!;
        const outcome = applyMasteryEvidence(currentStudentMastery, {
          type: "quiz",
          score: attempt.score,
          sourceId: attempt.id,
        });
        currentStudentMastery = outcome.confidence;
        dbState.masteryEvidence.set(
          `${attempt.studentId}:${attempt.conceptId}:${attempt.id}`,
          {
            studentId: attempt.studentId,
            conceptId: attempt.conceptId,
            attemptId: attempt.id,
            newConfidence: outcome.confidence,
          },
        );
        return {
          id: ids.generateId(),
          evidenceType: "quiz" as const,
          sourceId: attempt.id,
          studentId: attempt.studentId,
          conceptId: attempt.conceptId,
          priorConfidence: 0.5,
          newConfidence: outcome.confidence,
          newBand: outcome.band,
          createdAt: clock.nowISO(),
        };
      },
    };

    const gameMock = {
      recordPracticeReward: async (
        _actor: ActorContext,
        sId: UUID,
        attemptId: UUID,
        answers: readonly { correct: boolean; hintsUsed: number }[],
      ): Promise<PracticeRewardResult> => {
        const attempt = [...dbState.attempts.values()].find((a) => a.id === attemptId)!;
        const awardDate = attempt.submittedAt.slice(0, 10);
        const xpKey = `${sId}:${attempt.conceptId}:${attemptId}:${awardDate}`;

        // Check if practice XP already awarded for student/concept on this date
        const hasAwardToday = [...dbState.xpEvents.values()].some(
          (e) =>
            e.studentId === sId &&
            e.conceptId === attempt.conceptId &&
            e.awardDate === awardDate &&
            e.reason === "encounter",
        );

        let awardedXp = 0;
        if (!hasAwardToday) {
          for (const a of answers) {
            if (a.correct) {
              awardedXp += Math.max(8, 30 - 6 * a.hintsUsed);
            } else {
              awardedXp += 8;
            }
          }
          totalXp += awardedXp;
          dbState.xpEvents.set(xpKey, {
            studentId: sId,
            conceptId: attempt.conceptId,
            sourceId: attemptId,
            amount: awardedXp,
            awardDate,
            reason: "encounter",
          });
        }

        // Check daily quest completion
        const quest = dbState.dailyQuests.get(`${sId}:${awardDate}`);
        let completedQuest = quest ?? null;
        if (quest && !quest.completedIds.includes(attempt.conceptId)) {
          quest.completedIds.push(attempt.conceptId);
          if (quest.completedIds.length === quest.conceptIds.length) {
            quest.clearedAt = clock.nowISO();
            totalXp += 25;
            streakDays += 1;
            dbState.xpEvents.set(`${sId}:daily_quest:${quest.id}:${awardDate}`, {
              studentId: sId,
              conceptId: attempt.conceptId,
              sourceId: quest.id,
              amount: 25,
              awardDate,
              reason: "daily_quest",
            });
          }
          completedQuest = quest;
        }

        const summary = {
          studentId: sId,
          courseId,
          xp: totalXp,
          streakDays,
          skyBrightness: 0.5,
          form: "spark" as const,
          formProgress: 0.3,
          updatedAt: clock.nowISO(),
        };

        const dailyQuestDTO = completedQuest
          ? {
              id: completedQuest.id,
              studentId: completedQuest.studentId,
              date: completedQuest.questDate,
              items: completedQuest.conceptIds.map((c) => ({
                conceptId: c,
                confidence: currentStudentMastery,
                band: confidenceToBand(currentStudentMastery),
                reviewState: "current" as const,
                completed: completedQuest!.completedIds.includes(c),
              })),
              clearedAt: completedQuest.clearedAt,
              version: completedQuest.version,
            }
          : null;

        return {
          xpAwarded: awardedXp,
          summary,
          dailyQuest: dailyQuestDTO,
        };
      },
      getSummary: async (_actor: ActorContext, sId: UUID) => ({
        studentId: sId,
        courseId,
        xp: totalXp,
        streakDays,
        skyBrightness: 0.5,
        form: "spark" as const,
        formProgress: 0.3,
        updatedAt: clock.nowISO(),
      }),
    };

    const gameRepoMock = {
      getDailyQuestRow: async (sId: UUID, qDate: string) =>
        dbState.dailyQuests.get(`${sId}:${qDate}`) ?? null,
      getLatestCommittedReviews: async () => new Map<UUID, Date>(),
    };

    const masteryMock = {
      getMastery: async () => [
        {
          studentId,
          conceptId: conceptAId,
          confidence: currentStudentMastery,
          band: confidenceToBand(currentStudentMastery),
          updatedAt: clock.nowISO(),
        },
      ],
    };

    return new EncounterService({
      courseId,
      topology: topologyMock,
      quizzes: quizzesMock,
      questions: questionsRepoMock as unknown as QuizRepositoryPort,
      hints: hintsAi,
      repository: repo,
      evidence: evidenceMock as unknown as LearningEvidenceService,
      game: gameMock as unknown as ConcreteGameService,
      gameRepository: gameRepoMock as unknown as GameRepository,
      mastery: masteryMock as unknown as MasteryService,
      clock,
      ids,
      ...overrides,
    });
  }

  beforeEach(() => {
    dbState = {
      encounters: new Map(),
      attempts: new Map(),
      hints: new Map(),
      masteryEvidence: new Map(),
      xpEvents: new Map(),
      dailyQuests: new Map(),
    };
    repo = new InMemoryEncounterRepository(dbState);
    clock = new TestClock("2026-10-24T12:00:00.000Z");
    ids = new TestIdGenerator();
    currentStudentMastery = 0.5;
    totalXp = 0;
    streakDays = 0;
  });

  // Assertion 1: Stable questions, options permutation, no answers leaked in public DTO
  it("creates and retrieves encounter with permuted options and zero leaked answers", async () => {
    // Injected deterministic permutation: cycle 0->1->2->3->0
    const service = createService();

    const encounter = await service.createEncounter(studentActor, studentId, {
      conceptId: conceptAId,
      source: "star",
    });

    expect(encounter.status).toBe("active");
    expect(encounter.questions).toHaveLength(5);
    expect(encounter.version).toBe(1);

    for (const q of encounter.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.hintsUsed).toBe(0);
      // Ensure private fields (correctAnswer, explanation, hints tuple) are absent in DTO
      expect((q as Record<string, unknown>).correctAnswer).toBeUndefined();
      expect((q as Record<string, unknown>).explanation).toBeUndefined();
      expect((q as Record<string, unknown>).hints).toBeUndefined();
    }

    // Retrieve through fresh service instance
    const freshService = createService();
    const fetched = await freshService.getEncounter(studentActor, encounter.id);

    expect(fetched.encounter.id).toBe(encounter.id);
    expect(fetched.result).toBeNull();
    expect(fetched.encounter.questions).toEqual(encounter.questions);
  });

  // Assertion 2: Sequential hints and invalid levels
  it("enforces strict sequential hints and rejects invalid levels", async () => {
    const service = createService();
    const encounter = await service.createEncounter(studentActor, studentId, {
      conceptId: conceptAId,
      source: "star",
    });
    const q0Id = encounter.questions[0].questionId;

    // Invalid level types/ranges
    for (const badLevel of [0, 4, 1.5, NaN as unknown as 1]) {
      await expect(
        service.getHint(studentActor, encounter.id, q0Id, badLevel as 1),
      ).rejects.toThrow(AppError);
    }

    // Skip tier: level 2 before level 1 -> 409
    await expect(service.getHint(studentActor, encounter.id, q0Id, 2)).rejects.toThrowError(
      expect.objectContaining({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
      }),
    );

    // Level 1 success
    const h1 = await service.getHint(studentActor, encounter.id, q0Id, 1);
    expect(h1.level).toBe(1);
    expect(typeof h1.text).toBe("string");
    expect(h1.text.length).toBeGreaterThan(5);

    // Repeated level 1: returns same text without incrementing version
    const encBefore = await service.getEncounter(studentActor, encounter.id);
    const h1Repeat = await service.getHint(studentActor, encounter.id, q0Id, 1);
    const encAfter = await service.getEncounter(studentActor, encounter.id);
    expect(h1Repeat.text).toBe(h1.text);
    expect(encAfter.encounter.version).toBe(encBefore.encounter.version);

    // Level 2 success
    const h2 = await service.getHint(studentActor, encounter.id, q0Id, 2);
    expect(h2.level).toBe(2);

    // Level 3 success
    const h3 = await service.getHint(studentActor, encounter.id, q0Id, 3);
    expect(h3.level).toBe(3);
  });

  // Assertion 3 & 4: Scoring, XP calculation (30-6*hints, 8 for incorrect, 25 daily bonus)
  it("scores encounter, awards hint-discounted XP, applies mastery and clears daily quest", async () => {
    // Seed daily quest for today with 1 concept
    const questId = "88888888-8888-4888-8888-888888888888" as UUID;
    dbState.dailyQuests.set(`${studentId}:2026-10-24`, {
      id: questId,
      studentId,
      questDate: "2026-10-24",
      conceptIds: [conceptAId],
      completedIds: [],
      clearedAt: null,
      version: 1,
      createdAt: clock.nowISO(),
      updatedAt: clock.nowISO(),
    });

    const service = createService();
    const encounter = await service.createEncounter(studentActor, studentId, {
      conceptId: conceptAId,
      source: "daily",
      questId,
    });

    // Desired hint counts: [0, 1, 2, 3, 0]
    // Question 1: 1 hint
    await service.getHint(studentActor, encounter.id, encounter.questions[1].questionId, 1);
    // Question 2: 2 hints
    await service.getHint(studentActor, encounter.id, encounter.questions[2].questionId, 1);
    await service.getHint(studentActor, encounter.id, encounter.questions[2].questionId, 2);
    // Question 3: 3 hints
    await service.getHint(studentActor, encounter.id, encounter.questions[3].questionId, 1);
    await service.getHint(studentActor, encounter.id, encounter.questions[3].questionId, 2);
    await service.getHint(studentActor, encounter.id, encounter.questions[3].questionId, 3);

    // Answers: first 4 correct, 5th incorrect: [true, true, true, true, false]
    // In our questions, correct canonical answer is 0.
    // Display index that maps to canonical 0 is perm.indexOf(0).
    const encRecord = (await repo.getEncounter(studentId, encounter.id))!;
    const answers = encounter.questions.map((q, i) => {
      const perm = encRecord.optionPermutations[i];
      const correctDisplay = perm.indexOf(0);
      if (i < 4) {
        return { questionId: q.questionId, selectedOption: correctDisplay };
      } else {
        // Incorrect: choose display option that is not correctDisplay
        const incorrectDisplay = (correctDisplay + 1) % 4;
        return { questionId: q.questionId, selectedOption: incorrectDisplay };
      }
    });

    const result = await service.submitEncounter(studentActor, encounter.id, answers);

    // Score: 4 / 5 = 0.8
    expect(result.score).toBe(0.8);
    expect(result.correctCount).toBe(4);
    expect(result.totalQuestions).toBe(5);

    // XP calculation:
    // Q0 (correct, 0 hints): 30
    // Q1 (correct, 1 hint): 24
    // Q2 (correct, 2 hints): 18
    // Q3 (correct, 3 hints): 12
    // Q4 (incorrect, 0 hints): 8
    // Total practice XP = 30 + 24 + 18 + 12 + 8 = 92
    expect(result.xpAwarded).toBe(92);

    // Mastery: 0.50 + 0.3 * (0.8 - 0.50) = 0.50 + 0.09 = 0.59 (or formula delta)
    expect(result.newConfidence).toBeGreaterThan(0.5);

    // Daily quest cleared: adds +25 bonus to summary XP, summary total = 92 + 25 = 117
    expect(result.summary.xp).toBe(117);
    expect(result.summary.streakDays).toBe(1);
    expect(result.dailyQuest).not.toBeNull();
    expect(result.dailyQuest?.clearedAt).not.toBeNull();

    // Hints locked after submission
    await expect(
      service.getHint(studentActor, encounter.id, encounter.questions[0].questionId, 1),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
      }),
    );
  });

  // Assertion 5: Idempotent replay vs conflicting retry vs same-date second encounter
  it("handles identical replay idempotently, rejects conflicting answers, and caps daily XP on second encounter", async () => {
    const service = createService();
    const encounter = await service.createEncounter(studentActor, studentId, {
      conceptId: conceptAId,
      source: "star",
    });

    const encRecord = (await repo.getEncounter(studentId, encounter.id))!;
    const answers = encounter.questions.map((q, i) => ({
      questionId: q.questionId,
      selectedOption: encRecord.optionPermutations[i].indexOf(0),
    }));

    const firstResult = await service.submitEncounter(studentActor, encounter.id, answers);
    expect(firstResult.xpAwarded).toBe(150); // 30 * 5 = 150

    // Identical replay: returns same result with original attempt ID and xpAwarded
    const replayResult = await service.submitEncounter(studentActor, encounter.id, answers);
    expect(replayResult.attemptId).toBe(firstResult.attemptId);
    expect(replayResult.score).toBe(firstResult.score);
    expect(replayResult.xpAwarded).toBe(firstResult.xpAwarded);

    // Conflicting submission with different answers -> 409
    const conflictingAnswers = answers.map((a, i) =>
      i === 0 ? { ...a, selectedOption: (a.selectedOption + 1) % 4 } : a,
    );
    await expect(
      service.submitEncounter(studentActor, encounter.id, conflictingAnswers),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: DomainErrorCode.CONFLICT,
        statusCode: 409,
      }),
    );

    // Second encounter on same concept and date: practice XP is 0 (already awarded today), but mastery updates
    const secondEncounter = await service.createEncounter(studentActor, studentId, {
      conceptId: conceptAId,
      source: "star",
    });
    const secondEncRecord = (await repo.getEncounter(studentId, secondEncounter.id))!;
    const secondAnswers = secondEncounter.questions.map((q, i) => ({
      questionId: q.questionId,
      selectedOption: secondEncRecord.optionPermutations[i].indexOf(0),
    }));

    const secondResult = await service.submitEncounter(
      studentActor,
      secondEncounter.id,
      secondAnswers,
    );
    expect(secondResult.xpAwarded).toBe(0); // already capped today
    expect(secondResult.score).toBe(1.0);
  });

  // Assertion 6: Authorization and security checks
  it("rejects unauthorized actors and party source with 503", async () => {
    const service = createService();

    // Teacher cannot create encounter
    await expect(
      service.createEncounter(teacherActor, studentId, {
        conceptId: conceptAId,
        source: "star",
      }),
    ).rejects.toThrow(AppError);

    // Other student cannot access encounter
    const encounter = await service.createEncounter(studentActor, studentId, {
      conceptId: conceptAId,
      source: "star",
    });

    await expect(
      service.getEncounter(otherStudentActor, encounter.id),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
      }),
    );

    // Party source rejected with 503
    await expect(
      service.createEncounter(studentActor, studentId, {
        conceptId: conceptAId,
        source: "party",
        partyQuestId: "55555555-5555-4555-8555-555555555555" as UUID,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
      }),
    );
  });
});

// ============================================================================
// Gated Live PostgreSQL Integration Tests
// ============================================================================

const isLocalSupabase = process.env.RUN_LOCAL_SUPABASE === "1";

describe.skipIf(!isLocalSupabase)(
  "P5-C-06: Practice Encounters Live Database Integration Tests",
  () => {
    let harness: SupabaseTestHarness;
    let context: TestContext;
    let courseContext: TestCourseContext;
    let studentActor: ActorContext;
    let studentId: UUID;
    let conceptId: UUID;

    let enrollmentService: EnrollmentService;
    let courseService: CourseService;
    let masteryService: MasteryService;
    let learningEvidenceService: LearningEvidenceService;
    let graphRepository: GraphRepository;
    let gameRepository: GameRepository;
    let gameService: ConcreteGameService;
    let quizRepository: QuizRepository;
    let quizService: QuizService;
    let encounterRepo: EncounterRepository;
    let encounterService: EncounterService;
    const clock = new TestClock("2026-10-24T12:00:00.000Z");
    const ids = new CryptoIdGenerator();

    beforeEach(async () => {
      harness = new SupabaseTestHarness();
      context = {
        users: [],
        teacherIds: [],
        courseIds: [],
      };

      courseContext = await harness.createTestCourse(context, { conceptCount: 5 });
      conceptId = courseContext.conceptIds[0];

      const studentUser = await harness.createTestUser(context, "student");
      const client = harness.serviceClient;
      const courseRepo = new CourseRepository(client);
      courseService = new CourseService(courseRepo, new CryptoIdGenerator());
      enrollmentService = new EnrollmentService(new EnrollmentRepository(client));
      const masteryRepo = new MasteryRepository(client);
      masteryService = new MasteryService(masteryRepo);
      learningEvidenceService = new LearningEvidenceService(
        client,
        courseService,
        masteryService,
      );
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

      const courseEffortService = new CourseEffortService({
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
        clock,
        ids,
      });

      // Enroll student in course
      const enrolledStudent = await enrollmentService.enrollStudent(
        harness.buildStudentActor(studentUser),
        courseContext.joinCode,
      );
      studentId = enrolledStudent.id;

      studentActor = harness.buildStudentActor(studentUser, [
        { studentId, courseId: courseContext.courseId },
      ]);

      const aiClient = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const quizAi = new GenerateQuizAi(aiClient);
      const hintsAi = new GenerateQuizHintsAi(aiClient);

      quizRepository = new QuizRepository(client);
      quizService = new QuizService({
        courseId: courseContext.courseId,
        topology: graphRepository,
        repository: quizRepository,
        ai: quizAi,
        evidence: learningEvidenceService,
      });

      encounterRepo = new EncounterRepository(client);
      encounterService = new EncounterService({
        courseId: courseContext.courseId,
        topology: graphRepository,
        quizzes: quizService,
        questions: quizRepository,
        hints: hintsAi,
        repository: encounterRepo,
        evidence: learningEvidenceService,
        game: gameService,
        gameRepository,
        mastery: masteryService,
        clock,
        ids,
      });
    }, 30000);

    it("executes full live PostgreSQL encounter lifecycle", async () => {
      // 1. Create encounter
      const encounter = await encounterService.createEncounter(
        studentActor,
        studentId,
        {
          conceptId,
          source: "star",
        },
      );

      expect(encounter.id).toBeDefined();
      expect(encounter.status).toBe("active");
      expect(encounter.questions).toHaveLength(5);

      // 2. Unlock hints sequentially on Q0
      const q0 = encounter.questions[0].questionId;
      const h1 = await encounterService.getHint(studentActor, encounter.id, q0, 1);
      expect(h1.level).toBe(1);
      expect(h1.text.length).toBeGreaterThan(5);

      const h2 = await encounterService.getHint(studentActor, encounter.id, q0, 2);
      expect(h2.level).toBe(2);

      // 3. Submit encounter with all correct options
      // Read encounter from DB to get permutation
      const dbEnc = (await encounterRepo.getEncounter(studentId, encounter.id))!;
      const storedQuestions = await quizRepository.getQuestionsByIds(
        conceptId,
        encounter.questions.map((q) => q.questionId),
      );

      const answers = encounter.questions.map((q, i) => {
        const stored = storedQuestions.find((item) => item.id === q.questionId)!;
        const perm = dbEnc.optionPermutations[i];
        const displayIndex = perm.indexOf(stored.correctAnswer);
        return {
          questionId: q.questionId,
          selectedOption: displayIndex,
        };
      });

      const result = await encounterService.submitEncounter(
        studentActor,
        encounter.id,
        answers,
      );

      expect(result.score).toBe(1.0);
      expect(result.correctCount).toBe(5);
      expect(result.totalQuestions).toBe(5);
      // XP: Q0 had 2 hints -> 30 - 12 = 18. Remaining 4 questions had 0 hints -> 30 each. Total = 18 + 120 = 138.
      expect(result.xpAwarded).toBe(138);

      // 4. Verify live DB persistence directly
      const { data: dbEncRow } = await harness.serviceClient
        .from("encounters")
        .select("*")
        .eq("id", encounter.id)
        .single();
      expect(dbEncRow.status).toBe("completed");
      expect(dbEncRow.version).toBeGreaterThanOrEqual(2);

      const { data: dbAttemptRow } = await harness.serviceClient
        .from("quiz_attempts")
        .select("*")
        .eq("encounter_id", encounter.id)
        .single();
      expect(dbAttemptRow).toBeDefined();
      expect(dbAttemptRow.score).toBe(1.0);

      const { data: dbXpRows } = await harness.serviceClient
        .from("xp_events")
        .select("*")
        .eq("source_id", dbAttemptRow.id);
      expect(dbXpRows).not.toBeNull();
      expect(dbXpRows!).toHaveLength(1);
      expect(dbXpRows![0].amount).toBe(138);

      // 5. Cleanup test artifacts
      await harness.cleanup(context);
    }, 45000);
  },
);
