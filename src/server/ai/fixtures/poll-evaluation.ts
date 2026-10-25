import type { EvaluatedPollResponse } from "../../../contracts/ai.js";

export function fixturePollEvaluation(studentAnswer: string): EvaluatedPollResponse {
  const answerLower = studentAnswer.toLowerCase();
  let outcome: EvaluatedPollResponse["outcome"];
  let feedback: string;

  if (
    answerLower.includes("overshoot") ||
    answerLower.includes("diverge") ||
    answerLower.includes("oscillat")
  ) {
    outcome = "correct";
    feedback =
      "Excellent reasoning! You correctly recognized that an excessive learning rate destabilizes updates and causes divergence.";
  } else if (
    answerLower.includes("fast") ||
    answerLower.includes("slow") ||
    answerLower.includes("jump")
  ) {
    outcome = "partial";
    feedback =
      "Partially correct. While the step size is indeed problematic, specify that updates overshoot the minimum and may diverge.";
  } else {
    outcome = "wrong";
    feedback =
      "Incorrect. An excessively large step size does not accelerate convergence; it causes divergence or wild oscillations.";
  }

  return { outcome, feedback };
}
