import { describe, it, expect, vi } from "vitest";
import { suggestedInterventionsSchema } from "../../../src/contracts/ai.js";
import { DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  SuggestInterventionsAi,
  fixtureSuggestedInterventions,
} from "../../../src/server/ai/index.js";
import { createMockResponse } from "./helpers/openrouter-response.js";


describe("P4-C-03: SuggestInterventionsAi Pipeline", () => {
  const lectureId = "33333333-3333-4333-8333-333333333333";

  const canonicalResponses = [
    {
      outcome: "correct",
      answer:
        "The backward pass uses cached forward activations to evaluate local derivatives through the chain rule.",
    },
    {
      outcome: "wrong",
      answer:
        "Backpropagation never needs forward activations; only the final output is needed.",
    },
    {
      outcome: "wrong",
      answer:
        "We can discard every intermediate activation before the backward pass because training works like inference.",
    },
    {
      outcome: "partial",
      answer:
        "The chain rule gives gradients, but I do not know why the forward pass stores activations.",
    },
  ];

  describe("1. Deterministic Fixture & Offline Operation", () => {
    it("diagnoses canonical backprop misconceptions and returns 2-3 actionable teaching recommendations", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected network call in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const result = await pipeline.suggestInterventions(
        lectureId,
        canonicalResponses
      );

      expect(offlineFetch).not.toHaveBeenCalled();

      const parsed = suggestedInterventionsSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      expect(result.misconceptions).toHaveLength(1);
      expect(result.misconceptions[0]).toMatch(
        /activation caching|forward-pass|chain-rule|local derivatives/i
      );

      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
      expect(result.recommendations.length).toBeLessThanOrEqual(3);

      const titles = result.recommendations.map((r) => r.title);
      expect(titles).toContain("Diagram activation caching");
      expect(titles).toContain("Contrast training and inference memory");

      const cachingRec = result.recommendations.find(
        (r) => r.title === "Diagram activation caching"
      );
      expect(cachingRec?.description).toMatch(/computational graph/i);
      expect(cachingRec?.actionablePrompt).toMatch(
        /computational graph|dL\/dw/i
      );

      for (const rec of result.recommendations) {
        expect(rec.title.trim().length).toBeGreaterThan(0);
        expect(rec.description.trim().length).toBeGreaterThan(0);
        expect(rec.actionablePrompt.trim().length).toBeGreaterThan(0);
      }
    });

    it("clusters backprop confusion when mixed with correct answers of another concept", async () => {
      const offlineFetch = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const mixedResponses = [
        {
          outcome: "correct",
          answer: "B-trees maintain logarithmic search time via balanced node splits.",
        },
        {
          outcome: "wrong",
          answer: "In the backward pass, activations can be deleted right away.",
        },
      ];

      const result = await pipeline.suggestInterventions(
        lectureId,
        mixedResponses
      );

      expect(result.misconceptions[0]).toMatch(/activation/i);
      expect(result.recommendations[0]?.title).toBe("Diagram activation caching");
    });

    it("grounds non-backprop flawed answers without injecting backprop concepts", async () => {
      const offlineFetch = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const dbResponses = [
        {
          outcome: "correct",
          answer: "Backpropagation uses the chain rule to propagate errors backward.",
        },
        {
          outcome: "wrong",
          answer: "An index always makes every database write faster.",
        },
      ];

      const result = await pipeline.suggestInterventions(lectureId, dbResponses);

      expect(result.misconceptions[0]).toContain(
        "An index always makes every database write faster."
      );
      expect(result.misconceptions[0]).not.toMatch(/backprop|activation/i);
      expect(result.recommendations[0]?.title).toBe("Trace reasoning on board");
      expect(result.recommendations[1]?.title).toBe("Contrasting follow-up check");
    });

    it("handles partial-only evaluations by generating interventions", async () => {
      const offlineFetch = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const partialOnly = [
        {
          outcome: "partial",
          answer:
            "The chain rule gives gradients, but I do not know why the forward pass stores activations.",
        },
      ];

      const result = await pipeline.suggestInterventions(lectureId, partialOnly);

      expect(result.misconceptions.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
    });

    it("handles empty answer text in flawed response fallback", () => {
      const result = fixtureSuggestedInterventions([
        { outcome: "wrong", answer: "   " },
      ]);
      expect(result.misconceptions[0]).toContain("No explanation supplied");
    });
  });

  describe("2. Positive Mastery & Evidence-Aware Empty State Transitions", () => {
    it("confirms strong understanding when all evaluated poll responses are correct without provider call", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Provider should not be called when all responses are correct");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const allCorrect = [
        {
          outcome: "correct",
          answer:
            "Backpropagation caches forward activations to evaluate local partial derivatives in reverse topological order.",
        },
        {
          outcome: "correct",
          answer:
            "Intermediate values are needed for gradient calculation by the chain rule.",
        },
      ];

      const result = await pipeline.suggestInterventions(lectureId, allCorrect);

      expect(offlineFetch).not.toHaveBeenCalled();
      expect(result.misconceptions).toEqual([]);
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0]?.title).toBe(
        "Strong conceptual understanding"
      );
      expect(result.recommendations[0]?.description).toMatch(
        /all evaluated poll responses are correct/i
      );
      expect(result.recommendations[0]?.actionablePrompt).toMatch(
        /affirm the class's understanding/i
      );
    });

    it("returns evidence-aware recommendation when poll responses array is empty without provider call", async () => {
      const offlineFetch = vi.fn().mockImplementation(() => {
        throw new Error("Provider should not be called on empty input");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const result = await pipeline.suggestInterventions(lectureId, []);

      expect(offlineFetch).not.toHaveBeenCalled();
      expect(result.misconceptions).toEqual([]);
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0]?.title).toBe(
        "No evaluated misconceptions yet"
      );
      expect(result.recommendations[0]?.description).toMatch(
        /no incorrect or partial evaluations to analyze/i
      );
      expect(result.recommendations[0]?.actionablePrompt).toMatch(
        /collect and evaluate a concept-check/i
      );
    });

    it("returns evidence-aware notice when responses have non-correct unrated outcomes without claiming mastery", async () => {
      const offlineFetch = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: offlineFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const unratedResponses = [
        { outcome: "unrated", answer: "I answered but grading is pending." },
        { outcome: "skipped", answer: "No response submitted." },
      ];

      const result = await pipeline.suggestInterventions(
        lectureId,
        unratedResponses
      );

      expect(offlineFetch).not.toHaveBeenCalled();
      expect(result.misconceptions).toEqual([]);
      expect(result.recommendations[0]?.title).toBe(
        "No evaluated misconceptions yet"
      );
      expect(result.recommendations[0]?.description).toMatch(
        /does not establish class mastery/i
      );
    });

    it("produces distinct semantic states between mastered and unassessed empty", async () => {
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
      });
      const pipeline = new SuggestInterventionsAi(client);

      const mastered = await pipeline.suggestInterventions(lectureId, [
        { outcome: "correct", answer: "Perfect answer" },
      ]);
      const empty = await pipeline.suggestInterventions(lectureId, []);

      expect(mastered.recommendations[0]?.title).not.toEqual(
        empty.recommendations[0]?.title
      );
      expect(mastered.recommendations[0]?.actionablePrompt).not.toEqual(
        empty.recommendations[0]?.actionablePrompt
      );
    });
  });

  describe("3. Schema Boundaries & Malformed Provider Output", () => {
    it.each([
      {
        count: 2,
        payload: {
          misconceptions: ["Confusing forward pass with gradient accumulation"],
          recommendations: [
            {
              title: "Draw computation tree",
              description: "Illustrate tree nodes with intermediate values.",
              actionablePrompt: "Ask where each value is computed.",
            },
            {
              title: "Differentiate passes",
              description: "Highlight timing difference between passes.",
              actionablePrompt: "Have students trace timeline.",
            },
          ],
        },
      },
      {
        count: 3,
        payload: {
          misconceptions: ["Confusing forward pass with gradient accumulation"],
          recommendations: [
            {
              title: "Draw computation tree",
              description: "Illustrate tree nodes with intermediate values.",
              actionablePrompt: "Ask where each value is computed.",
            },
            {
              title: "Differentiate passes",
              description: "Highlight timing difference between passes.",
              actionablePrompt: "Have students trace timeline.",
            },
            {
              title: "Quick poll recap",
              description: "Check if students understand backward dependency.",
              actionablePrompt: "Run a 60-second thumbs up check.",
            },
          ],
        },
      },
    ])("accepts valid schema with $count recommendations", async ({ payload }) => {
      const liveFetch = vi
        .fn()
        .mockResolvedValue(createMockResponse(JSON.stringify(payload)));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: liveFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      const result = await pipeline.suggestInterventions(
        lectureId,
        canonicalResponses
      );

      expect(result).toEqual(payload);
    });

    it("rejects malformed non-JSON provider output with 502 BAD_GATEWAY", async () => {
      const malformedFetch = vi
        .fn()
        .mockResolvedValue(createMockResponse("Not valid JSON at all"));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: malformedFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      await expect(
        pipeline.suggestInterventions(lectureId, canonicalResponses)
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("rejects provider output with missing required fields with 502 BAD_GATEWAY", async () => {
      const missingFieldPayload = {
        misconceptions: ["Some misconception"],
        recommendations: [
          {
            title: "Missing prompt",
            description: "Has description but no actionablePrompt",
          },
          {
            title: "Valid rec",
            description: "Valid description",
            actionablePrompt: "Valid prompt",
          },
        ],
      };

      const invalidFetch = vi
        .fn()
        .mockResolvedValue(
          createMockResponse(JSON.stringify(missingFieldPayload))
        );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: invalidFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      await expect(
        pipeline.suggestInterventions(lectureId, canonicalResponses)
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it.each([
      {
        reason: "empty misconceptions array",
        payload: {
          misconceptions: [],
          recommendations: [
            {
              title: "Title 1",
              description: "Desc 1",
              actionablePrompt: "Prompt 1",
            },
            {
              title: "Title 2",
              description: "Desc 2",
              actionablePrompt: "Prompt 2",
            },
          ],
        },
      },
      {
        reason: "whitespace-only misconception",
        payload: {
          misconceptions: ["   "],
          recommendations: [
            {
              title: "Title 1",
              description: "Desc 1",
              actionablePrompt: "Prompt 1",
            },
            {
              title: "Title 2",
              description: "Desc 2",
              actionablePrompt: "Prompt 2",
            },
          ],
        },
      },
      {
        reason: "only 1 recommendation (minimum is 2)",
        payload: {
          misconceptions: ["Valid misconception"],
          recommendations: [
            {
              title: "Only one rec",
              description: "Desc",
              actionablePrompt: "Prompt",
            },
          ],
        },
      },
      {
        reason: "4 recommendations (maximum is 3)",
        payload: {
          misconceptions: ["Valid misconception"],
          recommendations: [
            { title: "R1", description: "D1", actionablePrompt: "P1" },
            { title: "R2", description: "D2", actionablePrompt: "P2" },
            { title: "R3", description: "D3", actionablePrompt: "P3" },
            { title: "R4", description: "D4", actionablePrompt: "P4" },
          ],
        },
      },
      {
        reason: "whitespace-only actionablePrompt",
        payload: {
          misconceptions: ["Valid misconception"],
          recommendations: [
            { title: "R1", description: "D1", actionablePrompt: "   " },
            { title: "R2", description: "D2", actionablePrompt: "P2" },
          ],
        },
      },
    ])("rejects $reason with 502 BAD_GATEWAY", async ({ payload }) => {
      const invalidFetch = vi
        .fn()
        .mockResolvedValue(createMockResponse(JSON.stringify(payload)));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: invalidFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new SuggestInterventionsAi(client);

      await expect(
        pipeline.suggestInterventions(lectureId, canonicalResponses)
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });
  });

  describe("4. Deadline & Provider Error Propagation", () => {
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

    it("enforces 30000ms deadline timeout (504 GATEWAY_TIMEOUT)", async () => {
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
      const pipeline = new SuggestInterventionsAi(client);

      vi.useFakeTimers();
      try {
        let settled = false;
        let caughtError: unknown;
        const interventionPromise = pipeline.suggestInterventions(
          lectureId,
          canonicalResponses
        );

        interventionPromise
          .catch((err) => {
            caughtError = err;
          })
          .finally(() => {
            settled = true;
          });

        // Remains pending at 29,999ms
        await vi.advanceTimersByTimeAsync(29999);
        expect(settled).toBe(false);

        // Rejects at 30,000ms deadline
        await vi.advanceTimersByTimeAsync(1);
        await expect(interventionPromise).rejects.toMatchObject({
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

    it("propagates 429 rate limit response as 502 BAD_GATEWAY without intervention result", async () => {
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
      const pipeline = new SuggestInterventionsAi(client);

      await expect(
        pipeline.suggestInterventions(lectureId, canonicalResponses)
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });
  });
});
