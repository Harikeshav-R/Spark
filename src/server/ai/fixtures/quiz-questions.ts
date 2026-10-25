import type { ConceptNode } from "../../../contracts/course.js";
import type { GeneratedQuizQuestions } from "../../../contracts/ai.js";

export const CANONICAL_GRADIENT_DESCENT_QUIZ_QUESTIONS: GeneratedQuizQuestions = {
  questions: [
    {
      question: "What is the primary objective of gradient descent in optimization?",
      optionA: "Maximize the loss function value",
      optionB: "Minimize the loss function by iteratively stepping opposite to the gradient",
      optionC: "Compute exact matrix inversions without iterative loops",
      optionD: "Randomly perturb parameters until prediction accuracy improves",
      correctAnswer: 1,
      explanation:
        "Gradient descent iteratively updates parameters in the direction of steepest descent (-gradient) to find local minima.",
    },
    {
      question: "What occurs if the learning rate hyperparameter is chosen too large?",
      optionA: "The model converges faster to the optimal solution",
      optionB: "The loss immediately hits absolute zero",
      optionC: "The parameters overshoot the local minimum, oscillate wildly, or diverge",
      optionD: "The gradient becomes identically zero at the first epoch",
      correctAnswer: 2,
      explanation:
        "An excessively large learning rate causes update steps that overshoot the valley, destabilizing optimization and causing divergence.",
    },
    {
      question: "How does Stochastic Gradient Descent (SGD) differ from Batch Gradient Descent?",
      optionA: "SGD updates parameters using a single random sample or mini-batch instead of the full dataset",
      optionB: "SGD does not require computing partial derivatives",
      optionC: "SGD only works for convex quadratic loss functions",
      optionD: "SGD computes the exact second-order Hessian matrix at every step",
      correctAnswer: 0,
      explanation:
        "SGD estimates the gradient over mini-batches, offering computational efficiency and noise that assists in escaping saddle points.",
    },
    {
      question: "What does the gradient vector represent geometrically on the loss surface?",
      optionA: "The tangent line parallel to the parameter coordinate axis",
      optionB: "The curvature of the level sets",
      optionC: "The direction of steepest ascent with magnitude equal to the rate of increase",
      optionD: "The distance from the current parameter values to the origin",
      correctAnswer: 2,
      explanation:
        "The gradient points in the direction of greatest rate of increase; taking its negative yields the direction of steepest descent.",
    },
    {
      question: "When does standard gradient descent stop updating weights?",
      optionA: "When the learning rate decays to 1.0",
      optionB: "When the gradient norm approaches zero at a stationary point",
      optionC: "When the training batch count reaches 100",
      optionD: "When all dataset labels are strictly positive",
      correctAnswer: 1,
      explanation:
        "Because parameter updates are proportional to the gradient vector, updates vanish when the gradient norm approaches zero.",
    },
  ],
};

export function fixtureGenerateQuizQuestions(concept: ConceptNode): GeneratedQuizQuestions {
  if (concept.label.toLowerCase().includes("gradient descent")) {
    return CANONICAL_GRADIENT_DESCENT_QUIZ_QUESTIONS;
  }

  const label = concept.label.trim();
  const desc = concept.description.trim() || `${label} foundational concept`;
  const category = concept.category.trim();
  const diff = concept.difficulty;

  return {
    questions: [
      {
        question: `What is the primary definition and role of ${label}?`,
        optionA: `It is an unrelated auxiliary metric in ${category}.`,
        optionB: `It is defined as: ${desc}.`,
        optionC: `It is an obsolete technique replaced by random sampling.`,
        optionD: `It serves purely as a hardware interface without conceptual logic.`,
        correctAnswer: 1,
        explanation: `${label} represents the core concept defined as ${desc}.`,
      },
      {
        question: `Which statement accurately characterizes ${label} within ${category}?`,
        optionA: `It operates independently of any underlying mathematical or structural rules.`,
        optionB: `It only applies to trivial single-variable models.`,
        optionC: `It functions as a core concept within ${category} to govern system behavior.`,
        optionD: `It eliminates all algorithmic complexity unconditionally.`,
        correctAnswer: 2,
        explanation: `Within ${category}, ${label} provides essential structural and operational mechanisms.`,
      },
      {
        question: `How does the mechanism of ${label} operate in practical execution?`,
        optionA: `It processes inputs deterministically according to its principles to maintain structural validity.`,
        optionB: `It requires continuous manual human intervention during every runtime cycle.`,
        optionC: `It bypasses validation constraints and operates without invariant checks.`,
        optionD: `It alters global system configuration randomly on each iteration.`,
        correctAnswer: 0,
        explanation: `${label} adheres to deterministic operational principles to guarantee correct system behavior.`,
      },
      {
        question: `At a difficulty rating of ${diff}, what is a critical consideration when implementing ${label}?`,
        optionA: `Implementation details have no impact on overall accuracy or stability.`,
        optionB: `Computational complexity is always constant regardless of scale.`,
        optionC: `Proper handling of edge cases, boundary conditions, and invariant constraints is required.`,
        optionD: `All error handling should be disabled to maximize throughput.`,
        correctAnswer: 2,
        explanation: `Given difficulty rating ${diff}, developers must carefully verify boundary constraints and edge cases.`,
      },
      {
        question: `Which condition must hold to verify the correctness of ${label}?`,
        optionA: `Execution must complete without checking prerequisite dependencies.`,
        optionB: `All governing invariants and semantic relationships must be preserved throughout execution.`,
        optionC: `The output must match an unconstrained random distribution.`,
        optionD: `State mutations must occur without transaction boundaries.`,
        correctAnswer: 1,
        explanation: `Correct operation of ${label} requires preserving all foundational invariants and semantic relations.`,
      },
    ],
  };
}
