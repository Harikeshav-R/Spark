import type { UUID } from "../../../contracts/common.js";
import type { ConceptNode } from "../../../contracts/course.js";
import type { ConceptQuizQuestion } from "../../../contracts/learning.js";

export interface FixtureQuizQuestionHints {
  questionId: UUID;
  hints: [string, string, string];
}

export function fixtureGenerateQuizHints(
  concept: ConceptNode,
  questions: readonly ConceptQuizQuestion[],
): { questions: FixtureQuizQuestionHints[] } {
  const label = concept.label.trim();

  return {
    questions: questions.map((q) => ({
      questionId: q.id,
      hints: [
        `Recall the foundational definition and primary role of ${label}.`,
        `Consider how the core mechanisms of ${label} apply to this specific problem.`,
        `Evaluate the conditions step-by-step to rule out incorrect assumptions before deciding.`,
      ],
    })),
  };
}
