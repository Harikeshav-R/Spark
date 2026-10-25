import type { ConceptNode } from "../../../contracts/course.js";
import type { CheckUnderstandingResponse } from "../../../contracts/ai.js";

const SUPPORTED_DIALOGUES: Record<string, string> = {
  backpropagation: "the chain rule combines local gradients through intermediate activations",
  derivatives: "a derivative is the instantaneous rate of change: the limit of the difference quotient as the input change approaches zero.",
};

export function fixtureCheckUnderstanding(
  concept: ConceptNode,
  tutorQuestion: string,
  studentAnswer: string
): CheckUnderstandingResponse {
  const trimmedQuestion = tutorQuestion.trim();
  if (trimmedQuestion.length === 0) {
    return {
      understandingConfirmed: false,
      rationale: "The explanation does not establish the target concept's mechanism in this fixture dialogue.",
    };
  }

  const normalizedLabel = concept.label.trim().toLowerCase();
  const normalizedAnswer = studentAnswer.trim().toLowerCase().replace(/\s+/g, " ");

  const expectedExplanation = SUPPORTED_DIALOGUES[normalizedLabel];
  if (expectedExplanation && normalizedAnswer === expectedExplanation) {
    return {
      understandingConfirmed: true,
      rationale: "The explanation connects the target concept to its underlying mechanism.",
    };
  }

  return {
    understandingConfirmed: false,
    rationale: "The explanation does not establish the target concept's mechanism in this fixture dialogue.",
  };
}
