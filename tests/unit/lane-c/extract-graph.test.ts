import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { AppError, DomainErrorCode } from "../../../src/contracts/errors.js";
import {
  DEFAULT_MODELS,
  ExtractGraphAi,
  OpenRouterClient,
  fixturePrerequisiteGraph,
} from "../../../src/server/ai/index.js";
import {
  MAX_SYLLABUS_BYTES,
  assertSyllabusSize,
  hashSyllabusPdf,
  processSyllabusPdf,
} from "../../../src/server/core/index.js";

async function createPdf(pages: number, startHeight = 601): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([612, startHeight + i]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function createMockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("P2-C-01: Syllabus PDF Bounded Ingestion & Prerequisite Graph Extraction", () => {
  describe("1. PDF Bounding & Processing (Core Ingestion)", () => {
    it("slices 1-page PDF: totalPages 1, processedPages 1, truncated false", async () => {
      const bytes = await createPdf(1);
      const processed = await processSyllabusPdf(bytes);

      expect(processed.totalPages).toBe(1);
      expect(processed.processedPages).toBe(1);
      expect(processed.truncated).toBe(false);

      const loaded = await PDFDocument.load(processed.pdfBytes);
      expect(loaded.getPageCount()).toBe(1);
      expect(loaded.getPages()[0]?.getHeight()).toBe(601);
    });

    it("slices 10-page PDF: totalPages 10, processedPages 10, truncated false", async () => {
      const bytes = await createPdf(10);
      const processed = await processSyllabusPdf(bytes);

      expect(processed.totalPages).toBe(10);
      expect(processed.processedPages).toBe(10);
      expect(processed.truncated).toBe(false);

      const loaded = await PDFDocument.load(processed.pdfBytes);
      expect(loaded.getPageCount()).toBe(10);
      expect(loaded.getPages().map((p) => p.getHeight())).toEqual(
        Array.from({ length: 10 }, (_, i) => 601 + i),
      );
    });

    it("slices 11-page PDF: totalPages 11, processedPages 10, truncated true", async () => {
      const bytes = await createPdf(11);
      const processed = await processSyllabusPdf(bytes);

      expect(processed.totalPages).toBe(11);
      expect(processed.processedPages).toBe(10);
      expect(processed.truncated).toBe(true);

      const loaded = await PDFDocument.load(processed.pdfBytes);
      expect(loaded.getPageCount()).toBe(10);
      expect(loaded.getPages().map((p) => p.getHeight())).toEqual(
        Array.from({ length: 10 }, (_, i) => 601 + i),
      );
    });

    it("computes deterministic SHA-256 hash on original bytes", async () => {
      const bytes = await createPdf(3);
      const hash1 = hashSyllabusPdf(bytes);
      const hash2 = hashSyllabusPdf(bytes);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects empty syllabus PDF with 400 BAD_REQUEST", () => {
      expect(() => assertSyllabusSize(Buffer.alloc(0))).toThrow(
        expect.objectContaining({
          code: DomainErrorCode.BAD_REQUEST,
          statusCode: 400,
          message: "Syllabus PDF is empty",
        }),
      );
    });

    it("passes exact 50 MiB limit through size gate, but rejects 50 MiB + 1 byte with 413", () => {
      const exact50 = Buffer.alloc(MAX_SYLLABUS_BYTES);
      expect(() => assertSyllabusSize(exact50)).not.toThrow();

      const oversized = Buffer.alloc(MAX_SYLLABUS_BYTES + 1);
      expect(() => assertSyllabusSize(oversized)).toThrow(
        expect.objectContaining({
          code: DomainErrorCode.PAYLOAD_TOO_LARGE,
          statusCode: 413,
          message: "Syllabus PDF exceeds 50 MiB limit",
        }),
      );
    });

    it("rejects zero-page PDF with 400 BAD_REQUEST", async () => {
      const doc = await PDFDocument.create();
      const bytes = Buffer.from(await doc.save({ addDefaultPage: false }));

      await expect(processSyllabusPdf(bytes)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.BAD_REQUEST);
        expect(appErr.message).toBe("Invalid or unsupported syllabus PDF");
        return true;
      });
    });

    it("rejects malformed PDF bytes with 400 BAD_REQUEST", async () => {
      const malformed = Buffer.from("Not a real PDF header or content");

      await expect(processSyllabusPdf(malformed)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.code).toBe(DomainErrorCode.BAD_REQUEST);
        expect(appErr.message).toBe("Invalid or unsupported syllabus PDF");
        return true;
      });
    });
  });

  describe("2. Pipeline in Fixture Mode (Offline Determinism)", () => {
    it("returns canonical 33 concepts / 34 edges and never calls network", async () => {
      const throwingFetch = vi.fn().mockImplementation(() => {
        throw new Error("Network fetch must NEVER be invoked in fixture mode");
      });

      const client = new OpenRouterClient({
        env: { INTEGRATION_MODE: "fixture" },
        fetch: throwingFetch as unknown as typeof globalThis.fetch,
      });

      const pipeline = new ExtractGraphAi(client);
      expect(pipeline.getIntegrationMode()).toBe("fixture");

      const bytes11 = await createPdf(11);
      const result = await pipeline.extractPrerequisiteGraph(bytes11);

      expect(throwingFetch).not.toHaveBeenCalled();
      expect(result.totalPages).toBe(11);
      expect(result.processedPages).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.concepts).toHaveLength(33);
      expect(result.edges).toHaveLength(34);

      const expectedFixture = fixturePrerequisiteGraph();
      expect(result.concepts).toEqual(expectedFixture.concepts);
      expect(result.edges).toEqual(expectedFixture.edges);
      expect(result.edges).toContainEqual(["Vectors", "Matrices"]);
    });
  });

  describe("3. Live Transport Offline Interception & Bounding Verification", () => {
    it("exercises live transport, slices first 10 pages, sends cloudflare-ai plugin, and parses graph", async () => {
      const validGraph = {
        concepts: [
          {
            label: "Linear Algebra",
            description: "Study of vectors, matrices, and linear spaces",
            category: "Mathematics",
            difficulty: 2,
          },
          {
            label: "Multivariable Calculus",
            description: "Differential and integral calculus across multiple dimensions",
            category: "Mathematics",
            difficulty: 3,
          },
        ],
        edges: [["Linear Algebra", "Multivariable Calculus"]],
      };
      interface CapturedRequestBody {
        model?: string;
        plugins?: Array<{ id: string; pdf?: { engine: string } }>;
        messages?: Array<{
          role: string;
          content: Array<{ type: string; file?: { filename: string; file_data: string } }>;
        }>;
      }
      const captured = {
        requestUrl: "",
        requestBody: undefined as CapturedRequestBody | undefined,
      };

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        captured.requestUrl = url;
        captured.requestBody = JSON.parse(init?.body as string) as CapturedRequestBody;
        return createMockResponse(200, {
          id: "chatcmpl-live-extract-1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(validGraph),
              },
              finish_reason: "stop",
            },
          ],
        });
      });

      const client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "sk-or-test-key-p2-c-01",
        },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });

      const pipeline = new ExtractGraphAi(client);
      expect(pipeline.getIntegrationMode()).toBe("live");

      // 11-page PDF with heights 601 through 611
      const bytes11 = await createPdf(11, 601);
      const result = await pipeline.extractPrerequisiteGraph(bytes11);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(captured.requestUrl).toBe("https://openrouter.ai/api/v1/chat/completions");

      // Verify model and plugin configuration on request
      expect(captured.requestBody?.model).toBe(DEFAULT_MODELS.deep);
      expect(captured.requestBody?.plugins).toEqual([
        {
          id: "file-parser",
          pdf: { engine: "cloudflare-ai" },
        },
      ]);

      // Inspect outbound file attachment
      const messages = captured.requestBody?.messages ?? [];
      const userMsg = messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      const filePart = userMsg?.content.find((part) => part.type === "file");
      expect(filePart).toBeDefined();
      expect(filePart?.file?.filename).toBe("syllabus.pdf");

      const fileDataPrefix = "data:application/pdf;base64,";
      expect(filePart?.file?.file_data.startsWith(fileDataPrefix)).toBe(true);

      const base64Data = filePart?.file?.file_data.slice(fileDataPrefix.length) ?? "";
      const outboundBytes = Buffer.from(base64Data, "base64");
      const outboundDoc = await PDFDocument.load(outboundBytes);

      // Verify that EXACTLY 10 pages in original order were transmitted (page 11 was omitted)
      expect(outboundDoc.getPageCount()).toBe(10);
      expect(outboundDoc.getPages().map((p) => p.getHeight())).toEqual(
        Array.from({ length: 10 }, (_, i) => 601 + i),
      );

      // Verify returned extraction DTO matches live graph with local page metadata
      expect(result.totalPages).toBe(11);
      expect(result.processedPages).toBe(10);
      expect(result.truncated).toBe(true);
      expect(result.concepts).toEqual(validGraph.concepts);
      expect(result.edges).toEqual(validGraph.edges);
    });

    it("rejects cyclic graph returned by provider with 422 UNPROCESSABLE_ENTITY", async () => {
      const cyclicGraph = {
        concepts: [
          {
            label: "Concept A",
            description: "Concept A foundational principles description",
            category: "Foundations",
            difficulty: 1,
          },
          {
            label: "Concept B",
            description: "Concept B dependent applications description",
            category: "Foundations",
            difficulty: 2,
          },
        ],
        edges: [
          ["Concept A", "Concept B"],
          ["Concept B", "Concept A"],
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, {
          id: "chatcmpl-live-extract-cycle",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(cyclicGraph),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "sk-or-test-key-p2-c-01",
        },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });

      const pipeline = new ExtractGraphAi(client);
      const bytes = await createPdf(2);

      await expect(pipeline.extractPrerequisiteGraph(bytes)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(422);
        expect(appErr.code).toBe(DomainErrorCode.UNPROCESSABLE_ENTITY);
        expect(appErr.message).toContain("Knowledge graph contains a cycle");
        return true;
      });
    });

    it.each([
      {
        reason: "missing edge source",
        graph: {
          concepts: [
            { label: "A", description: "Description for concept A", category: "Cat", difficulty: 1 },
          ],
          edges: [["Ghost", "A"]],
        },
        expectedMatch: "Edge source not found in concept nodes: Ghost",
      },
      {
        reason: "missing edge target",
        graph: {
          concepts: [
            { label: "A", description: "Description for concept A", category: "Cat", difficulty: 1 },
          ],
          edges: [["A", "Ghost"]],
        },
        expectedMatch: "Edge target not found in concept nodes: Ghost",
      },
      {
        reason: "self edge",
        graph: {
          concepts: [
            { label: "A", description: "Description for concept A", category: "Cat", difficulty: 1 },
          ],
          edges: [["A", "A"]],
        },
        expectedMatch: "Self-edge detected: A -> A",
      },
      {
        reason: "duplicate edge",
        graph: {
          concepts: [
            { label: "A", description: "Description for concept A", category: "Cat", difficulty: 1 },
            { label: "B", description: "Description for concept B", category: "Cat", difficulty: 2 },
          ],
          edges: [
            ["A", "B"],
            ["A", "B"],
          ],
        },
        expectedMatch: "Duplicate edge: A -> B",
      },
      {
        reason: "duplicate concept label",
        graph: {
          concepts: [
            { label: "A", description: "First instance description", category: "Cat", difficulty: 1 },
            { label: "A", description: "Second instance description", category: "Cat", difficulty: 2 },
          ],
          edges: [],
        },
        expectedMatch: "Duplicate concept label: A",
      },
    ])("rejects invalid graph ($reason) with 422 UNPROCESSABLE_ENTITY", async ({ graph, expectedMatch }) => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, {
          id: "chatcmpl-invalid-graph",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(graph),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "sk-or-test-key-p2-c-01",
        },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });

      const pipeline = new ExtractGraphAi(client);
      const bytes = await createPdf(2);

      await expect(pipeline.extractPrerequisiteGraph(bytes)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(422);
        expect(appErr.code).toBe(DomainErrorCode.UNPROCESSABLE_ENTITY);
        expect(appErr.message).toContain(expectedMatch);
        return true;
      });
    });

    it("rejects provider malformed JSON with 502 BAD_GATEWAY without falling back to fixture", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, {
          id: "chatcmpl-bad-json",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "{ corrupted json not parseable",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "sk-or-test-key-p2-c-01",
        },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });

      const pipeline = new ExtractGraphAi(client);
      const bytes = await createPdf(2);

      await expect(pipeline.extractPrerequisiteGraph(bytes)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("AI provider response was not valid JSON");
        return true;
      });
    });

    it("rejects schema-invalid difficulty (e.g. 10) with 502 BAD_GATEWAY", async () => {
      const invalidDifficultyGraph = {
        concepts: [
          {
            label: "Calculus",
            description: "Differentiation and integration",
            category: "Math",
            difficulty: 10, // Must be 1..5
          },
        ],
        edges: [],
      };

      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(200, {
          id: "chatcmpl-bad-diff",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify(invalidDifficultyGraph),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );

      const client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: "sk-or-test-key-p2-c-01",
        },
        fetch: mockFetch as unknown as typeof globalThis.fetch,
      });

      const pipeline = new ExtractGraphAi(client);
      const bytes = await createPdf(2);

      await expect(pipeline.extractPrerequisiteGraph(bytes)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(502);
        expect(appErr.code).toBe(DomainErrorCode.BAD_GATEWAY);
        expect(appErr.message).toBe("AI provider response did not match expected schema");
        return true;
      });
    });

    it("rejects client initialization when live mode is configured without API key (503)", () => {
      expect(() => {
        new OpenRouterClient({
          env: {
            INTEGRATION_MODE: "live",
            OPENROUTER_API_KEY: "",
          },
        });
      }).toThrow(
        expect.objectContaining({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
          message: "Missing or blank OPENROUTER_API_KEY for live integration mode",
        }),
      );
    });
  });
});
