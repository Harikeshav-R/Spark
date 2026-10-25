import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OpenRouterClient,
  GenerateQuizAi,
  fixtureGenerateQuizQuestions,
  FIXTURE_33_CONCEPTS,
} from "../../../src/server/ai/index.js";
import {
  QuizRepository,
  type QuizRepositoryPort,
  type QuizAttemptRecord,
  type QuizDatabaseClientPort,
} from "../../../src/server/learning/quiz-repository.js";
import { QuizService } from "../../../src/server/learning/quiz-service.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import type { ActorContext, UUID } from "../../../src/contracts/common.js";
import type {
  ConceptQuizQuestion,
  SubmitQuizAnswer,
} from "../../../src/contracts/learning.js";
import type { GeneratedQuizQuestion } from "../../../src/contracts/ai.js";
import { DomainErrorCode, AppError } from "../../../src/contracts/errors.js";
import type { LearningEvidenceResult } from "../../../src/server/core/index.js";
import { applyMasteryEvidence } from "../../../src/contracts/mastery.js";
const TEST_COURSE_ID = "11111111-1111-4111-8111-111111111111" as UUID;
const TEST_STUDENT_ID = "22222222-2222-4222-8222-222222222222" as UUID;
const TEST_USER_ID = "33333333-3333-4333-8333-333333333333" as UUID;
const TEST_AUTH_ID = "44444444-4444-4444-8444-444444444444" as UUID;

function createStudentActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    userId: TEST_USER_ID,
    authId: TEST_AUTH_ID,
    email: "student@test.edu",
    name: "Test Student",
    role: "student",
    enrolledCourses: [
      {
        studentId: TEST_STUDENT_ID,
        courseId: TEST_COURSE_ID,
      },
    ],
    ...overrides,
  };
}

function createMockResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

class InMemoryQuizRepository implements QuizRepositoryPort {
  private questionsByConcept = new Map<UUID, ConceptQuizQuestion[]>();
  public attempts: (QuizAttemptRecord & {
    submittedAnswers: { questionId: UUID; selectedOption: number; correct: boolean }[];
  })[] = [];

  async getQuestions(conceptId: UUID): Promise<ConceptQuizQuestion[]> {
    const list = this.questionsByConcept.get(conceptId) ?? [];
    return [...list.slice(0, 5)];
  }

  async insertQuestions(conceptId: UUID, questions: GeneratedQuizQuestion[]): Promise<void> {
    const existing = this.questionsByConcept.get(conceptId) ?? [];
    const inserted: ConceptQuizQuestion[] = questions.map((q, idx) => ({
      id: `aaaaaaaa-0000-4000-8000-${String(existing.length + idx + 1).padStart(12, "0")}` as UUID,
      conceptId,
      question: q.question,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      questionOrder: idx,
      createdAt: new Date().toISOString(),
    }));
    this.questionsByConcept.set(conceptId, [...existing, ...inserted]);
  }

  async getQuestionsByIds(conceptId: UUID, questionIds: UUID[]): Promise<ConceptQuizQuestion[]> {
    const list = this.questionsByConcept.get(conceptId) ?? [];
    const set = new Set(questionIds);
    return list.filter((q) => set.has(q.id));
  }

  async insertAttempt(input: {
    studentId: UUID;
    conceptId: UUID;
    score: number;
    correctCount: number;
    totalQuestions: 5;
    submittedAnswers: { questionId: UUID; selectedOption: number; correct: boolean }[];
  }): Promise<QuizAttemptRecord> {
    const record: QuizAttemptRecord & {
      submittedAnswers: { questionId: UUID; selectedOption: number; correct: boolean }[];
    } = {
      id: `bbbbbbbb-0000-4000-8000-${String(this.attempts.length + 1).padStart(12, "0")}` as UUID,
      studentId: input.studentId,
      conceptId: input.conceptId,
      score: input.score,
      correctCount: input.correctCount,
      totalQuestions: 5,
      submittedAnswers: input.submittedAnswers,
      submittedAt: new Date().toISOString(),
    };
    this.attempts.push(record);
    return {
      id: record.id,
      studentId: record.studentId,
      conceptId: record.conceptId,
      score: record.score,
      correctCount: record.correctCount,
      totalQuestions: 5,
      submittedAt: record.submittedAt,
    };
  }

