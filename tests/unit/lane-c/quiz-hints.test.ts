import { describe, it, expect, vi } from "vitest";
import {
  OpenRouterClient,
  GenerateQuizHintsAi,
  fixtureGenerateQuizHints,
  FIXTURE_33_CONCEPTS,
} from "../../../src/server/ai/index.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import type { ConceptQuizQuestion } from "../../../src/contracts/learning.js";
import type { UUID } from "../../../src/contracts/common.js";
import { DomainErrorCode, AppError } from "../../../src/contracts/errors.js";

const TEST_CONCEPT: ConceptNode = FIXTURE_33_CONCEPTS[0];

function createSampleQuestions(conceptId: UUID): ConceptQuizQuestion[] {
  return [
    {
      id: "10000000-0000-4000-8000-000000000001" as UUID,
      conceptId,
      question: "What is the primary objective of gradient descent?",
      optionA: "Maximize the loss function",
      optionB: "Minimize the loss function by stepping opposite to gradient",
      optionC: "Compute exact matrix inversions",
      optionD: "Randomly perturb parameters",
      correctAnswer: 1,
      explanation: "Iteratively steps opposite to gradient to minimize loss.",
      questionOrder: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: "10000000-0000-4000-8000-000000000002" as UUID,
      conceptId,
      question: "What happens if the learning rate is too large?",
      optionA: "Faster convergence to optimum",
      optionB: "Loss hits zero immediately",
      optionC: "Parameters overshoot and diverge",
      optionD: "Gradient becomes zero immediately",
      correctAnswer: 2,
      explanation: "Large learning rate overshoots the minimum.",
      questionOrder: 1,
      createdAt: new Date().toISOString(),
    },
    {
      id: "10000000-0000-4000-8000-000000000003" as UUID,
      conceptId,
      question: "How does SGD differ from batch gradient descent?",
      optionA: "SGD updates parameters using a single sample or mini-batch",
      optionB: "SGD does not require derivatives",
      optionC: "SGD only works for convex problems",
      optionD: "SGD computes the exact Hessian matrix",
      correctAnswer: 0,
      explanation: "SGD uses mini-batches or single samples.",
      questionOrder: 2,
      createdAt: new Date().toISOString(),
    },
    {
      id: "10000000-0000-4000-8000-000000000004" as UUID,
      conceptId,
      question: "What does the gradient vector represent geometrically?",
      optionA: "Tangent line parallel to axis",
      optionB: "Curvature of level sets",
      optionC: "Direction of steepest ascent",
      optionD: "Distance to origin",
      correctAnswer: 2,
      explanation: "Points in direction of greatest rate of increase.",
      questionOrder: 3,
      createdAt: new Date().toISOString(),
    },
    {
      id: "10000000-0000-4000-8000-000000000005" as UUID,
      conceptId,
      question: "When does standard gradient descent stop updating?",
      optionA: "When learning rate hits 1.0",
      optionB: "When gradient norm approaches zero",
      optionC: "When batch count reaches 100",
      optionD: "When labels are positive",
      correctAnswer: 1,
      explanation: "Updates vanish when gradient approaches zero.",
      questionOrder: 4,
      createdAt: new Date().toISOString(),
    },
  ];
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
    },
  );
}

