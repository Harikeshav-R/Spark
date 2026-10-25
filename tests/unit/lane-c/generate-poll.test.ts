import { describe, it, expect, vi } from "vitest";
import { generatedPollQuestionSchema } from "../../../src/contracts/ai.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import { DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  GeneratePollAi,
  fixturePollQuestion,
} from "../../../src/server/ai/index.js";

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

describe("P4-C-01: GeneratePollAi Pipeline", () => {
  const gradientDescentConcept: ConceptNode = {
    id: "33333333-3333-4333-8333-333333333317",
    courseId: "11111111-1111-4111-8111-111111111111",
    label: "Gradient Descent",
    description: "Minimize loss by taking parameter steps opposite the gradient.",
    category: "Optimization",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  };

  const sampleTranscript =
    "A large learning rate can overshoot the minimum and cause oscillation or divergence.";

  describe("1. CP-P4-C-01 Deterministic Fixture & Offline Operation", () => {
    it("generates an open-ended learning-rate question and rubric offline conforming to schema", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected network call in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const generator = new GeneratePollAi(client);

      const result = await generator.generatePollQuestion(
        gradientDescentConcept,
        sampleTranscript
      );

      expect(offlineFetch).not.toHaveBeenCalled();

      const parsed = generatedPollQuestionSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      expect(result.question).toMatch(/learning rate/i);
      expect(result.question.length).toBeGreaterThanOrEqual(15);
      expect(result.question.length).toBeLessThanOrEqual(500);

      expect(result.expectedAnswer).toMatch(/overshoot|oscillat|diverg/i);
      expect(result.expectedAnswer.length).toBeGreaterThanOrEqual(15);
      expect(result.expectedAnswer.length).toBeLessThanOrEqual(1000);
    });

    it("fixturePollQuestion returns a fresh valid object", () => {
      const first = fixturePollQuestion();
      const second = fixturePollQuestion();

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(generatedPollQuestionSchema.safeParse(first).success).toBe(true);
    });

    it("generates valid question even when recentTranscript is empty", async () => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
      });
      const generator = new GeneratePollAi(client);

      const result = await generator.generatePollQuestion(
        gradientDescentConcept,
        ""
      );

      expect(generatedPollQuestionSchema.safeParse(result).success).toBe(true);
    });
  });

  describe("2. Malformed Output & Schema Boundaries (No Live Fallback)", () => {
    it("rejects malformed JSON with 502 BAD_GATEWAY without fallback to fixture", async () => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: (async () =>
          createMockResponse("{broken json string")) as unknown as typeof globalThis.fetch,
      });
      const generator = new GeneratePollAi(client);

      await expect(
        generator.generatePollQuestion(gradientDescentConcept, sampleTranscript)
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it.each([
      {
        description: "missing expectedAnswer",
        payload: { question: "What happens when the learning rate is too large?" },
      },
      {
        description: "missing question",
        payload: { expectedAnswer: "The parameters oscillate and overshoot." },
      },
      {
        description: "question too short (<15 chars, 14 chars)",
        payload: {
          question: "Q".repeat(14),
          expectedAnswer: "Valid expected answer with enough characters.",
        },
      },
      {
        description: "question too long (>500 chars)",
        payload: {
          question: "Q".repeat(501),
          expectedAnswer: "Valid expected answer with enough characters.",
        },
      },
      {
        description: "expectedAnswer too short (<15 chars)",
        payload: {
          question: "What happens when learning rate is excessively large?",
          expectedAnswer: "Too short.",
        },
      },
      {
        description: "expectedAnswer too long (>1000 chars)",
        payload: {
          question: "What happens when learning rate is excessively large?",
          expectedAnswer: "A".repeat(1001),
        },
      },
      {
        description: "question wrong type (number)",
        payload: {
          question: 123456789012345,
          expectedAnswer: "Valid expected answer with enough characters.",
        },
      },
    ])(
      "rejects schema invalid response with 502 BAD_GATEWAY ($description)",
      async ({ payload }) => {
        const client = new OpenRouterClient({
          env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
          fetch: (async () =>
            createMockResponse(JSON.stringify(payload))) as unknown as typeof globalThis.fetch,
        });
        const generator = new GeneratePollAi(client);

        await expect(
          generator.generatePollQuestion(gradientDescentConcept, sampleTranscript)
        ).rejects.toMatchObject({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
        });
      }
    );

    it.each([
      {
        description: "minimum boundary lengths (15 chars question, 15 chars answer)",
        payload: {
          question: "A".repeat(15),
          expectedAnswer: "B".repeat(15),
        },
      },
      {
        description: "maximum boundary lengths (500 chars question, 1000 chars answer)",
        payload: {
          question: "A".repeat(500),
          expectedAnswer: "B".repeat(1000),
        },
      },
    ])("accepts exact schema boundary lengths ($description)", async ({ payload }) => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: (async () =>
          createMockResponse(JSON.stringify(payload))) as unknown as typeof globalThis.fetch,
      });
      const generator = new GeneratePollAi(client);

      const result = await generator.generatePollQuestion(
        gradientDescentConcept,
        sampleTranscript
      );

      expect(result).toEqual(payload);
    });
  });

  describe("3. Deadline & Provider Error Propagation", () => {
    it("propagates missing live credentials as 503 SERVICE_UNAVAILABLE", () => {
      expect(() => {
        new OpenRouterClient({
          env: { INTEGRATION_MODE: "live" },
        });
      }).toThrowError(
        expect.objectContaining({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
        })
      );
    });

    it("propagates 15-second deadline timeout (504 GATEWAY_TIMEOUT)", async () => {
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
      const generator = new GeneratePollAi(client);

      vi.useFakeTimers();
      try {
        const assertion = expect(
          generator.generatePollQuestion(gradientDescentConcept, sampleTranscript)
        ).rejects.toMatchObject({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
        });

        await vi.advanceTimersByTimeAsync(15100);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