  // Helper for test setup
  seedQuestions(conceptId: UUID, questions: ConceptQuizQuestion[]): void {
    this.questionsByConcept.set(conceptId, [...questions]);
  }
}

class StatefulEvidenceService {
  public confidence: number;
  public attemptsCount: number;
  public calls: { actor: ActorContext; courseId: UUID; attemptId: UUID }[] = [];

  constructor(initialConfidence = 0.5, initialAttempts = 2) {
    this.confidence = initialConfidence;
    this.attemptsCount = initialAttempts;
  }

  async applyQuizAttempt(
    actor: ActorContext,
    courseId: UUID,
    attemptId: UUID
  ): Promise<LearningEvidenceResult> {
    this.calls.push({ actor, courseId, attemptId });
    const attempt = statefulRepo.attempts.find((a) => a.id === attemptId);
    if (!attempt) {
      throw new AppError({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Quiz attempt not found for this course",
      });
    }

    const { confidence, band } = applyMasteryEvidence(this.confidence, {
      type: "quiz",
      score: attempt.score,
      sourceId: attemptId,
    });
    this.confidence = confidence;

    return {
      sourceId: attemptId,
      studentId: attempt.studentId,
      conceptId: attempt.conceptId,
      confidence,
      band,
      attempts: this.attemptsCount,
      version: 1,
    };
  }
}

let statefulRepo: InMemoryQuizRepository;
let statefulEvidence: StatefulEvidenceService;

