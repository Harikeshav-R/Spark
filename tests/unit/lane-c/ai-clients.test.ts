import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  AI_CAPABILITIES,
  CAPABILITY_POLICIES,
  DEFAULT_MODELS,
} from "../../../src/server/ai/index.js";

const testSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
});

type TestSchema = z.infer<typeof testSchema>;

describe("P1-C-01: OpenRouter Client Adapter", () => {
  describe("1. Fixture Mode & Configuration", () => {
    it("defaults to fixture mode when INTEGRATION_MODE is unset or empty", async () => {
      const clientUnset = new OpenRouterClient({ env: {} });
      expect(clientUnset.getIntegrationMode()).toBe("fixture");

      const clientEmpty = new OpenRouterClient({ env: { INTEGRATION_MODE: "   " } });
      expect(clientEmpty.getIntegrationMode()).toBe("fixture");
    });

    it("executes fixture callback and validates against schema without calling fetch", async () => {
      const throwingFetch = vi.fn().mockImplementation(() => {
        throw new Error("Fetch must NEVER be called in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: throwingFetch as unknown as typeof globalThis.fetch,
      });

      const fixtureData: TestSchema = {
        answer: "Gradient descent moves in opposite direction of gradient.",
        confidence: 0.95,
      };

      const result = await client.complete<TestSchema>({
        capability: "detectConcepts",
        messages: [{ role: "user", content: "Explain gradient descent." }],
        schema: testSchema,
        fixture: () => fixtureData,
      });

      expect(result).toEqual(fixtureData);
      expect(throwingFetch).not.toHaveBeenCalled();
    });

    it("rejects schema-invalid fixture responses with 502 BAD_GATEWAY", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Test" }],
          schema: testSchema,
          fixture: () => ({ answer: 123, confidence: "not-a-number" }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("rejects throwing fixture callbacks with 502 BAD_GATEWAY", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Test" }],
          schema: testSchema,
          fixture: () => {
            throw new Error("Fixture simulation crashed");
          },
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("rejects invalid INTEGRATION_MODE with 503 SERVICE_UNAVAILABLE", () => {
      expect(() => new OpenRouterClient({ env: { INTEGRATION_MODE: "invalid_mode" } })).toThrowError(
        AppError
      );

      try {
        new OpenRouterClient({ env: { INTEGRATION_MODE: "invalid_mode" } });
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.SERVICE_UNAVAILABLE);
        expect(appErr.statusCode).toBe(503);
      }
    });

    it("rejects live mode when OPENROUTER_API_KEY is missing or whitespace with 503 SERVICE_UNAVAILABLE", () => {
      expect(() => new OpenRouterClient({ env: { INTEGRATION_MODE: "live" } })).toThrowError(AppError);

      try {
        new OpenRouterClient({ env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "   " } });
      } catch (err) {
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.SERVICE_UNAVAILABLE);
        expect(appErr.statusCode).toBe(503);
      }
    });

    it("uses exact default models and supports nonblank overrides", () => {
      const clientDefault = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      expect(clientDefault.getModel("fast")).toBe(DEFAULT_MODELS.fast);
      expect(clientDefault.getModel("deep")).toBe(DEFAULT_MODELS.deep);
      expect(clientDefault.getModel("search")).toBe(DEFAULT_MODELS.search);
      expect(DEFAULT_MODELS.fast).toBe("minimax/minimax-m3.1-flash:free");
      expect(DEFAULT_MODELS.deep).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
      expect(DEFAULT_MODELS.search).toBe("perplexity/sonar-pro");

      const clientCustom = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "fixture",
          OPENROUTER_FAST_MODEL: "custom/fast-model",
          OPENROUTER_DEEP_MODEL: "custom/deep-model",
          OPENROUTER_SEARCH_MODEL: "custom/search-model",
        },
      });
      expect(clientCustom.getModel("fast")).toBe("custom/fast-model");
      expect(clientCustom.getModel("deep")).toBe("custom/deep-model");
      expect(clientCustom.getModel("search")).toBe("custom/search-model");

      const clientWhitespace = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "fixture",
          OPENROUTER_FAST_MODEL: "   ",
          OPENROUTER_DEEP_MODEL: "\t",
          OPENROUTER_SEARCH_MODEL: "\n",
        },
      });
      expect(clientWhitespace.getModel("fast")).toBe(DEFAULT_MODELS.fast);
      expect(clientWhitespace.getModel("deep")).toBe(DEFAULT_MODELS.deep);
      expect(clientWhitespace.getModel("search")).toBe(DEFAULT_MODELS.search);
    });

    it("defines policies for all thirteen capabilities with non-zero timeout and maxTokens", () => {
      expect(AI_CAPABILITIES).toHaveLength(13);
      for (const cap of AI_CAPABILITIES) {
        const policy = CAPABILITY_POLICIES[cap];
        expect(policy).toBeDefined();
        expect(["fast", "deep", "search"]).toContain(policy.tier);
        expect(policy.timeoutMs).toBeGreaterThan(0);
        expect(policy.maxTokens).toBeGreaterThan(0);
      }
    });
  });

  describe("2. Live Mode HTTP Transport & Validation", () => {
    function createMockResponse(status: number, body: unknown): Response {
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    it("parses valid JSON response conforming to schema", async () => {
      const mockPayload = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ answer: "Derivative of x^2 is 2x", confidence: 0.99 }),
            },
            finish_reason: "stop",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "sk-or-test-key-12345",
        },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const result = await client.complete({
        capability: "evaluatePollResponse",
        messages: [{ role: "user", content: "What is derivative of x^2?" }],
        schema: testSchema,
        fixture: () => {
          throw new Error("Must not invoke fixture in live mode");
        },
      });

      expect(result).toEqual({ answer: "Derivative of x^2 is 2x", confidence: 0.99 });
      expect(customFetch).toHaveBeenCalledTimes(1);

      // Verify request payload contained correct model and headers
      const call = customFetch.mock.calls[0];
      const requestUrl = call[0] as string;
      const requestInit = call[1] as RequestInit;
      expect(requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(requestInit.method).toBe("POST");

      const requestBody = JSON.parse(requestInit.body as string);
      expect(requestBody.model).toBe("minimax/minimax-m3.1-flash:free"); // evaluatePollResponse is fast tier
      expect(requestBody.max_tokens).toBe(500);
    });

    it("rejects truncated completions (finish_reason: length) with 502 BAD_GATEWAY", async () => {
      const mockPayload = {
        choices: [
          {
            message: { role: "assistant", content: '{"answer": "partial' },
            finish_reason: "length",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "socraticTutorTurn",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        expect(appErr.message).toContain("truncated");
        return true;
      });
    });

    it("rejects provider refusals with 502 BAD_GATEWAY", async () => {
      const mockPayload = {
        choices: [
          {
            message: { role: "assistant", content: null, refusal: "I cannot fulfill this request." },
            finish_reason: "stop",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "socraticTutorTurn",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        expect(appErr.message).toContain("refused");
        return true;
      });
    });

    it("rejects empty choices with 502 BAD_GATEWAY", async () => {
      const mockPayload = { choices: [] };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("rejects empty content with 502 BAD_GATEWAY", async () => {
      const mockPayload = {
        choices: [{ message: { role: "assistant", content: "   " }, finish_reason: "stop" }],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("rejects non-JSON content with 502 BAD_GATEWAY", async () => {
      const mockPayload = {
        choices: [
          {
            message: { role: "assistant", content: "Not a JSON document at all" },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("rejects schema-invalid JSON content with 502 BAD_GATEWAY", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({ wrongField: "missing answer and confidence" }),
            },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("maps provider 401/403 to 503 SERVICE_UNAVAILABLE without leaking API key", async () => {
      const secretKey = "sk-super-secret-api-key-999";
      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(401, {
          error: { message: "Invalid API key provided", code: 401 },
        })
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: secretKey },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.SERVICE_UNAVAILABLE);
        expect(appErr.statusCode).toBe(503);
        expect(appErr.message).not.toContain(secretKey);
        return true;
      });
    });

    it("maps provider 429/500/503 to 502 BAD_GATEWAY", async () => {
      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(429, {
          error: { message: "Rate limit exceeded", code: 429 },
        })
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.statusCode).toBe(502);
        return true;
      });
    });

    it("maps provider 504 to 504 GATEWAY_TIMEOUT", async () => {
      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(504, {
          error: { message: "Gateway Timeout upstream", code: 504 },
        })
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      await expect(
        client.complete({
          capability: "detectConcepts",
          messages: [{ role: "user", content: "Hello" }],
          schema: testSchema,
          fixture: () => ({ answer: "f", confidence: 1 }),
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.GATEWAY_TIMEOUT);
        expect(appErr.statusCode).toBe(504);
        return true;
      });
    });

    it("aborts cleanly on hung request and yields 504 GATEWAY_TIMEOUT without retries", async () => {
      const customFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const { promise, reject } = Promise.withResolvers<Response>();
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        }
        return promise;
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-key" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      // Use fake timers to advance time deterministically
      vi.useFakeTimers();
      try {
        const assertion = expect(
          client.complete({
            capability: "detectConcepts", // 5000ms timeout
            messages: [{ role: "user", content: "Hello" }],
            schema: testSchema,
            fixture: () => ({ answer: "f", confidence: 1 }),
          })
        ).rejects.toSatisfy((err: unknown) => {
          expect(err).toBeInstanceOf(AppError);
          const appErr = err as AppError;
          expect(appErr.code).toBe(DomainErrorCode.GATEWAY_TIMEOUT);
          expect(appErr.statusCode).toBe(504);
          expect(appErr.message).toContain("detectConcepts");
          return true;
        });

        // Fast-forward past timeout
        await vi.advanceTimersByTimeAsync(5100);
        await assertion;

        // Prove exactly 1 call was made (no retries)
        expect(customFetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
