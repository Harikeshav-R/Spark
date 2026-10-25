import { describe, it, expect, vi } from "vitest";
import type { DetectConceptsCandidate } from "../../../src/contracts/ai.js";
import { summarizedLectureSchema } from "../../../src/contracts/ai.js";
import type { UUID } from "../../../src/contracts/common.js";
import { DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  OpenRouterClient,
  SummarizeLectureAi,
  fixtureSummarizeLecture,
} from "../../../src/server/ai/index.js";

function createMockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("P3-C-02: SummarizeLectureAi Pipeline", () => {
  const ID_LOSS: UUID = "11111111-1111-4111-8111-111111111111";
  const ID_GRADIENT: UUID = "22222222-2222-4222-8222-222222222222";
  const ID_LEARNING_RATE: UUID = "33333333-3333-4333-8333-333333333333";
  const ID_INVENTED: UUID = "99999999-9999-4999-8999-999999999999";

  const standardCandidates: DetectConceptsCandidate[] = [
    { id: ID_LOSS, label: "Loss Functions" },
    { id: ID_GRADIENT, label: "Gradient Descent" },
    { id: ID_LEARNING_RATE, label: "Learning Rate" },
  ];

  describe("1. CP-P3-C-02 Deterministic Fixture & Grounding", () => {
    it("generates structured summary, concept matches, and highlights for valid chunks", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const summarizer = new SummarizeLectureAi(client);

      const chunks = [
        {
          text: "Welcome. Today we introduce Gradient Descent for convex optimization.",
          timestampSec: 60,
        },
        {
          text: "Next we analyze the Learning Rate and step sizes to avoid divergence.",
          timestampSec: 180,
        },
      ];

      const result = await summarizer.summarizeLecture(chunks, standardCandidates);

      expect(summarizedLectureSchema.safeParse(result).success).toBe(true);
      expect(result.keyConceptsCovered).toEqual([ID_GRADIENT, ID_LEARNING_RATE]);
      expect(result.summary).toContain("## Lecture summary");
      expect(result.summary).toContain("Gradient Descent");
      expect(result.summary).toContain("Learning Rate");
      expect(result.summary.length).toBeGreaterThanOrEqual(100);
      expect(result.summary.length).toBeLessThanOrEqual(3000);

      expect(result.timelineHighlights).toHaveLength(2);
      expect(result.timelineHighlights[0]).toEqual({
        timestampSec: 60,
        conceptLabel: "Gradient Descent",
        description: chunks[0].text.slice(0, 240),
      });
      expect(result.timelineHighlights[1]).toEqual({
        timestampSec: 180,
        conceptLabel: "Learning Rate",
        description: chunks[1].text.slice(0, 240),
      });
    });

    it("orders excerpts and highlights chronologically when given unsorted chunks", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const summarizer = new SummarizeLectureAi(client);

      const unsortedChunks = [
        { text: "Later in the lecture, we check Learning Rate.", timestampSec: 300 },
        { text: "First, we define Loss Functions.", timestampSec: 50 },
        { text: "Then, we compute Gradient Descent steps.", timestampSec: 150 },
      ];

      const result = await summarizer.summarizeLecture(unsortedChunks, standardCandidates);

      expect(result.timelineHighlights).toHaveLength(3);
      expect(result.timelineHighlights[0].timestampSec).toBe(50);
      expect(result.timelineHighlights[0].conceptLabel).toBe("Loss Functions");
      expect(result.timelineHighlights[1].timestampSec).toBe(150);
      expect(result.timelineHighlights[1].conceptLabel).toBe("Gradient Descent");
      expect(result.timelineHighlights[2].timestampSec).toBe(300);
      expect(result.timelineHighlights[2].conceptLabel).toBe("Learning Rate");
    });

    it("returns helpful notice without calling provider for empty chunks", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const completeSpy = vi.spyOn(client, "complete");
      const summarizer = new SummarizeLectureAi(client);

      const result = await summarizer.summarizeLecture([], standardCandidates);

      expect(completeSpy).not.toHaveBeenCalled();
      expect(result.summary).toBe(
        "## Lecture summary\n\nNo transcript was recorded for this lecture. Key concepts and timestamped excerpts are unavailable."
      );
      expect(result.summary.length).toBeGreaterThanOrEqual(100);
      expect(result.summary.length).toBeLessThanOrEqual(3000);
      expect(result.keyConceptsCovered).toEqual([]);
      expect(result.timelineHighlights).toEqual([]);
    });

    it("returns helpful notice without calling provider for whitespace-only chunks", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const completeSpy = vi.spyOn(client, "complete");
      const summarizer = new SummarizeLectureAi(client);

      const result = await summarizer.summarizeLecture(
        [
          { text: "   \t  ", timestampSec: 10 },
          { text: "\n\n   ", timestampSec: 20 },
        ],
        standardCandidates
      );

      expect(completeSpy).not.toHaveBeenCalled();
      expect(result.summary).toBe(
        "## Lecture summary\n\nNo transcript was recorded for this lecture. Key concepts and timestamped excerpts are unavailable."
      );
      expect(result.keyConceptsCovered).toEqual([]);
      expect(result.timelineHighlights).toEqual([]);
    });

    it("fixtureSummarizeLecture directly handles empty and non-empty inputs", () => {
      const empty = fixtureSummarizeLecture([]);
      expect(empty.summary).toContain("No transcript was recorded");
      expect(empty.keyConceptsCovered).toEqual([]);
      expect(empty.timelineHighlights).toEqual([]);

      const populated = fixtureSummarizeLecture(
        [{ text: "Introduction to Loss Functions", timestampSec: 0 }],
        standardCandidates
      );
      expect(populated.keyConceptsCovered).toEqual([ID_LOSS]);
      expect(populated.timelineHighlights[0].conceptLabel).toBe("Loss Functions");
    });
  });

  describe("2. Input Validation (400 VALIDATION_ERROR)", () => {
    const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
    const summarizer = new SummarizeLectureAi(client);

    it("rejects negative timestampSec", async () => {
      await expect(
        summarizer.summarizeLecture(
          [{ text: "hello", timestampSec: -1 }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid lecture summarization input",
      });
    });

    it("rejects NaN timestampSec", async () => {
      await expect(
        summarizer.summarizeLecture(
          [{ text: "hello", timestampSec: NaN }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });
    });

    it("rejects non-string chunk text", async () => {
      await expect(
        summarizer.summarizeLecture(
          [{ text: 123 as unknown as string, timestampSec: 0 }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });
    });

    it("rejects invalid candidate UUID format", async () => {
      await expect(
        summarizer.summarizeLecture(
          [{ text: "hello", timestampSec: 0 }],
          [{ id: "not-a-uuid" as UUID, label: "Loss" }]
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });
    });

    it("rejects empty candidate label", async () => {
      await expect(
        summarizer.summarizeLecture(
          [{ text: "hello", timestampSec: 0 }],
          [{ id: ID_LOSS, label: "" }]
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });
    });

    it("rejects non-array chunks input", async () => {
      await expect(
        summarizer.summarizeLecture(
          null as unknown as { text: string; timestampSec: number }[],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
      });
    });
  });

  describe("3. Live Mode Grounding & Provider Error Handling", () => {
    it("returns validated result from compliant live provider response", async () => {
      const validAssistantResponse = {
        summary:
          "## Lecture Overview\n\nIn this session we examined Loss Functions and applied Gradient Descent to iteratively minimize empirical risk across linear models.\n\n### Key Concepts\n- Loss Functions\n- Gradient Descent",
        keyConceptsCovered: [ID_LOSS, ID_GRADIENT, ID_LOSS], // duplicate ID_LOSS to verify deduplication
        timelineHighlights: [
          {
            timestampSec: 100,
            conceptLabel: "Gradient Descent",
            description: "applied Gradient Descent to iteratively",
          },
          {
            timestampSec: 10,
            conceptLabel: "Loss Functions",
            description: "examined Loss Functions and applied",
          },
        ],
      };

      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify(validAssistantResponse),
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
      const summarizer = new SummarizeLectureAi(client);

      const chunks = [
        {
          text: "We examined Loss Functions and applied optimization techniques.",
          timestampSec: 10,
        },
        {
          text: "Then we applied Gradient Descent to iteratively minimize empirical risk.",
          timestampSec: 100,
        },
      ];

      const result = await summarizer.summarizeLecture(chunks, standardCandidates);

      // Verify deduplication in returned order
      expect(result.keyConceptsCovered).toEqual([ID_LOSS, ID_GRADIENT]);
      // Verify highlights sorted chronologically
      expect(result.timelineHighlights[0].timestampSec).toBe(10);
      expect(result.timelineHighlights[1].timestampSec).toBe(100);
    });

    it("rejects invented concept UUID not in candidates (502 BAD_GATEWAY)", async () => {
      const responseWithInventedId = {
        summary: "A".repeat(150),
        keyConceptsCovered: [ID_INVENTED],
        timelineHighlights: [],
      };

      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify(responseWithInventedId),
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
      const summarizer = new SummarizeLectureAi(client);

      await expect(
        summarizer.summarizeLecture(
          [{ text: "Discussing models and loss.", timestampSec: 0 }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: "AI provider response did not match expected schema",
      });
    });

    it("rejects highlight with timestampSec not matching any chunk (502 BAD_GATEWAY)", async () => {
      const responseWithInvalidTimestamp = {
        summary: "B".repeat(150),
        keyConceptsCovered: [ID_LOSS],
        timelineHighlights: [
          {
            timestampSec: 9999, // does not match chunk timestamp 0
            conceptLabel: "Loss Functions",
            description: "Discussing models",
          },
        ],
      };

      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify(responseWithInvalidTimestamp),
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
      const summarizer = new SummarizeLectureAi(client);

      await expect(
        summarizer.summarizeLecture(
          [{ text: "Discussing models and loss.", timestampSec: 0 }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("rejects highlight with description not a substring of the chunk (502 BAD_GATEWAY)", async () => {
      const responseWithFabricatedDescription = {
        summary: "C".repeat(150),
        keyConceptsCovered: [ID_LOSS],
        timelineHighlights: [
          {
            timestampSec: 0,
            conceptLabel: "Loss Functions",
            description: "This text never occurred in the lecture chunk at all",
          },
        ],
      };

      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify(responseWithFabricatedDescription),
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
      const summarizer = new SummarizeLectureAi(client);
      await expect(
        summarizer.summarizeLecture(
          [{ text: "Discussing models and loss.", timestampSec: 0 }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("rejects malformed / non-JSON provider response (502 BAD_GATEWAY)", async () => {
      const mockPayload = {
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"summary": "Incomplete and truncated response...',
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
      const summarizer = new SummarizeLectureAi(client);

      await expect(
        summarizer.summarizeLecture(
          [{ text: "Discussing models and loss.", timestampSec: 0 }],
          standardCandidates
        )
      ).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: "AI provider response was not valid JSON",
      });
    });

    it("propagates missing live credentials (503 SERVICE_UNAVAILABLE)", () => {
      expect(() => {
        new OpenRouterClient({
          env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "" },
        });
      }).toThrowError(
        expect.objectContaining({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
        })
      );
    });

    it("propagates 15-second timeout (504 GATEWAY_TIMEOUT)", async () => {
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
      const summarizer = new SummarizeLectureAi(client);

      vi.useFakeTimers();
      try {
        const assertion = expect(
          summarizer.summarizeLecture(
            [{ text: "Discussing models and loss.", timestampSec: 0 }],
            standardCandidates
          )
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
