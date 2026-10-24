import OpenAI from "openai";
import { z } from "zod";
import { AppError, DomainErrorCode } from "../../../contracts/errors.js";

export const AI_CAPABILITIES = [
  "extractPrerequisiteGraph",
  "detectConcepts",
  "generatePollQuestion",
  "evaluatePollResponse",
  "socraticTutorTurn",
  "checkUnderstanding",
  "summarizeMisconceptions",
  "summarizeLecture",
  "suggestInterventions",
  "generateLearningPage",
  "generateQuizQuestions",
  "searchAcademicResources",
  "answerResourceQuestion",
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export type ModelTier = "fast" | "deep" | "search";

export interface CapabilityPolicy {
  tier: ModelTier;
  timeoutMs: number;
  maxTokens: number;
}

export const CAPABILITY_POLICIES: Record<AiCapability, CapabilityPolicy> = {
  extractPrerequisiteGraph: { tier: "deep", timeoutMs: 120000, maxTokens: 4000 },
  detectConcepts: { tier: "fast", timeoutMs: 5000, maxTokens: 300 },
  generatePollQuestion: { tier: "fast", timeoutMs: 15000, maxTokens: 600 },
  evaluatePollResponse: { tier: "fast", timeoutMs: 8000, maxTokens: 500 },
  socraticTutorTurn: { tier: "deep", timeoutMs: 15000, maxTokens: 800 },
  checkUnderstanding: { tier: "fast", timeoutMs: 5000, maxTokens: 200 },
  summarizeMisconceptions: { tier: "fast", timeoutMs: 8000, maxTokens: 800 },
  summarizeLecture: { tier: "deep", timeoutMs: 15000, maxTokens: 1500 },
  suggestInterventions: { tier: "deep", timeoutMs: 30000, maxTokens: 1200 },
  generateLearningPage: { tier: "deep", timeoutMs: 60000, maxTokens: 3500 },
  generateQuizQuestions: { tier: "deep", timeoutMs: 60000, maxTokens: 2500 },
  searchAcademicResources: { tier: "search", timeoutMs: 10000, maxTokens: 1000 },
  answerResourceQuestion: { tier: "search", timeoutMs: 10000, maxTokens: 1200 },
};

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "minimax/minimax-m3.1-flash:free",
  deep: "nvidia/nemotron-3-ultra-550b-a55b:free",
  search: "perplexity/sonar-pro",
};

export interface OpenRouterClientOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}

export interface OpenRouterCompletionRequest<T> {
  capability: AiCapability;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  schema: z.ZodType<T>;
  fixture: () => unknown | Promise<unknown>;
}

export class OpenRouterClient {
  private readonly mode: "fixture" | "live";
  private readonly apiKey: string | undefined;
  private readonly models: Record<ModelTier, string>;
  private readonly customFetch: typeof globalThis.fetch | undefined;
  private readonly openai: OpenAI | null;