describe("GenerateQuizHintsAi", () => {
  it("generates 3-tier hints in fixture mode matching questions and order", async () => {
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const pipeline = new GenerateQuizHintsAi(client);
    const questions = createSampleQuestions(TEST_CONCEPT.id);

    const hints = await pipeline.generateQuizHints(TEST_CONCEPT, questions);

    expect(hints).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(hints[i].questionId).toBe(questions[i].id);
      expect(hints[i].hints).toHaveLength(3);
      for (const hint of hints[i].hints) {
        expect(typeof hint).toBe("string");
        expect(hint.length).toBeGreaterThanOrEqual(5);
        expect(hint.length).toBeLessThanOrEqual(300);
      }
    }
  });

  it("validates input concept and throws 400 on malformed concept", async () => {
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const pipeline = new GenerateQuizHintsAi(client);
    const questions = createSampleQuestions(TEST_CONCEPT.id);

    await expect(
      pipeline.generateQuizHints({ ...TEST_CONCEPT, id: "invalid-uuid" as UUID }, questions),
    ).rejects.toThrow(AppError);

    try {
      await pipeline.generateQuizHints(
        { ...TEST_CONCEPT, id: "invalid-uuid" as UUID },
        questions,
      );
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
      expect(appErr.statusCode).toBe(400);
    }
  });

  it("rejects input questions with wrong count or mismatched conceptId", async () => {
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const pipeline = new GenerateQuizHintsAi(client);
    const questions = createSampleQuestions(TEST_CONCEPT.id);

    // 4 questions
    await expect(
      pipeline.generateQuizHints(TEST_CONCEPT, questions.slice(0, 4)),
    ).rejects.toThrow(AppError);

    // Mismatched concept ID
    const mismatchedQuestions = [
      ...questions.slice(0, 4),
      {
        ...questions[4],
        conceptId: "99999999-9999-4999-8999-999999999999" as UUID,
      },
    ];
    await expect(
      pipeline.generateQuizHints(TEST_CONCEPT, mismatchedQuestions),
    ).rejects.toThrow(AppError);

    // Duplicate question ID
    const duplicateQuestions = [
      questions[0],
      questions[0],
      questions[2],
      questions[3],
      questions[4],
    ];
    await expect(
      pipeline.generateQuizHints(TEST_CONCEPT, duplicateQuestions),
    ).rejects.toThrow(AppError);
  });

  it("handles live AI completion and reorders to match input question order", async () => {
    const questions = createSampleQuestions(TEST_CONCEPT.id);
    // Reverse order in mock response
    const mockOutput = {
      questions: [...questions].reverse().map((q) => ({
        questionId: q.id,
        hints: [
          "First progressive hint for this question.",
          "Second deeper progressive hint for this problem.",
          "Third step-by-step walkthrough hint for this topic.",
        ],
      })),
    };

    const customFetch = vi.fn().mockResolvedValue(createMockResponse(JSON.stringify(mockOutput)));
    const client = new OpenRouterClient({
      env: {
        INTEGRATION_MODE: "live",
        OPENROUTER_API_KEY: "sk-or-v1-test-key",
      },
      fetch: customFetch as unknown as typeof fetch,
    });
    const pipeline = new GenerateQuizHintsAi(client);

    const result = await pipeline.generateQuizHints(TEST_CONCEPT, questions);

    expect(result).toHaveLength(5);
    // Check reordering: first item in result matches first item in input
    expect(result[0].questionId).toBe(questions[0].id);
    expect(result[4].questionId).toBe(questions[4].id);
  });

  it("rejects AI response that leaks explicit option labels with 502 BAD_GATEWAY", async () => {
    const questions = createSampleQuestions(TEST_CONCEPT.id);
    const mockOutput = {
      questions: questions.map((q, idx) => ({
        questionId: q.id,
        hints: [
          idx === 0 ? "You should choose Option B because it is correct." : "Valid hint here.",
          "Second hint here.",
          "Third hint here.",
        ],
      })),
    };

    const customFetch = vi.fn().mockResolvedValue(createMockResponse(JSON.stringify(mockOutput)));
    const client = new OpenRouterClient({
      env: {
        INTEGRATION_MODE: "live",
        OPENROUTER_API_KEY: "sk-or-v1-test-key",
      },
      fetch: customFetch as unknown as typeof fetch,
    });
    const pipeline = new GenerateQuizHintsAi(client);

    await expect(pipeline.generateQuizHints(TEST_CONCEPT, questions)).rejects.toThrow(AppError);
    try {
      await pipeline.generateQuizHints(TEST_CONCEPT, questions);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
      expect(appErr.statusCode).toBe(502);
    }
  });

  it("rejects AI response that leaks full correct answer text with 502 BAD_GATEWAY", async () => {
    const questions = createSampleQuestions(TEST_CONCEPT.id);
    const mockOutput = {
      questions: questions.map((q, idx) => ({
        questionId: q.id,
        hints: [
          idx === 0
            ? "Remember to minimize the loss function by stepping opposite to gradient."
            : "Valid hint here.",
          "Second hint here.",
          "Third hint here.",
        ],
      })),
    };

    const customFetch = vi.fn().mockResolvedValue(createMockResponse(JSON.stringify(mockOutput)));
    const client = new OpenRouterClient({
      env: {
        INTEGRATION_MODE: "live",
        OPENROUTER_API_KEY: "sk-or-v1-test-key",
      },
      fetch: customFetch as unknown as typeof fetch,
    });
    const pipeline = new GenerateQuizHintsAi(client);

    await expect(pipeline.generateQuizHints(TEST_CONCEPT, questions)).rejects.toThrow(AppError);
    try {
      await pipeline.generateQuizHints(TEST_CONCEPT, questions);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
      expect(appErr.statusCode).toBe(502);
    }
  });
  it("throws 503 SERVICE_UNAVAILABLE in live mode when credentials missing", () => {
    expect(() => {
      new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "",
        },
      });
    }).toThrowError(
      expect.objectContaining({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
      }),
    );
  });

  it("produces valid hints using fixtureGenerateQuizHints directly", () => {
    const questions = createSampleQuestions(TEST_CONCEPT.id);
    const fixtureResult = fixtureGenerateQuizHints(TEST_CONCEPT, questions);
    expect(fixtureResult.questions).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(fixtureResult.questions[i].questionId).toBe(questions[i].id);
      expect(fixtureResult.questions[i].hints).toHaveLength(3);
    }
  });
});