describe("P5-C-03: Practice Quiz Generation and Scoring Engine", () => {
  const gradientDescentConcept: ConceptNode = {
    ...FIXTURE_33_CONCEPTS.find((n) => n.label === "Gradient Descent")!,
    courseId: TEST_COURSE_ID,
  };

  const otherConcept: ConceptNode = {
    id: "99999999-9999-4999-8999-999999999999" as UUID,
    courseId: TEST_COURSE_ID,
    label: "Neural Networks",
    description: "Multi-layer perceptron architecture with forward and backward propagation",
    category: "Deep Learning",
    difficulty: 3,
    createdAt: new Date().toISOString(),
  };
  const mockTopology = {
    getTopology: vi.fn().mockImplementation(async (_actor, courseId) => ({
      courseId,
      nodes: [gradientDescentConcept, otherConcept],
      edges: [],
    })),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    statefulRepo = new InMemoryQuizRepository();
    statefulEvidence = new StatefulEvidenceService(0.5, 2);
  });

  describe("1. AI Pipeline & Fixture Generation", () => {
    it("generates 5 valid questions with 4 options in fixture mode without network calls", async () => {
      const fetchSpy = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateQuizAi(client);

      const questions = await pipeline.generateQuizQuestions(gradientDescentConcept);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(questions).toHaveLength(5);

      for (const q of questions) {
        expect(q.question.length).toBeGreaterThanOrEqual(10);
        expect(q.optionA.length).toBeGreaterThanOrEqual(1);
        expect(q.optionB.length).toBeGreaterThanOrEqual(1);
        expect(q.optionC.length).toBeGreaterThanOrEqual(1);
        expect(q.optionD.length).toBeGreaterThanOrEqual(1);
        expect(q.correctAnswer).toBeGreaterThanOrEqual(0);
        expect(q.correctAnswer).toBeLessThanOrEqual(3);
        expect(q.explanation.length).toBeGreaterThanOrEqual(10);
      }

      // Canonical Gradient Descent answer keys
      expect(questions.map((q) => q.correctAnswer)).toEqual([1, 2, 0, 2, 1]);
    });

    it("generates deterministic questions for non-Gradient-Descent concepts satisfying schema", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const pipeline = new GenerateQuizAi(client);

      const questions = await pipeline.generateQuizQuestions(otherConcept);

      expect(questions).toHaveLength(5);
      expect(questions[0].question).toContain("Neural Networks");
      expect(questions.map((q) => q.correctAnswer)).toEqual([1, 2, 0, 2, 1]);
    });

    it("rejects invalid concept input with 400 VALIDATION_ERROR before network", async () => {
      const fetchSpy = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateQuizAi(client);

      const malformedConcept = { ...gradientDescentConcept, label: "" };
      await expect(pipeline.generateQuizQuestions(malformedConcept as ConceptNode)).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid quiz generation input",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects live response with fewer than 5 questions with 502 BAD_GATEWAY", async () => {
      const payload = JSON.stringify({
        questions: [
          {
            question: "Question 1 test content?",
            optionA: "A",
            optionB: "B",
            optionC: "C",
            optionD: "D",
            correctAnswer: 0,
            explanation: "Explanation text here.",
          },
        ],
      });
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(payload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateQuizAi(client);

      await expect(pipeline.generateQuizQuestions(gradientDescentConcept)).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("rejects live response with invalid correctAnswer index (>3) with 502 BAD_GATEWAY", async () => {
      const fixtureQuestions = fixtureGenerateQuizQuestions(gradientDescentConcept).questions;
      const invalidQuestions = fixtureQuestions.map((q, i) =>
        i === 0 ? { ...q, correctAnswer: 4 } : q
      );
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(JSON.stringify({ questions: invalidQuestions })));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateQuizAi(client);

      await expect(pipeline.generateQuizQuestions(gradientDescentConcept)).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("throws 503 SERVICE_UNAVAILABLE when live credentials are missing with no fixture fallback", () => {
      expect(() => {
        new OpenRouterClient({
          env: { INTEGRATION_MODE: "live" },
        });
      }).toThrow(
        expect.objectContaining({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
        })
      );
    });

    it("enforces 60,000ms deadline timeout (504 GATEWAY_TIMEOUT)", async () => {
      const customFetch = vi.fn().mockImplementation((_url, init) => {
        const { promise, reject } = Promise.withResolvers<Response>();
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener("abort", () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
        return promise;
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateQuizAi(client);

      vi.useFakeTimers();
      try {
        let settled = false;
        let caughtError: unknown;
        const quizPromise = pipeline.generateQuizQuestions(gradientDescentConcept);
        quizPromise
          .catch((err) => {
            caughtError = err;
          })
          .finally(() => {
            settled = true;
          });

        await vi.advanceTimersByTimeAsync(59999);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(quizPromise).rejects.toMatchObject({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
        });
        expect(settled).toBe(true);
        expect(caughtError).toMatchObject({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("2. Quiz Retrieval & Information Hiding (getQuiz)", () => {
    function createService(repo: QuizRepositoryPort = statefulRepo): QuizService {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ai = new GenerateQuizAi(client);
      return new QuizService({
        courseId: TEST_COURSE_ID,
        topology: mockTopology,
        repository: repo,
        ai,
        evidence: statefulEvidence,
      });
    }

    it("generates and stores questions on empty bank, and reuses them on second fetch with stable IDs", async () => {
      const service = createService();
      const actor = createStudentActor();

      const questionsFirst = await service.getQuiz(actor, gradientDescentConcept.id);
      expect(questionsFirst).toHaveLength(5);

      const storedInRepo = await statefulRepo.getQuestions(gradientDescentConcept.id);
      expect(storedInRepo).toHaveLength(5);

      const questionsSecond = await service.getQuiz(actor, gradientDescentConcept.id);
      expect(questionsSecond).toHaveLength(5);

      // Verify same question IDs across fetches
      expect(questionsFirst.map((q) => q.id)).toEqual(questionsSecond.map((q) => q.id));
      expect(questionsFirst.map((q) => q.id)).toEqual(storedInRepo.map((q) => q.id));
    });

    it("returns ONLY public fields and strips correctAnswer, explanation, and hints", async () => {
      const service = createService();
      const actor = createStudentActor();

      const questions = await service.getQuiz(actor, gradientDescentConcept.id);
      expect(questions).toHaveLength(5);

      for (const q of questions) {
        // Assert exact keys on public DTO
        const keys = Object.keys(q).sort();
        expect(keys).toEqual(["id", "options", "question", "questionOrder"]);
        expect(q.options).toHaveLength(4);

        // Explicitly assert private fields are undefined
        const rawQuestion = q as Record<string, unknown>;
        expect(rawQuestion.correctAnswer).toBeUndefined();
        expect(rawQuestion.correct_answer).toBeUndefined();
        expect(rawQuestion.explanation).toBeUndefined();
        expect(rawQuestion.hints).toBeUndefined();
        // JSON serialization verification
        const serialized = JSON.stringify(q);
        expect(serialized).not.toContain("correctAnswer");
        expect(serialized).not.toContain("correct_answer");
        expect(serialized).not.toContain("explanation");
      }
    });

    it("throws 500 INTERNAL_SERVER_ERROR if stored question bank is incomplete (<5 questions)", async () => {
      const incompleteQuestions = fixtureGenerateQuizQuestions(gradientDescentConcept)
        .questions.slice(0, 3)
        .map((q, idx) => ({
          id: `cccccccc-0000-4000-8000-${String(idx + 1).padStart(12, "0")}` as UUID,
          conceptId: gradientDescentConcept.id,
          question: q.question,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          questionOrder: idx,
          createdAt: new Date().toISOString(),
        }));

      statefulRepo.seedQuestions(gradientDescentConcept.id, incompleteQuestions);
      const service = createService();
      const actor = createStudentActor();

      await expect(service.getQuiz(actor, gradientDescentConcept.id)).rejects.toMatchObject({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Quiz question bank is incomplete",
      });
    });

    it("rejects non-student actor with 403 FORBIDDEN", async () => {
      const service = createService();
      const teacherActor = createStudentActor({ role: "teacher", teacherId: TEST_USER_ID });

      await expect(service.getQuiz(teacherActor, gradientDescentConcept.id)).rejects.toMatchObject({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Quiz access requires the enrolled student",
      });
    });

    it("rejects unenrolled student actor with 403 FORBIDDEN", async () => {
      const service = createService();
      const unenrolledActor = createStudentActor({ enrolledCourses: [] });

      await expect(service.getQuiz(unenrolledActor, gradientDescentConcept.id)).rejects.toMatchObject({
        code: DomainErrorCode.FORBIDDEN,
        statusCode: 403,
        message: "Quiz access requires the enrolled student",
      });
    });

    it("rejects concept not found in authorized course with 404 NOT_FOUND", async () => {
      const service = createService();
      const actor = createStudentActor();
      const unknownConceptId = "00000000-0000-4000-8000-000000000000" as UUID;

      await expect(service.getQuiz(actor, unknownConceptId)).rejects.toMatchObject({
        code: DomainErrorCode.NOT_FOUND,
        statusCode: 404,
        message: "Concept not found in authorized course",
      });
    });
  });

  describe("3. Quiz Submission & Server-Side Grading (submitQuiz)", () => {
    function createService(): QuizService {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const ai = new GenerateQuizAi(client);
      return new QuizService({
        courseId: TEST_COURSE_ID,
        topology: mockTopology,
        repository: statefulRepo,
        ai,
        evidence: statefulEvidence,
      });
    }

    it("CP-P5-C-03: grades 4/5 correct to score 0.80 and +0.15 delta with yellow band and unchanged poll attempts", async () => {
      const service = createService();
      const actor = createStudentActor();

      // Ensure questions exist
      await service.getQuiz(actor, gradientDescentConcept.id);
      const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);
      // Stored keys: [1, 2, 0, 2, 1]
      // Submit selections: [1, 2, 0, 2, 0] (last one wrong)
      const answers: SubmitQuizAnswer[] = storedQuestions.map((q, idx) => ({
        questionId: q.id,
        selectedOption: idx === 4 ? (q.correctAnswer === 0 ? 1 : 0) : q.correctAnswer,
      }));

      // Set initial confidence 0.50
      statefulEvidence.confidence = 0.50;
      statefulEvidence.attemptsCount = 3;

      const result = await service.submitQuiz(
        actor,
        TEST_STUDENT_ID,
        gradientDescentConcept.id,
        answers
      );

      expect(result.score).toBe(0.8);
      expect(result.correctCount).toBe(4);
      expect(result.totalQuestions).toBe(5);
      expect(result.newConfidence).toBe(0.65);
      expect(result.newBand).toBe("yellow");

      // Verify attempts count in evidence service remained unchanged (poll attempts untouched)
      expect(statefulEvidence.attemptsCount).toBe(3);

      // Verify persisted attempt in repository
      expect(statefulRepo.attempts).toHaveLength(1);
      const savedAttempt = statefulRepo.attempts[0];
      expect(savedAttempt.score).toBe(0.8);
      expect(savedAttempt.correctCount).toBe(4);
      expect(savedAttempt.totalQuestions).toBe(5);
      expect(savedAttempt.studentId).toBe(TEST_STUDENT_ID);
      expect(savedAttempt.conceptId).toBe(gradientDescentConcept.id);

      // Verify evidence call arguments
      expect(statefulEvidence.calls).toHaveLength(1);
      expect(statefulEvidence.calls[0].attemptId).toBe(savedAttempt.id);
      expect(statefulEvidence.calls[0].courseId).toBe(TEST_COURSE_ID);
    });

    it("grades by questionId correctly even when submission order is shuffled", async () => {
      const service = createService();
      const actor = createStudentActor();

      await service.getQuiz(actor, gradientDescentConcept.id);
      const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);

      // Shuffle order: 3, 0, 4, 1, 2
      const shuffled = [
        storedQuestions[3],
        storedQuestions[0],
        storedQuestions[4],
        storedQuestions[1],
        storedQuestions[2],
      ];

      // Provide correct answer for all except question 2
      const answers: SubmitQuizAnswer[] = shuffled.map((q) => ({
        questionId: q.id,
        selectedOption: q.id === storedQuestions[2].id ? (q.correctAnswer + 1) % 4 : q.correctAnswer,
      }));

      const result = await service.submitQuiz(
        actor,
        TEST_STUDENT_ID,
        gradientDescentConcept.id,
        answers
      );

      expect(result.score).toBe(0.8);
      expect(result.correctCount).toBe(4);
    });

    it("handles partial submission: 4 answers submitted correctly counts 4/5 = 0.80", async () => {
      const service = createService();
      const actor = createStudentActor();

      await service.getQuiz(actor, gradientDescentConcept.id);
      const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);

      // Submit only 4 questions (omitting 5th)
      const answers: SubmitQuizAnswer[] = storedQuestions.slice(0, 4).map((q) => ({
        questionId: q.id,
        selectedOption: q.correctAnswer,
      }));

      const result = await service.submitQuiz(
        actor,
        TEST_STUDENT_ID,
        gradientDescentConcept.id,
        answers
      );

      // 4 correct out of 5 total = 0.8
      expect(result.score).toBe(0.8);
      expect(result.correctCount).toBe(4);
      expect(result.totalQuestions).toBe(5);
    });

    it("verifies mastery delta tiers: 5/5 (+0.15), 3/5 (+0.10), 2/5 (+0.05), 0/5 (+0.02)", async () => {
      const service = createService();
      const actor = createStudentActor();

      await service.getQuiz(actor, gradientDescentConcept.id);
      const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);

      const runScoreTest = async (correctTarget: number, initialConfidence: number) => {
        statefulEvidence.confidence = initialConfidence;
        const answers: SubmitQuizAnswer[] = storedQuestions.map((q, idx) => ({
          questionId: q.id,
          selectedOption: idx < correctTarget ? q.correctAnswer : (q.correctAnswer + 1) % 4,
        }));

        const result = await service.submitQuiz(
          actor,
          TEST_STUDENT_ID,
          gradientDescentConcept.id,
          answers
        );
        return result.newConfidence;
      };

      // 5/5 -> delta +0.15 (0.30 -> 0.45)
      const conf5 = await runScoreTest(5, 0.30);
      expect(conf5).toBe(0.45);

      // 3/5 -> delta +0.10 (0.30 -> 0.40)
      const conf3 = await runScoreTest(3, 0.30);
      expect(conf3).toBe(0.40);

      // 2/5 -> delta +0.05 (0.30 -> 0.35)
      const conf2 = await runScoreTest(2, 0.30);
      expect(conf2).toBe(0.35);

      // 0/5 -> delta +0.02 (0.30 -> 0.32)
      const conf0 = await runScoreTest(0, 0.30);
      expect(conf0).toBe(0.32);
    });

    it("clamps mastery confidence to 1.0 / green when confidence exceeds ceiling", async () => {
      const service = createService();
      const actor = createStudentActor();

      await service.getQuiz(actor, gradientDescentConcept.id);
      const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);

      statefulEvidence.confidence = 0.95;
      const answers: SubmitQuizAnswer[] = storedQuestions.map((q) => ({
        questionId: q.id,
        selectedOption: q.correctAnswer,
      }));

      const result = await service.submitQuiz(
        actor,
        TEST_STUDENT_ID,
        gradientDescentConcept.id,
        answers
      );

      expect(result.newConfidence).toBe(1.0);
      expect(result.newBand).toBe("green");
    });

    describe("Submission Validation & Security Rejections", () => {
      it("rejects empty answers array with 400 VALIDATION_ERROR", async () => {
        const service = createService();
        const actor = createStudentActor();

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, [])
        ).rejects.toMatchObject({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz submission",
        });
      });

      it("rejects more than 5 answers with 400 VALIDATION_ERROR", async () => {
        const service = createService();
        const actor = createStudentActor();

        const answers: SubmitQuizAnswer[] = Array.from({ length: 6 }, (_, i) => ({
          questionId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as UUID,
          selectedOption: 0,
        }));

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, answers)
        ).rejects.toMatchObject({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz submission",
        });
      });

      it("rejects duplicate question IDs with 400 VALIDATION_ERROR", async () => {
        const service = createService();
        const actor = createStudentActor();
        const qid = "aaaaaaaa-0000-4000-8000-000000000001" as UUID;

        const answers: SubmitQuizAnswer[] = [
          { questionId: qid, selectedOption: 0 },
          { questionId: qid, selectedOption: 1 },
        ];

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, answers)
        ).rejects.toMatchObject({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz submission",
        });
      });

      it("rejects out-of-range option indices (-1, 4, 1.5) with 400 VALIDATION_ERROR", async () => {
        const service = createService();
        const actor = createStudentActor();
        const qid = "aaaaaaaa-0000-4000-8000-000000000001" as UUID;

        for (const badOpt of [-1, 4, 1.5]) {
          await expect(
            service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, [
              { questionId: qid, selectedOption: badOpt as number },
            ])
          ).rejects.toMatchObject({
            code: DomainErrorCode.VALIDATION_ERROR,
            statusCode: 400,
            message: "Invalid quiz submission",
          });
        }
      });

      it("rejects malicious extra fields on answer objects with 400 VALIDATION_ERROR", async () => {
        const service = createService();
        const actor = createStudentActor();
        const qid = "aaaaaaaa-0000-4000-8000-000000000001" as UUID;

        const forgedAnswer = {
          questionId: qid,
          selectedOption: 0,
          correct: true,
          score: 1.0,
        };

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, [
            forgedAnswer as unknown as SubmitQuizAnswer,
          ])
        ).rejects.toMatchObject({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz submission",
        });
      });

      it("rejects unknown question ID with 400 VALIDATION_ERROR before writes", async () => {
        const service = createService();
        const actor = createStudentActor();
        const unknownQid = "ffffffff-ffff-4fff-8fff-ffffffffffff" as UUID;

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, [
            { questionId: unknownQid, selectedOption: 0 },
          ])
        ).rejects.toMatchObject({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz submission",
        });

        // No attempt persisted
        expect(statefulRepo.attempts).toHaveLength(0);
      });

      it("rejects question ID belonging to another concept with 400 VALIDATION_ERROR", async () => {
        const service = createService();
        const actor = createStudentActor();

        // Seed questions for other concept
        await service.getQuiz(actor, otherConcept.id);
        const otherQuestions = await statefulRepo.getQuestions(otherConcept.id);

        // Submit answer for other concept question under gradient descent concept
        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, [
            { questionId: otherQuestions[0].id, selectedOption: 0 },
          ])
        ).rejects.toMatchObject({
          code: DomainErrorCode.VALIDATION_ERROR,
          statusCode: 400,
          message: "Invalid quiz submission",
        });
      });

      it("rejects teacher role actor with 403 FORBIDDEN", async () => {
        const service = createService();
        const teacherActor = createStudentActor({ role: "teacher", teacherId: TEST_USER_ID });

        await expect(
          service.submitQuiz(teacherActor, TEST_STUDENT_ID, gradientDescentConcept.id, [
            { questionId: "aaaaaaaa-0000-4000-8000-000000000001" as UUID, selectedOption: 0 },
          ])
        ).rejects.toMatchObject({
          code: DomainErrorCode.FORBIDDEN,
          statusCode: 403,
          message: "Quiz access requires the enrolled student",
        });
      });

      it("rejects mismatched studentId vs enrolled student ID with 403 FORBIDDEN", async () => {
        const service = createService();
        const actor = createStudentActor();
        const foreignStudentId = "99999999-9999-4999-8999-999999999999" as UUID;

        await expect(
          service.submitQuiz(actor, foreignStudentId, gradientDescentConcept.id, [
            { questionId: "aaaaaaaa-0000-4000-8000-000000000001" as UUID, selectedOption: 0 },
          ])
        ).rejects.toMatchObject({
          code: DomainErrorCode.FORBIDDEN,
          statusCode: 403,
          message: "Quiz access requires the enrolled student",
        });
      });
    });

    describe("Atomicity & Error Ordering", () => {
      it("preserves scored attempt if evidence service fails, and propagates the error", async () => {
        const service = createService();
        const actor = createStudentActor();

        await service.getQuiz(actor, gradientDescentConcept.id);
        const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);

        // Mock evidence service to throw
        vi.spyOn(statefulEvidence, "applyQuizAttempt").mockRejectedValueOnce(
          new AppError({
            code: DomainErrorCode.INTERNAL_SERVER_ERROR,
            statusCode: 500,
            message: "Mastery evidence calculation failed",
          })
        );

        const answers: SubmitQuizAnswer[] = storedQuestions.map((q) => ({
          questionId: q.id,
          selectedOption: q.correctAnswer,
        }));

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, answers)
        ).rejects.toMatchObject({
          code: DomainErrorCode.INTERNAL_SERVER_ERROR,
          statusCode: 500,
          message: "Mastery evidence calculation failed",
        });

        // The attempt was recorded prior to evidence application
        expect(statefulRepo.attempts).toHaveLength(1);
        expect(statefulRepo.attempts[0].score).toBe(1.0);
      });

      it("never calls evidence service if attempt insertion fails", async () => {
        const service = createService();
        const actor = createStudentActor();

        await service.getQuiz(actor, gradientDescentConcept.id);
        const storedQuestions = await statefulRepo.getQuestions(gradientDescentConcept.id);

        vi.spyOn(statefulRepo, "insertAttempt").mockRejectedValueOnce(
          new AppError({
            code: DomainErrorCode.SERVICE_UNAVAILABLE,
            statusCode: 503,
            message: "Database insertion failure",
          })
        );

        const evidenceSpy = vi.spyOn(statefulEvidence, "applyQuizAttempt");

        const answers: SubmitQuizAnswer[] = storedQuestions.map((q) => ({
          questionId: q.id,
          selectedOption: q.correctAnswer,
        }));

        await expect(
          service.submitQuiz(actor, TEST_STUDENT_ID, gradientDescentConcept.id, answers)
        ).rejects.toMatchObject({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
          message: "Database insertion failure",
        });

        expect(evidenceSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("4. QuizRepository Error Mapping & Invariants", () => {
    it("maps database transport errors to 503 SERVICE_UNAVAILABLE", async () => {
      const mockClient: QuizDatabaseClientPort = {
        from: () => ({
          select: () => {
            throw new Error("Network connection dropped");
          },
          insert: () => {
            throw new Error("Network connection dropped");
          },
        }),
      };

      const repo = new QuizRepository(mockClient);

      await expect(repo.getQuestions(gradientDescentConcept.id)).rejects.toMatchObject({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "Quiz database service unavailable",
      });
    });

    it("maps Postgrest error objects to 500 INTERNAL_SERVER_ERROR", async () => {
      const mockSelectChain = {
        eq: () => mockSelectChain,
        in: () => mockSelectChain,
        order: () => mockSelectChain,
        limit: async () => ({
          data: null,
          error: { code: "42P01", message: "relation does not exist" },
        }),
        then: (onfulfilled?: (val: unknown) => unknown) =>
          Promise.resolve(
            onfulfilled?.({ data: null, error: { code: "42P01", message: "relation does not exist" } })
          ),
      };

      const mockInsertChain = {
        select: () => ({
          single: async () => ({
            data: null,
            error: { message: "disk full" },
          }),
        }),
        then: (onfulfilled?: (val: unknown) => unknown) =>
          Promise.resolve(onfulfilled?.({ data: null, error: { message: "disk full" } })),
      };

      const mockClient = {
        from: () => ({
          select: () => mockSelectChain,
          insert: () => mockInsertChain,
        }),
      } as unknown as QuizDatabaseClientPort;
      const repo = new QuizRepository(mockClient);

      await expect(repo.getQuestions(gradientDescentConcept.id)).rejects.toMatchObject({
        code: DomainErrorCode.INTERNAL_SERVER_ERROR,
        statusCode: 500,
        message: "Database error accessing quiz",
      });
    });
  });
});
