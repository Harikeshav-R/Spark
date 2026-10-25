import type { GeneratedPollQuestion } from "../../../contracts/ai.js";

export function fixturePollQuestion(): GeneratedPollQuestion {
  return {
    question:
      "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
    expectedAnswer:
      "An excessively large learning rate causes the parameters to overshoot the local minimum, oscillate wildly, or diverge.",
  };
}
