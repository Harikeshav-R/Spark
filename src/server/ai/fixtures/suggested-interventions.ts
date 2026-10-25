import type { SuggestedInterventions } from "../../../contracts/ai.js";

const BACKPROP_REGEX =
  /backprop|activation|chain rule|forward pass|backward pass/i;

export function fixtureSuggestedInterventions(
  flawedResponses: { answer: string; outcome: string }[]
): SuggestedInterventions {
  const matchesBackprop = flawedResponses.some((r) =>
    BACKPROP_REGEX.test(r.answer)
  );

  if (matchesBackprop) {
    return {
      misconceptions: [
        "Confusion between forward-pass activation caching required for backward local derivatives and inference-time memory optimization that discards intermediate activations.",
      ],
      recommendations: [
        {
          title: "Diagram activation caching",
          description:
            "Have the teacher draw a two-node scalar computational graph, record the forward activations, and mark which values each local derivative needs during the backward pass.",
          actionablePrompt:
            "Draw a simple computational graph f(x, w) = (x + w)^2 on the board. Step through the forward pass recording intermediate values, then ask: 'Which exact stored forward value does dL/dw require during the backward pass?'",
        },
        {
          title: "Contrast training and inference memory",
          description:
            "Have the teacher contrast retained activations for training with inference, then ask students why a backward derivative needs forward values.",
          actionablePrompt:
            "Ask the room: 'If we immediately discarded layer activations after computing them during training like we do during inference, how would the chain rule evaluate the gradient at earlier layers?'",
        },
      ],
    };
  }

  const firstAnswer = flawedResponses[0]?.answer?.trim();
  const excerpt =
    firstAnswer && firstAnswer.length > 0
      ? firstAnswer.slice(0, 160)
      : "No explanation supplied";

  return {
    misconceptions: [
      `Identified reasoning gap from student submission: "${excerpt}"`,
    ],
    recommendations: [
      {
        title: "Trace reasoning on board",
        description:
          "Trace the reasoning of the submitted student answer on the board step by step to identify the exact step where intuition departs from the underlying concept.",
        actionablePrompt:
          "Write the core claim on the board and ask students to point out which step in the chain of reasoning assumes an unproven condition.",
      },
      {
        title: "Contrasting follow-up check",
        description:
          "Present a contrasting follow-up concept check comparing a common pitfall case against the canonical condition.",
        actionablePrompt:
          "Present two side-by-side scenarios and have students vote on which scenario satisfies the underlying principle and why.",
      },
    ],
  };
}
