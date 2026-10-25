import { describe, it, expect, vi, beforeEach } from "vitest";
import { remark } from "remark";
import remarkMath from "remark-math";
import type { Root, Node, Link, Definition, Parent } from "mdast";
import {
  OpenRouterClient,
  GenerateLearningPageAi,
  fixtureGenerateLearningPage,
  FIXTURE_33_CONCEPTS,
} from "../../../src/server/ai/index.js";
import { generatedLearningPageSchema } from "../../../src/contracts/ai.js";
import { DomainErrorCode } from "../../../src/contracts/errors.js";
import type { ConceptNode } from "../../../src/contracts/course.js";

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

describe("P5-C-02: GenerateLearningPageAi Unit Tests", () => {
  const canonicalConcept = FIXTURE_33_CONCEPTS.find(
    (n) => n.label === "Gradient Descent"
  )!;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Deterministic Fixture & Structure", () => {
    it("generates complete structured Markdown with required sections and math", async () => {
      const fetchSpy = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: fetchSpy as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      const content = await pipeline.generateLearningPage(canonicalConcept);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(content.length).toBeGreaterThanOrEqual(500);
      expect(content.length).toBeLessThanOrEqual(15000);

      // Verify required instructional sections
      expect(content).toContain("## Formal Definition");
      expect(content).toContain("## Intuition");
      expect(content).toContain("## Mathematical Formulation");
      expect(content).toContain("## Worked Examples");
      expect(content).toContain("## Common Pitfalls");

      // Verify LaTeX math notations
      expect(content).toContain("$$");
      expect(content).toContain("\\theta");
      expect(content).toContain("\\nabla J");

      // Verify computed numerical worked example
      expect(content).toContain("Iteration 1");
      expect(content).toContain("Iteration 2");
      expect(content).toContain("Iteration 3");
      expect(content).toContain("23.04");
      expect(content).toContain("14.7456");

      // Validates against schema
      expect(generatedLearningPageSchema.safeParse({ content }).success).toBe(true);
    });

    it("generates valid content for non-canonical concepts with optimization note", () => {
      const otherConcept = FIXTURE_33_CONCEPTS.find(
        (n) => n.label !== "Gradient Descent"
      )!;
      const fixtureOutput = fixtureGenerateLearningPage(otherConcept);
      expect(fixtureOutput.content).toContain(otherConcept.label);
      expect(fixtureOutput.content).toContain("worked numerical example illustrates");
      expect(fixtureOutput.content.length).toBeGreaterThanOrEqual(500);
    });
  });

  describe("2. Markdown Sanitization & AST Security", () => {
    it("strips raw HTML, script tags, unsafe links/references while preserving math and safe links", async () => {
      const maliciousPayload = JSON.stringify({
        content: `# Test Concept

## Formal Definition
Definition with <script>alert("xss")</script> and <img src="x" onerror="evil()" />.

## Intuition
Safe link: [Safe Docs](https://example.com/docs).
Dangerous links:
- [JS Link](javascript:alert(1))
- [Obfuscated Link](jav&#x61;script:alert(2))
- [Mixed Case](JaVaScRiPt:alert(3))
- [Relative Link](/secret/path)
- [Reference Link][bad_ref]

## Mathematical Formulation
Inline math $x < y$ and block:
$$
\\begin{aligned}
\\theta_{t+1} &= \\theta_t - \\eta \\nabla J(\\theta_t) \\\\
\\alpha &< \\beta
\\end{aligned}
$$

## Worked Examples
Detailed calculations with $$\\theta = 2.8$$.

## Common Pitfalls
Avoid bad practices.

\`\`\`html
<script>alert("in code block")</script>
\`\`\`

[bad_ref]: javascript:alert("evil_ref")
`,
      });

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(maliciousPayload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      const sanitized = await pipeline.generateLearningPage(canonicalConcept);

      // Verify no raw HTML or script tags survived outside code blocks
      const processor = remark().use(remarkMath);
      const ast = processor.parse(sanitized) as Root;

      function inspectAst(node: Node): void {
        expect(node.type).not.toBe("html");
        if (node.type === "link") {
          const link = node as unknown as Link;
          expect(link.url.startsWith("https://") || link.url.startsWith("http://")).toBe(true);
        }
        if (node.type === "definition") {
          const def = node as unknown as Definition;
          expect(def.url.startsWith("https://") || def.url.startsWith("http://")).toBe(true);
        }
        if ("children" in node && Array.isArray((node as unknown as Parent).children)) {
          for (const child of (node as unknown as Parent).children) {
            inspectAst(child);
          }
        }
      }

      inspectAst(ast);

      // Check text content
      expect(sanitized).not.toContain('<script>alert("xss")</script>');
      expect(sanitized).not.toContain('<img src="x"');
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).not.toContain("bad_ref");
      expect(sanitized).toContain("[Safe Docs](https://example.com/docs)");
      expect(sanitized).toContain("JS Link"); // unwrapped
      expect(sanitized).toContain("Obfuscated Link"); // unwrapped

      // Math preserved
      expect(sanitized).toContain("\\theta");
      expect(sanitized).toContain("x < y");
      expect(sanitized).toContain("\\begin{aligned}");
      expect(sanitized).toContain("&");

      // Code block preserved
      expect(sanitized).toContain('```html\n<script>alert("in code block")</script>\n```');
    });

    it("rejects with 502 BAD_GATEWAY if output becomes too short (<500 chars) after sanitization", async () => {
      // 600 characters of raw script tags that will get stripped to almost empty
      const scriptSpam = "<script>" + "alert('xss');".repeat(50) + "</script>";
      const payload = JSON.stringify({
        content: `# Short Guide\n${scriptSpam}\nShort text here.`,
      });

      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(payload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      await expect(pipeline.generateLearningPage(canonicalConcept)).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: "Learning page content is invalid after sanitization",
      });
    });
  });

  describe("3. Error Propagation & Boundaries", () => {
    it("rejects with 502 for malformed JSON from provider", async () => {
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse("Not valid JSON"));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      await expect(pipeline.generateLearningPage(canonicalConcept)).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("rejects with 502 if raw content is under 500 characters", async () => {
      const payload = JSON.stringify({ content: "Too short guide" });
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(payload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      await expect(pipeline.generateLearningPage(canonicalConcept)).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("rejects with 502 if raw content exceeds 15000 characters", async () => {
      const payload = JSON.stringify({ content: "A".repeat(15001) });
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(payload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      await expect(pipeline.generateLearningPage(canonicalConcept)).rejects.toMatchObject({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
      });
    });

    it("succeeds with valid boundary content (500 characters)", async () => {
      const payload = JSON.stringify({ content: "Valid markdown content ".repeat(25) }); // 575 chars
      const mockFetch = vi.fn().mockResolvedValue(createMockResponse(payload));
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      const result = await pipeline.generateLearningPage(canonicalConcept);
      expect(result.length).toBeGreaterThanOrEqual(500);
    });

    it("throws 503 SERVICE_UNAVAILABLE when live credentials are missing with no fixture fallback", () => {
      expect(() => {
        new OpenRouterClient({
          env: { INTEGRATION_MODE: "live" }, // No API key
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
      const pipeline = new GenerateLearningPageAi(client);

      vi.useFakeTimers();
      try {
        let settled = false;
        let caughtError: unknown;
        const pagePromise = pipeline.generateLearningPage(canonicalConcept);

        pagePromise
          .catch((err) => {
            caughtError = err;
          })
          .finally(() => {
            settled = true;
          });

        // Remains pending at 59,999ms
        await vi.advanceTimersByTimeAsync(59999);
        expect(settled).toBe(false);

        // Rejects at 60,000ms deadline
        await vi.advanceTimersByTimeAsync(1);
        await expect(pagePromise).rejects.toMatchObject({
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

    it("rejects with 400 VALIDATION_ERROR before provider call on invalid concept input", async () => {
      const mockFetch = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      const malformedConcept = {
        ...canonicalConcept,
        label: "", // Empty label fails conceptNodeSchema
      };

      await expect(
        pipeline.generateLearningPage(malformedConcept as unknown as ConceptNode)
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid learning page input",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects with 400 VALIDATION_ERROR on cross-course prerequisite ancestor", async () => {
      const mockFetch = vi.fn();
      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "live", OPENROUTER_API_KEY: "sk-test" },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });
      const pipeline = new GenerateLearningPageAi(client);

      const crossCourseAncestor: ConceptNode = {
        ...FIXTURE_33_CONCEPTS[0]!,
        courseId: "99999999-9999-4999-8999-999999999999", // Different course ID
      };

      await expect(
        pipeline.generateLearningPage(canonicalConcept, [crossCourseAncestor])
      ).rejects.toMatchObject({
        code: DomainErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        message: "Invalid learning page input",
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("succeeds for root concept with no prerequisite ancestors", async () => {
      const client = new OpenRouterClient({ env: { INTEGRATION_MODE: "fixture" } });
      const pipeline = new GenerateLearningPageAi(client);

      const rootConcept = FIXTURE_33_CONCEPTS[0]!;
      const content = await pipeline.generateLearningPage(rootConcept, []);

      expect(content.length).toBeGreaterThanOrEqual(500);
      expect(generatedLearningPageSchema.safeParse({ content }).success).toBe(true);
    });
  });
});