  constructor(options?: OpenRouterClientOptions) {
    const env = options?.env ?? process.env;
    const rawMode = env.INTEGRATION_MODE;
    const mode = rawMode && rawMode.trim().length > 0 ? rawMode.trim() : "fixture";

    if (mode !== "fixture" && mode !== "live") {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: `Invalid INTEGRATION_MODE: '${mode}'. Must be 'fixture' or 'live'.`,
      });
    }

    this.mode = mode;
    this.customFetch = options?.fetch;

    const fastModel = env.OPENROUTER_FAST_MODEL?.trim() || DEFAULT_MODELS.fast;
    const deepModel = env.OPENROUTER_DEEP_MODEL?.trim() || DEFAULT_MODELS.deep;
    const searchModel = env.OPENROUTER_SEARCH_MODEL?.trim() || DEFAULT_MODELS.search;

    this.models = {
      fast: fastModel,
      deep: deepModel,
      search: searchModel,
    };

    if (this.mode === "live") {
      const apiKey = env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) {
        throw new AppError({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
          message: "Missing or blank OPENROUTER_API_KEY for live integration mode",
        });
      }
      this.apiKey = apiKey;
      this.openai = new OpenAI({
        apiKey: this.apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        maxRetries: 0,
        fetch: this.customFetch,
      });
    } else {
      this.apiKey = undefined;
      this.openai = null;
    }
  }

  getIntegrationMode(): "fixture" | "live" {
    return this.mode;
  }

  getModel(tier: ModelTier): string {
    return this.models[tier];
  }

  async complete<T>(request: OpenRouterCompletionRequest<T>): Promise<T> {
    const policy = CAPABILITY_POLICIES[request.capability];
    if (!policy) {
      throw new AppError({
        code: DomainErrorCode.BAD_REQUEST,
        statusCode: 400,
        message: `Unknown AI capability: ${request.capability}`,
      });
    }

    if (this.mode === "fixture") {
      let rawFixture: unknown;
      try {
        rawFixture = await request.fixture();
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "Fixture execution failed",
          cause: err,
        });
      }

      const parsed = request.schema.safeParse(rawFixture);
      if (!parsed.success) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "Fixture returned schema-invalid response",
          cause: parsed.error,
        });
      }

      return parsed.data;
    }

    if (!this.openai) {
      throw new AppError({
        code: DomainErrorCode.SERVICE_UNAVAILABLE,
        statusCode: 503,
        message: "OpenAI client not initialized for live mode",
      });
    }

    const model = this.models[policy.tier];
    const abortController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, policy.timeoutMs);

    try {
      const completion = await this.openai.chat.completions.create(
        {
          model,
          messages: request.messages,
          max_tokens: policy.maxTokens,
        },
        {
          signal: abortController.signal,
          timeout: policy.timeoutMs,
          maxRetries: 0,
        }
      );

      const choice = completion.choices?.[0];
      if (!choice) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "AI provider returned empty choices",
        });
      }

      if (choice.finish_reason === "length") {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "AI provider response was truncated due to length limits",
        });
      }

      if (choice.message?.refusal) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: `AI provider refused request: ${choice.message.refusal}`,
        });
      }

      const rawContent = choice.message?.content;
      if (!rawContent || !rawContent.trim()) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "AI provider returned empty content",
        });
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawContent);
      } catch (jsonErr) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "AI provider response was not valid JSON",
          cause: jsonErr,
        });
      }

      const validated = request.schema.safeParse(parsedJson);
      if (!validated.success) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "AI provider response did not match expected schema",
          cause: validated.error,
        });
      }

      return validated.data;
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }

      if (
        timedOut ||
        abortController.signal.aborted ||
        (err instanceof Error &&
          (err.name === "AbortError" ||
            err.name === "APIConnectionTimeoutError" ||
            err.message.toLowerCase().includes("timeout")))
      ) {
        throw new AppError({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
          message: `AI capability '${request.capability}' timed out after ${policy.timeoutMs}ms`,
          cause: err,
        });
      }

      if (
        err instanceof OpenAI.AuthenticationError ||
        err instanceof OpenAI.PermissionDeniedError ||
        (typeof err === "object" &&
          err !== null &&
          "status" in err &&
          (err.status === 401 || err.status === 403))
      ) {
        throw new AppError({
          code: DomainErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503,
          message: "AI provider authentication or authorization failed",
          cause: err,
        });
      }

      if (
        typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err.status === 504 || err.status === 408)
      ) {
        throw new AppError({
          code: DomainErrorCode.GATEWAY_TIMEOUT,
          statusCode: 504,
          message: `AI provider upstream timeout (${String(err.status)})`,
          cause: err,
        });
      }

      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      throw new AppError({
        code: DomainErrorCode.BAD_GATEWAY,
        statusCode: 502,
        message: `AI provider request failed: ${errorMsg}`,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
