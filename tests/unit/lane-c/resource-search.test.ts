import { describe, it, expect, vi } from "vitest";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import type { ConceptNode } from "../../../src/contracts/course.js";
import { OpenRouterClient } from "../../../src/server/ai/providers/openrouter-client.js";
import { SearchResourcesAi } from "../../../src/server/ai/pipelines/search-resources.js";
import { ResourceQaAi } from "../../../src/server/ai/pipelines/resource-qa.js";
import {
  fixtureSearchAcademicResources,
  fixtureAnswerResourceQuestion,
} from "../../../src/server/ai/fixtures/academic-resources.js";

const sampleConcept: ConceptNode = {
  id: "33333333-3333-4333-8333-333333333305",
  courseId: "11111111-1111-4111-8111-111111111111",
  label: "Gradient Descent",
  description:
    "First-order iterative optimization algorithm for finding a local minimum of a differentiable function.",
  category: "Optimization",
  difficulty: 2,
  createdAt: "2026-10-24T00:00:00.000Z",
};
function createMockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createOpenAiEnvelope(content: string) {
  return {
    id: "chatcmpl-test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
  };
}

describe("P5-C-04: Academic Resource Search and Cited Q&A", () => {
  describe("1. Deterministic Fixture Mode & Isolation", () => {
    it("returns curated URL mappings and answer citation markers that resolve exactly to returned citations", async () => {
      const throwingFetch = vi.fn().mockImplementation(() => {
        throw new Error("Must not make network requests in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: throwingFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      const qaAi = new ResourceQaAi(client);

      const resources = await searchAi.searchAcademicResources("Gradient Descent");
      expect(throwingFetch).not.toHaveBeenCalled();
      expect(resources).toHaveLength(3);
      expect(resources.map((r) => r.citationNumber)).toEqual([1, 2, 3]);
      expect(resources[0]?.url).toBe("https://arxiv.org/abs/1606.04838");
      expect(resources[1]?.url).toBe("https://web.stanford.edu/~boyd/cvxbook/");
      expect(resources[2]?.url).toBe("https://arxiv.org/abs/1609.04747");

      // Verify mutation isolation
      const resourcesCopy = await searchAi.searchAcademicResources("Gradient Descent");
      resources[0]!.title = "Mutated Title";
      expect(resourcesCopy[0]?.title).not.toBe("Mutated Title");

      const qa = await qaAi.answerResourceQuestion(
        sampleConcept,
        "How does the update direction work?"
      );
      expect(throwingFetch).not.toHaveBeenCalled();
      expect(qa.answer).toContain("gradient");
      expect(qa.citations).toHaveLength(2);
      expect(qa.citations.map((c) => c.number)).toEqual([2, 3]);
      expect(qa.citations[0]?.url).toBe("https://web.stanford.edu/~boyd/cvxbook/");
      expect(qa.citations[1]?.url).toBe("https://arxiv.org/abs/1609.04747");

      // Verify QA mutation isolation
      const qa2 = await qaAi.answerResourceQuestion(
        sampleConcept,
        "How does the update direction work?"
      );
      qa.citations[0]!.title = "Mutated Citation";
      expect(qa2.citations[0]?.title).not.toBe("Mutated Citation");

      // Verify direct fixture function output
      const rawFixtureSearch = fixtureSearchAcademicResources("Gradient Descent");
      expect(rawFixtureSearch.resources).toHaveLength(3);
      const rawFixtureQa = fixtureAnswerResourceQuestion(sampleConcept, "update direction");
      expect(rawFixtureQa.citations).toHaveLength(2);
    });
  });

  describe("2. Live Search URL Filtering & Resilience", () => {
    it("preserves valid academic rows and filters malformed, javascript, data, relative, and credential URLs", async () => {
      const livePayload = {
        resources: [
          {
            title: "Paper 1",
            url: "https://arxiv.org/abs/1606.04838",
            snippet: "Valid first-order optimization snippet",
            citationNumber: 1,
          },
          {
            title: "Malicious Row",
            url: "javascript:alert(1)",
            snippet: "XSS attempt",
            citationNumber: 2,
          },
          {
            title: "Data URL Row",
            url: "data:text/html,evil",
            snippet: "Data payload",
            citationNumber: 3,
          },
          {
            title: "Relative URL Row",
            url: "/relative/path/to/paper",
            snippet: "Relative link",
            citationNumber: 4,
          },
          {
            title: "Credential URL Row",
            url: "https://user:pass@arxiv.org/abs/1606.04838",
            snippet: "Credential URL",
            citationNumber: 5,
          },
          {
            title: "Paper 6",
            url: "https://stanford.edu/class/cs229",
            snippet: "Stanford CS229 notes",
            citationNumber: 6,
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(livePayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      const results = await searchAi.searchAcademicResources("Gradient Descent");

      expect(results).toHaveLength(2);
      expect(results[0]?.citationNumber).toBe(1);
      expect(results[0]?.url).toBe("https://arxiv.org/abs/1606.04838");
      expect(results[1]?.citationNumber).toBe(6);
      expect(results[1]?.url).toBe("https://stanford.edu/class/cs229");
    });

    it("returns empty array when all URLs are invalid or response resources is empty", async () => {
      const allInvalidPayload = {
        resources: [
          {
            title: "Bad 1",
            url: "not-a-valid-url",
            snippet: "Invalid",
            citationNumber: 1,
          },
          {
            title: "Bad 2",
            url: "ftp://files.example.com",
            snippet: "FTP protocol",
            citationNumber: 2,
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(allInvalidPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      const results = await searchAi.searchAcademicResources("Gradient Descent");
      expect(results).toEqual([]);
    });
  });

  describe("3. Search Citation Numbers Coalescing & Error Handling", () => {
    it("coalesces identical rows sharing a citation number", async () => {
      const payloadWithDuplicates = {
        resources: [
          {
            title: "Identical Paper",
            url: "https://arxiv.org/abs/1606.04838",
            snippet: "Exact same text",
            citationNumber: 1,
          },
          {
            title: "Identical Paper",
            url: "https://arxiv.org/abs/1606.04838",
            snippet: "Exact same text",
            citationNumber: 1,
          },
          {
            title: "Second Paper",
            url: "https://web.stanford.edu/~boyd/cvxbook/",
            snippet: "Another text",
            citationNumber: 2,
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(payloadWithDuplicates)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      const results = await searchAi.searchAcademicResources("Gradient Descent");
      expect(results).toHaveLength(2);
      expect(results[0]?.citationNumber).toBe(1);
      expect(results[1]?.citationNumber).toBe(2);
    });

    it("rejects conflicting rows sharing a citation number with 502 BAD_GATEWAY", async () => {
      const conflictingPayload = {
        resources: [
          {
            title: "First Paper",
            url: "https://arxiv.org/abs/1606.04838",
            snippet: "First snippet",
            citationNumber: 1,
          },
          {
            title: "Conflicting Second Paper",
            url: "https://arxiv.org/abs/1609.04747",
            snippet: "Different snippet",
            citationNumber: 1,
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(conflictingPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      await expect(searchAi.searchAcademicResources("Gradient Descent")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(AppError);
          const appErr = err as AppError;
          expect(appErr.statusCode).toBe(502);
          expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
          expect(appErr.message).toBe("Academic resources contain conflicting citation numbers");
          return true;
        }
      );
    });

    it("rejects non-URL schema violations, invalid JSON, and malformed envelopes with 502", async () => {
      const nonUrlViolationPayload = {
        resources: [
          {
            title: 12345, // invalid title type
            url: "https://arxiv.org/abs/1606.04838",
            snippet: "Valid snippet",
            citationNumber: 1,
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(nonUrlViolationPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      await expect(searchAi.searchAcademicResources("Gradient Descent")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(AppError);
          const appErr = err as AppError;
          expect(appErr.statusCode).toBe(502);
          expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
          return true;
        }
      );
    });
  });

  describe("4. Q&A Marker Resolution, Ordering & Citation Integrity", () => {
    it("orders citations by first use in answer and drops unused citations", async () => {
      const qaPayload = {
        answer: "Use the negative gradient [3], with step-size constraints [1].",
        citations: [
          {
            number: 1,
            title: "Convex Optimization",
            url: "https://web.stanford.edu/~boyd/cvxbook/",
          },
          {
            number: 2,
            title: "Unused Paper",
            url: "https://arxiv.org/abs/unused",
          },
          {
            number: 3,
            title: "Gradient Descent Overview",
            url: "https://arxiv.org/abs/1609.04747",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(qaPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      const result = await qaAi.answerResourceQuestion(sampleConcept, "Explain update direction");

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]?.number).toBe(3);
      expect(result.citations[0]?.title).toBe("Gradient Descent Overview");
      expect(result.citations[1]?.number).toBe(1);
      expect(result.citations[1]?.title).toBe("Convex Optimization");
    });

    it("succeeds when an unused citation has a malformed URL", async () => {
      const qaPayload = {
        answer: "Use the negative gradient [1] for optimization updates.",
        citations: [
          {
            number: 1,
            title: "Convex Optimization",
            url: "https://web.stanford.edu/~boyd/cvxbook/",
          },
          {
            number: 2,
            title: "Bad URL but Unused",
            url: "javascript:evil()",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(qaPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      const result = await qaAi.answerResourceQuestion(sampleConcept, "Explain update direction");
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]?.number).toBe(1);
    });

    it("fails with 502 when answer references a missing citation mapping", async () => {
      const missingCitationPayload = {
        answer: "Use the negative gradient [3], with step-size constraints [1].",
        citations: [
          {
            number: 1,
            title: "Convex Optimization",
            url: "https://web.stanford.edu/~boyd/cvxbook/",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(missingCitationPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "Explain update direction")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Resource answer contains invalid or ungrounded citations");
        return true;
      });
    });

    it("fails with 502 when citations contain conflicting number mappings", async () => {
      const conflictingCitationsPayload = {
        answer: "Use the negative gradient [1] to minimize error.",
        citations: [
          {
            number: 1,
            title: "Paper A",
            url: "https://example.com/a",
          },
          {
            number: 1,
            title: "Paper B",
            url: "https://example.com/b",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(conflictingCitationsPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "Explain update direction")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Resource answer contains invalid or ungrounded citations");
        return true;
      });
    });

    it("fails with 502 when answer contains no citation markers", async () => {
      const noMarkersPayload = {
        answer: "Gradient descent simply follows the derivative downhill without citations.",
        citations: [
          {
            number: 1,
            title: "Paper A",
            url: "https://example.com/a",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(noMarkersPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "Explain update direction")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Resource answer contains invalid or ungrounded citations");
        return true;
      });
    });

    it("fails with 502 when answer contains invalid citation [0]", async () => {
      const zeroMarkerPayload = {
        answer: "Gradient descent uses zero index citation [0] for initial reference.",
        citations: [
          {
            number: 1,
            title: "Paper A",
            url: "https://example.com/a",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(zeroMarkerPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "Explain update direction")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Resource answer contains invalid or ungrounded citations");
        return true;
      });
    });

    it("fails with 502 when a referenced citation has a malformed URL", async () => {
      const malformedReferencedPayload = {
        answer: "Gradient descent references a bad URL citation [1].",
        citations: [
          {
            number: 1,
            title: "Paper A",
            url: "javascript:evil()",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(malformedReferencedPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "Explain update direction")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Resource answer contains invalid or ungrounded citations");
        return true;
      });
    });
  });

  describe("5. Markdown Sanitization & Code Block Citation Immunity", () => {
    it("sanitizes HTML while preserving citation discovery, and ignores markers inside code blocks", async () => {
      const htmlPayload = {
        answer:
          "<script>alert('xss')</script>\n\nGradient descent computes updates iteratively [3]. For example, `[99]` in code is not a citation.\n```python\n# [98] also inside code block\nstep = lr * grad\n```\nSee [unsafe link](javascript:steal()) and reference [1].",
        citations: [
          {
            number: 1,
            title: "Boyd Convex",
            url: "https://web.stanford.edu/~boyd/cvxbook/",
          },
          {
            number: 3,
            title: "Ruder Gradient Descent",
            url: "https://arxiv.org/abs/1609.04747",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(htmlPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      const result = await qaAi.answerResourceQuestion(sampleConcept, "Explain updates");

      expect(result.answer).not.toContain("<script>");
      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]?.number).toBe(3);
      expect(result.citations[1]?.number).toBe(1);
    });

    it("fails with 502 if sanitization strips the only cited marker", async () => {
      const strippedPayload = {
        answer: "<div>[1]</div>", // only citation is inside raw HTML that gets completely stripped or emptied
        citations: [
          {
            number: 1,
            title: "Paper 1",
            url: "https://arxiv.org/abs/1606.04838",
          },
        ],
      };

      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, createOpenAiEnvelope(JSON.stringify(strippedPayload)))
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "Explain updates")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("Resource answer contains invalid or ungrounded citations");
        return true;
      });
    });
  });

  describe("6. Input Validation (400 VALIDATION_ERROR)", () => {
    it("rejects invalid conceptLabel or nonstring query before provider invocation", async () => {
      const fetchFn = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: fetchFn as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);

      await expect(searchAi.searchAcademicResources("   ")).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toBe("Invalid academic resource search input");
        return true;
      });

      await expect(
        searchAi.searchAcademicResources("Valid Label", 123 as unknown as string)
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toBe("Invalid academic resource search input");
        return true;
      });

      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("treats blank whitespace query as omitted and sends trimmed query", async () => {
      const customFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          200,
          createOpenAiEnvelope(
            JSON.stringify({
              resources: [
                {
                  title: "Paper",
                  url: "https://arxiv.org/abs/1",
                  snippet: "Snippet",
                  citationNumber: 1,
                },
              ],
            })
          )
        )
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      await searchAi.searchAcademicResources("Gradient Descent", "   ");

      const call = customFetch.mock.calls[0];
      const body = JSON.parse((call?.[1] as RequestInit).body as string);
      const userMessage = JSON.parse(body.messages[1].content);
      expect(userMessage.query).toBeUndefined();
    });

    it("rejects invalid concept or empty student inquiry before provider invocation", async () => {
      const fetchFn = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: fetchFn as unknown as typeof globalThis.fetch,
      });

      const qaAi = new ResourceQaAi(client);

      // Invalid concept
      await expect(
        qaAi.answerResourceQuestion({} as unknown as ConceptNode, "Valid inquiry")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toBe("Invalid resource question input");
        return true;
      });

      // Empty inquiry
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "   \n\t  ")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.VALIDATION_ERROR);
        expect(appErr.message).toBe("Invalid resource question input");
        return true;
      });

      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe("7. Timeout & Single-Attempt Transport (504 GATEWAY_TIMEOUT)", () => {
    it.each([
      {
        name: "searchAcademicResources",
        action: (client: OpenRouterClient) =>
          new SearchResourcesAi(client).searchAcademicResources("Gradient Descent"),
      },
      {
        name: "answerResourceQuestion",
        action: (client: OpenRouterClient) =>
          new ResourceQaAi(client).answerResourceQuestion(
            sampleConcept,
            "How does gradient descent work?"
          ),
      },
    ])("aborts cleanly at 10,000ms and yields 504 on hung $name", async ({ action }) => {
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
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: customFetch as unknown as typeof globalThis.fetch,
      });

      vi.useFakeTimers();
      try {
        const assertion = expect(action(client)).rejects.toSatisfy((err: unknown) => {
          expect(err).toBeInstanceOf(AppError);
          const appErr = err as AppError;
          expect(appErr.statusCode).toBe(504);
          expect(appErr.code).toBe(DomainErrorCode.GATEWAY_TIMEOUT);
          return true;
        });

        // Advance to 9999ms (still pending)
        await vi.advanceTimersByTimeAsync(9999);
        expect(customFetch).toHaveBeenCalledTimes(1);

        // Advance to 10000ms (times out)
        await vi.advanceTimersByTimeAsync(1);
        await assertion;

        // Verify exactly one transport call (no retries)
        expect(customFetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("8. Missing Credentials & Error Propagation (503 SERVICE_UNAVAILABLE)", () => {
    it("yields 503 SERVICE_UNAVAILABLE when API key is missing in live mode", () => {
      expect(
        () =>
          new OpenRouterClient({
            env: { INTEGRATION_MODE: "live" }, // missing OPENROUTER_API_KEY
          })
      ).toThrowErrorMatchingInlineSnapshot(`
        [AppError: Missing or blank OPENROUTER_API_KEY for live integration mode]
      `);
    });

    it("propagates upstream errors with no fixture substitution in live mode", async () => {
      const failingFetch = vi.fn().mockResolvedValue(
        createMockResponse(500, {
          error: { message: "Internal server error from upstream provider" },
        })
      );

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-or-test" },
        fetch: failingFetch as unknown as typeof globalThis.fetch,
      });

      const searchAi = new SearchResourcesAi(client);
      await expect(searchAi.searchAcademicResources("Gradient Descent")).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(AppError);
          const appErr = err as AppError;
          expect(appErr.statusCode).toBe(502);
          expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
          return true;
        }
      );

      const qaAi = new ResourceQaAi(client);
      await expect(
        qaAi.answerResourceQuestion(sampleConcept, "How does update direction work?")
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        return true;
      });
    });
  });
});
