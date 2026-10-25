import { describe, it, expect, vi } from "vitest";
import { evaluatedPollResponseSchema } from "../../../src/contracts/ai.js";
import { DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  EvaluatePollAi,
  fixturePollEvaluation,
} from "../../../src/server/ai/index.js";
import { createMockResponse } from "./helpers/openrouter-response.js";


describe("P4-C-02: EvaluatePollAi Pipeline", () => {
  const sampleQuestion =
    "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?";
  const sampleExpectedAnswer =
    "An excessively large learning rate causes the parameters to overshoot the local minimum, oscillate wildly, or diverge.";

  describe("1. CP-P4-C-02 Deterministic Fixture & Offline Operation", () => {
    it("evaluates correct reasoning answer offline conforming to schema", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected network call in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      const studentAnswer = "The parameters will overshoot the minimum and diverge.";
      const result = await evaluator.evaluatePollResponse(
        sampleQuestion,
        sampleExpectedAnswer,
        studentAnswer
      );

      expect(offlineFetch).not.toHaveBeenCalled();

      const parsed = evaluatedPollResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.outcome).toBe("correct");
      expect(result.feedback.length).toBeGreaterThanOrEqual(5);
      expect(result.feedback.length).toBeLessThanOrEqual(500);
      expect(result.feedback).toMatch(/divergence|destabilize/i);
    });

    it("evaluates partially correct reasoning answer offline conforming to schema", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected network call in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      const studentAnswer = "It will jump too fast.";
      const result = await evaluator.evaluatePollResponse(
        sampleQuestion,
        sampleExpectedAnswer,
        studentAnswer
      );

      expect(offlineFetch).not.toHaveBeenCalled();

      const parsed = evaluatedPollResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.outcome).toBe("partial");
      expect(result.feedback.length).toBeGreaterThanOrEqual(5);
      expect(result.feedback.length).toBeLessThanOrEqual(500);
      expect(result.feedback).toMatch(/partially correct|overshoot/i);
    });

    it("evaluates fundamentally wrong answer offline conforming to schema", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected network call in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      const studentAnswer = "It makes inference run instantly.";
      const result = await evaluator.evaluatePollResponse(
        sampleQuestion,
        sampleExpectedAnswer,
        studentAnswer
      );

      expect(offlineFetch).not.toHaveBeenCalled();

      const parsed = evaluatedPollResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      expect(result.outcome).toBe("wrong");
      expect(result.feedback.length).toBeGreaterThanOrEqual(5);
      expect(result.feedback.length).toBeLessThanOrEqual(500);
      expect(result.feedback).toMatch(/incorrect|divergence|oscillation/i);
    });

    it("evaluates blank and whitespace answers as wrong at boundary offline", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected network call in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      const blankResult = await evaluator.evaluatePollResponse(
        sampleQuestion,
        sampleExpectedAnswer,
        ""
      );
      expect(blankResult.outcome).toBe("wrong");
      expect(evaluatedPollResponseSchema.safeParse(blankResult).success).toBe(true);

      const whitespaceResult = await evaluator.evaluatePollResponse(
        sampleQuestion,
        sampleExpectedAnswer,
        "    \t\n  "
      );
      expect(whitespaceResult.outcome).toBe("wrong");
      expect(evaluatedPollResponseSchema.safeParse(whitespaceResult).success).toBe(true);

      expect(offlineFetch).not.toHaveBeenCalled();
    });

    it("returns freshly constructed objects from standalone fixture function", () => {
      const first = fixturePollEvaluation("overshoot");
      const second = fixturePollEvaluation("overshoot");
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });

  describe("2. Malformed Output & Schema Boundaries (No Live Fallback)", () => {
    it("rejects malformed non-JSON output with 502 BAD_GATEWAY without synthesizing grade", async () => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: (async () =>
          createMockResponse("not valid json at all")) as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      await expect(
        evaluator.evaluatePollResponse(sampleQuestion, sampleExpectedAnswer, "student response")
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it.each([
      {
        description: "unknown outcome value 'pass'",
        payload: {
          outcome: "pass",
          feedback: "Great job on explaining the concept thoroughly.",
        },
      },
      {
        description: "missing feedback field",
        payload: {
          outcome: "correct",
        },
      },
      {
        description: "feedback string below minimum length (4 characters)",
        payload: {
          outcome: "correct",
          feedback: "Good",
        },
      },
      {
        description: "feedback string above maximum length (501 characters)",
        payload: {
          outcome: "correct",
          feedback: "A".repeat(501),
        },
      },
    ])("rejects invalid schema content ($description) with 502 BAD_GATEWAY", async ({ payload }) => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: (async () =>
          createMockResponse(JSON.stringify(payload))) as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      await expect(
        evaluator.evaluatePollResponse(sampleQuestion, sampleExpectedAnswer, "student response")
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it.each([
      {
        description: "minimum feedback length boundary (5 characters)",
        payload: {
          outcome: "partial" as const,
          feedback: "Valid",
        },
      },
      {
        description: "maximum feedback length boundary (500 characters)",
        payload: {
          outcome: "correct" as const,
          feedback: "B".repeat(500),
        },
      },
    ])("accepts exact schema boundary lengths ($description)", async ({ payload }) => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: (async () =>
          createMockResponse(JSON.stringify(payload))) as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      const result = await evaluator.evaluatePollResponse(
        sampleQuestion,
        sampleExpectedAnswer,
        "student response"
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

    it("enforces 8000ms deadline timeout (504 GATEWAY_TIMEOUT)", async () => {
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
      const evaluator = new EvaluatePollAi(client);

      vi.useFakeTimers();
      try {
        let settled = false;
        const evaluationPromise = evaluator.evaluatePollResponse(
          sampleQuestion,
          sampleExpectedAnswer,
          "The parameters jump too fast."
        );
        evaluationPromise
          .catch(() => {})
          .finally(() => {
            settled = true;
          });

        // Remains pending at 7999ms
        await vi.advanceTimersByTimeAsync(7999);
        expect(settled).toBe(false);

        // Rejects at 8000ms deadline
        await vi.advanceTimersByTimeAsync(1);
        await expect(evaluationPromise).rejects.toMatchObject({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
        });
        expect(settled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("propagates 429 rate limit response as 502 BAD_GATEWAY", async () => {
      const rateLimitFetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: "Rate limit exceeded. Please try again later.",
              type: "rate_limit",
              code: "rate_limit_exceeded",
            },
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: rateLimitFetch as unknown as typeof globalThis.fetch,
      });
      const evaluator = new EvaluatePollAi(client);

      await expect(
        evaluator.evaluatePollResponse(sampleQuestion, sampleExpectedAnswer, "student response")
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });
  });
});
