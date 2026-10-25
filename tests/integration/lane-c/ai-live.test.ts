import { describe, it, expect, beforeAll } from "vitest";
import {
  OpenRouterClient,
  GeneratePollAi,
  EvaluatePollAi,
  GenerateQuizAi,
  GenerateQuizHintsAi,
  SearchResourcesAi,
} from "../../../src/server/ai/index.js";
import {
  generatedPollQuestionSchema,
  evaluatedPollResponseSchema,
  generatedQuizQuestionsSchema,
  academicResourcesSchema,
} from "../../../src/contracts/ai.js";
import { conceptNodeSchema } from "../../../src/contracts/course.js";
import { conceptQuizQuestionSchema } from "../../../src/contracts/learning.js";
import { generatedQuizHintsOutputSchema } from "../../../src/server/ai/pipelines/generate-quiz-hints.js";

const rawIntegrationMode = process.env.INTEGRATION_MODE?.trim();
const rawApiKey = process.env.OPENROUTER_API_KEY?.trim();

// Explicit fixture mode always skips live tests even when a key is present.
// Explicit live mode always selects live tests, including when key is absent so the real constructor fails loudly.
// Otherwise select live tests only when a nonblank key exists.
const shouldRunLive =
  rawIntegrationMode === "fixture"
    ? false
    : rawIntegrationMode === "live"
      ? true
      : Boolean(rawApiKey && rawApiKey.length > 0);

const shouldSkip = !shouldRunLive;

describe.skipIf(shouldSkip)(
  "AiLive: P7-C-01 OpenRouter production verification",
  { retry: 0 },
  () => {
    let client: OpenRouterClient;

    beforeAll(() => {
      client = new OpenRouterClient({
        env: {
          INTEGRATION_MODE: "live",
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
          OPENROUTER_FAST_MODEL: "anthropic/claude-haiku-4.5",
          OPENROUTER_DEEP_MODEL: "anthropic/claude-sonnet-4.5",
          OPENROUTER_SEARCH_MODEL: "perplexity/sonar-pro",
        },
      });
    });

    const concept = conceptNodeSchema.parse({
      id: "10000000-0000-4000-8000-000000000001",
      courseId: "20000000-0000-4000-8000-000000000001",
      label: "Gradient Descent",
      description:
        "Iterative minimization of a differentiable loss by moving parameters opposite its gradient; the learning rate controls step size and convergence.",
      category: "Optimization",
      difficulty: 2,
      createdAt: "2026-10-24T00:00:00.000Z",
    });

    it(
      "generates conceptual poll question using fast reasoning model",
      async () => {
        const recentTranscript =
          "The gradient points in the direction of steepest increase. Gradient descent subtracts the learning rate times the gradient to reduce loss. An excessively large learning rate can overshoot a minimum.";
        const response = await new GeneratePollAi(client).generatePollQuestion(
          concept,
          recentTranscript
        );
        const parsed = generatedPollQuestionSchema.parse(response);
        expect(parsed.question).not.toBe(parsed.expectedAnswer);
      },
      20000
    );

    it(
      "evaluates a correct poll answer using fast evaluation model",
      async () => {
        const question =
          "Why does gradient descent subtract the gradient from the parameters?";
        const rubric =
          "The gradient points toward steepest increase in loss, so moving in its negative direction with a sufficiently small positive learning rate locally decreases loss.";
        const answer =
          "The gradient points uphill in loss. Subtracting a small positive multiple moves downhill and locally reduces the loss.";
        const response = await new EvaluatePollAi(client).evaluatePollResponse(
          question,
          rubric,
          answer
        );
        const parsed = evaluatedPollResponseSchema.parse(response);
        expect(parsed.outcome).toBe("correct");
      },
      12000
    );

    it(
      "evaluates an incorrect poll answer using fast evaluation model",
      async () => {
        const question =
          "Why does gradient descent subtract the gradient from the parameters?";
        const rubric =
          "The gradient points toward steepest increase in loss, so moving in its negative direction with a sufficiently small positive learning rate locally decreases loss.";
        const wrongAnswer =
          "The gradient points toward decreasing loss, so subtracting it increases the loss and maximizes the objective.";
        const response = await new EvaluatePollAi(client).evaluatePollResponse(
          question,
          rubric,
          wrongAnswer
        );
        const parsed = evaluatedPollResponseSchema.parse(response);
        expect(parsed.outcome).toBe("wrong");
      },
      12000
    );

    it(
      "generates a 5-question deep quiz followed by three-tier hints",
      async () => {
        const generatedQuestions = await new GenerateQuizAi(
          client
        ).generateQuizQuestions(concept);
        const parsedGenerated = generatedQuizQuestionsSchema.parse({
          questions: generatedQuestions,
        });

        const storedQuestions = parsedGenerated.questions.map((q, idx) => {
          const n = idx + 1;
          return conceptQuizQuestionSchema.parse({
            id: `30000000-0000-4000-8000-00000000000${n}`,
            conceptId: concept.id,
            question: q.question,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            questionOrder: idx,
            createdAt: "2026-10-24T00:00:00.000Z",
          });
        });

        const hints = await new GenerateQuizHintsAi(client).generateQuizHints(
          concept,
          storedQuestions
        );
        const parsedHints = generatedQuizHintsOutputSchema.parse({
          questions: hints,
        });

        expect(parsedHints.questions.map((h) => h.questionId)).toEqual(
          storedQuestions.map((q) => q.id)
        );

        const forbiddenLabelPattern = /\b(option|choice)\s*[a-d]\b/i;
        const directSelectPattern = /\b(is|select|choose|pick)\s+[a-d]\b/i;

        for (let i = 0; i < storedQuestions.length; i++) {
          const q = storedQuestions[i];
          const h = parsedHints.questions[i];
          expect(h.hints).toHaveLength(3);
          const options = [q.optionA, q.optionB, q.optionC, q.optionD];
          const correctText = options[q.correctAnswer]?.trim().toLowerCase();

          for (const hint of h.hints) {
            expect(hint.length).toBeGreaterThanOrEqual(5);
            expect(hint.length).toBeLessThanOrEqual(300);
            expect(forbiddenLabelPattern.test(hint)).toBe(false);
            expect(directSelectPattern.test(hint)).toBe(false);
            if (correctText && correctText.length >= 6) {
              expect(hint.toLowerCase().includes(correctText)).toBe(false);
            }
          }
        }
      },
      130000
    );

    it(
      "searches academic resources using Perplexity academic search model",
      async () => {
        const resources = await new SearchResourcesAi(
          client
        ).searchAcademicResources(
          "Gradient Descent",
          "Stanford CS229 university lecture notes explaining the gradient descent update rule"
        );
        const parsed = academicResourcesSchema.parse({ resources });
        expect(parsed.resources.length).toBeGreaterThanOrEqual(1);

        const citationNumbers = new Set<number>();
        for (const res of parsed.resources) {
          const urlObj = new URL(res.url);
          expect(["http:", "https:"]).toContain(urlObj.protocol);
          expect(urlObj.hostname.length).toBeGreaterThan(0);
          expect(res.title.trim().length).toBeGreaterThan(0);
          expect(res.snippet.trim().length).toBeGreaterThan(0);
          expect(res.citationNumber).toBeGreaterThan(0);
          expect(Number.isInteger(res.citationNumber)).toBe(true);
          expect(citationNumbers.has(res.citationNumber)).toBe(false);
          citationNumbers.add(res.citationNumber);
        }
      },
      15000
    );
  }
);
