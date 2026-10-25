import type { AcademicResources, AnsweredResourceQuestion } from "../../../contracts/ai.js";
import type { ConceptNode } from "../../../contracts/course.js";

/**
 * Deterministic optimization resources fixture.
 * Note: this is a fixed reference set for testing and offline development,
 * not query-specific live retrieval.
 */
export function fixtureSearchAcademicResources(
  _conceptLabel: string,
  _query?: string
): AcademicResources {
  return {
    resources: [
      {
        title: "Optimization Methods for Large-Scale Machine Learning",
        url: "https://arxiv.org/abs/1606.04838",
        snippet:
          "A comprehensive review of first-order stochastic and deterministic optimization methods for machine learning.",
        citationNumber: 1,
      },
      {
        title: "Convex Optimization - Stephen Boyd & Lieven Vandenberghe",
        url: "https://web.stanford.edu/~boyd/cvxbook/",
        snippet:
          "Foundational reference on unconstrained and constrained convex optimization algorithms and duality theory.",
        citationNumber: 2,
      },
      {
        title: "An Overview of Gradient Descent Optimization Algorithms",
        url: "https://arxiv.org/abs/1609.04747",
        snippet:
          "Taxonomy of gradient descent variants including Momentum, RMSprop, and Adam with adaptive learning rates.",
        citationNumber: 3,
      },
    ],
  };
}

/**
 * Deterministic optimization Q&A fixture explaining gradient descent's negative-gradient update.
 * Note: for non-optimization concepts, this fixture contextualizes the response as an
 * optimization analogy rather than claiming the cited sources cover unrelated domains.
 */
export function fixtureAnswerResourceQuestion(
  concept: ConceptNode,
  _studentInquiry: string
): AnsweredResourceQuestion {
  const isGradientDescent = concept.label.toLowerCase().includes("gradient descent");

  const answer = isGradientDescent
    ? `For ${concept.label}, iterative parameter updates follow the negative gradient direction to minimize objective loss [2]. Learning rate scheduling and adaptive momentum further accelerate empirical convergence across convex and non-convex surfaces [3].`
    : `For ${concept.label}, foundational optimization methods can be understood through the standard Gradient Descent framework, where parameter updates follow the negative gradient direction to minimize empirical risk [2]. Step-size selection and adaptive momentum accelerate convergence toward minimal error [3].`;

  return {
    answer,
    citations: [
      {
        number: 2,
        title: "Convex Optimization - Stephen Boyd & Lieven Vandenberghe",
        url: "https://web.stanford.edu/~boyd/cvxbook/",
      },
      {
        number: 3,
        title: "An Overview of Gradient Descent Optimization Algorithms",
        url: "https://arxiv.org/abs/1609.04747",
      },
    ],
  };
}
