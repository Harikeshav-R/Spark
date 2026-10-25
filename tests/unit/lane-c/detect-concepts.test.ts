import type { MockInstance } from "vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DetectConceptsCandidate } from "../../../src/contracts/ai.js";
import type { UUID } from "../../../src/contracts/common.js";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import { DetectConceptsAi, OpenRouterClient } from "../../../src/server/ai/index.js";

function createMockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("P3-C-01: DetectConceptsAi Pipeline", () => {
  const ID_LOSS: UUID = "11111111-1111-4111-8111-111111111111";
  const ID_GRADIENT: UUID = "22222222-2222-4222-8222-222222222222";
  const ID_REGULARIZATION: UUID = "33333333-3333-4333-8333-333333333333";
  const ID_UNKNOWN: UUID = "44444444-4444-4444-8444-444444444444";

  const standardCandidates: DetectConceptsCandidate[] = [
    { id: ID_LOSS, label: "Loss Functions" },
    { id: ID_GRADIENT, label: "Gradients" },
    { id: ID_REGULARIZATION, label: "Regularization" },
  ];

  let warnSpy: MockInstance;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("1. CP-P3-C-01 Verification & Deterministic Fixture", () => {
    it("returns IDs for Loss Functions and Gradients for CP-P3-C-01 expected input", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts(
        "Loss Functions measure prediction error. Gradients point uphill.",
        standardCandidates
      );

      expect(detected).toEqual([ID_LOSS, ID_GRADIENT]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns empty array for unrelated speech text", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts(
        "Welcome to the lecture hall. Please take your seats.",
        standardCandidates
      );

      expect(detected).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("2. Fast-Path Bounds & Candidate Confinement", () => {
    it("returns [] immediately for blank or whitespace-only text without calling provider", async () => {
      const throwingFetch = vi.fn().mockImplementation(() => {
        throw new Error("Provider should not be called for blank text");
      });
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: throwingFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      expect(await detector.detectConcepts("", standardCandidates)).toEqual([]);
      expect(await detector.detectConcepts("    \n\t  ", standardCandidates)).toEqual([]);
      expect(throwingFetch).not.toHaveBeenCalled();
    });

    it("returns [] immediately for empty candidates list without calling provider", async () => {
      const throwingFetch = vi.fn().mockImplementation(() => {
        throw new Error("Provider should not be called for empty candidates");
      });
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: throwingFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      expect(await detector.detectConcepts("Gradients point uphill.", [])).toEqual([]);
      expect(throwingFetch).not.toHaveBeenCalled();
    });

    it("deduplicates candidate IDs and returned result IDs in first-returned order", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                conceptIds: [ID_GRADIENT, ID_LOSS, ID_GRADIENT],
              }),
            },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      const candidatesWithDupes: DetectConceptsCandidate[] = [
        { id: ID_LOSS, label: "Loss Functions" },
        { id: ID_GRADIENT, label: "Gradients" },
        { id: ID_LOSS, label: "Loss Functions Dupe" },
      ];

      const detected = await detector.detectConcepts("Gradients and loss", candidatesWithDupes);
      expect(detected).toEqual([ID_GRADIENT, ID_LOSS]);
    });

    it("drops unknown valid UUIDs that are not in the candidate set", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                conceptIds: [ID_UNKNOWN, ID_GRADIENT],
              }),
            },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts("Gradients", standardCandidates);
      expect(detected).toEqual([ID_GRADIENT]);
    });

    it("catches malformed candidate objects and returns [] with sanitized log", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const detector = new DetectConceptsAi(client);

      const invalidCandidates = [
        { id: "not-a-uuid", label: "" },
      ] as unknown as DetectConceptsCandidate[];

      const detected = await detector.detectConcepts("Gradients", invalidCandidates);
      expect(detected).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("[DetectConceptsAi] Concept detection failed: UNKNOWN");
    });
  });

  describe("3. Live Transport, Error Handling & Recovery Boundary", () => {
    it("returns candidate IDs from valid live JSON response conforming to schema", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                conceptIds: [ID_LOSS, ID_GRADIENT],
              }),
            },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts(
        "Loss Functions measure prediction error. Gradients point uphill.",
        standardCandidates
      );
      expect(detected).toEqual([ID_LOSS, ID_GRADIENT]);
      expect(warnSpy).not.toHaveBeenCalled();

      // Check request formatting
      const call = customFetch.mock.calls[0];
      const requestBody = JSON.parse(call[1].body as string);
      expect(requestBody.messages[0].role).toBe("system");
      expect(requestBody.messages[0].content).toContain("concept classifier");
      expect(requestBody.messages[1].role).toBe("user");
      const userPayload = JSON.parse(requestBody.messages[1].content);
      expect(userPayload.transcript).toBe(
        "Loss Functions measure prediction error. Gradients point uphill."
      );
      expect(userPayload.candidateConcepts).toHaveLength(3);
    });

    it("resolves to [] and logs sanitized diagnostic on malformed JSON", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: "invalid json string",
            },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts("Gradients", standardCandidates);
      expect(detected).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("[DetectConceptsAi] Concept detection failed: BAD_GATEWAY");
    });

    it("resolves to [] and logs sanitized diagnostic on invalid UUID format", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                conceptIds: ["not-a-valid-uuid"],
              }),
            },
            finish_reason: "stop",
          },
        ],
      };
      const customFetch = vi.fn().mockResolvedValue(createMockResponse(200, mockPayload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts("Gradients", standardCandidates);
      expect(detected).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("[DetectConceptsAi] Concept detection failed: BAD_GATEWAY");
    });

    it("resolves to [] and logs sanitized diagnostic on provider 500 error", async () => {
      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(500, { error: { message: "Internal server error" } })
      );
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      const detected = await detector.detectConcepts("Gradients", standardCandidates);
      expect(detected).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("[DetectConceptsAi] Concept detection failed: BAD_GATEWAY");
    });

    it("resolves to [] on request timeout (5000ms abort) using fake timers", async () => {
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
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      vi.useFakeTimers();
      try {
        const detectPromise = detector.detectConcepts("Gradients", standardCandidates);
        await vi.advanceTimersByTimeAsync(5100);
        const detected = await detectPromise;
        expect(detected).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
          "[DetectConceptsAi] Concept detection failed: GATEWAY_TIMEOUT"
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("never falls back to fixture on live error", async () => {
      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(500, { error: { message: "Internal server error" } })
      );
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });
      const detector = new DetectConceptsAi(client);

      // The speech contains "Gradients" which would match fixture
      const detected = await detector.detectConcepts(
        "Gradients point in direction of steepest ascent.",
        standardCandidates
      );
      // In live mode, error MUST NOT fall back to fixture
      expect(detected).toEqual([]);
    });

    it("fails construction with 503 SERVICE_UNAVAILABLE when live credentials missing", () => {
      expect(() => {
        new OpenRouterClient({ env: { INTEGRATION_MODE: "live" } });
      }).toThrowError();

      try {
        new OpenRouterClient({ env: { INTEGRATION_MODE: "live" } });
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe(DomainErrorCode.SERVICE_UNAVAILABLE);
        expect(appErr.statusCode).toBe(503);
      }
    });
  });
});
