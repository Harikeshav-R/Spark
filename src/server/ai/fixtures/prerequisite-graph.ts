import type { UUID } from "../../../contracts/common.js";
import type { ConceptNode } from "../../../contracts/course.js";
import type { ExtractedPrerequisiteGraph } from "../../../contracts/ai.js";

// ============================================================================
// Canonical Fixture Course ID
// ============================================================================

export const FIXTURE_COURSE_ID: UUID = "11111111-1111-4111-8111-111111111111";

// ============================================================================
// Canonical 33 Concepts (CS229 Seed Curriculum across 9 categories)
// ============================================================================

export const FIXTURE_33_CONCEPTS: ConceptNode[] = [
  // 1. Linear Algebra (4)
  {
    id: "33333333-3333-4333-8333-333333333301",
    courseId: FIXTURE_COURSE_ID,
    label: "Vectors",
    description: "Mathematical objects with magnitude and direction in vector spaces",
    category: "Linear Algebra",
    difficulty: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333302",
    courseId: FIXTURE_COURSE_ID,
    label: "Matrices",
    description: "Rectangular arrays of numbers representing linear maps and transformations",
    category: "Linear Algebra",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333303",
    courseId: FIXTURE_COURSE_ID,
    label: "Eigenvalues",
    description: "Scalars associated with linear equations and characteristic eigenvectors",
    category: "Linear Algebra",
    difficulty: 4,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333304",
    courseId: FIXTURE_COURSE_ID,
    label: "Matrix Multiplication",
    description: "Binary operation producing a matrix from the dot products of rows and columns",
    category: "Linear Algebra",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 2. Calculus (4)
  {
    id: "33333333-3333-4333-8333-333333333305",
    courseId: FIXTURE_COURSE_ID,
    label: "Derivatives",
    description: "Instantaneous rates of change for scalar single-variable functions",
    category: "Calculus",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333306",
    courseId: FIXTURE_COURSE_ID,
    label: "Partial Derivatives",
    description: "Derivatives of multivariable functions with respect to a single variable",
    category: "Calculus",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333307",
    courseId: FIXTURE_COURSE_ID,
    label: "Chain Rule",
    description: "Formula for computing derivatives of composite functions via intermediate terms",
    category: "Calculus",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333308",
    courseId: FIXTURE_COURSE_ID,
    label: "Gradients",
    description: "Vector of partial derivatives pointing in the direction of greatest rate of increase",
    category: "Calculus",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 3. Probability (3)
  {
    id: "33333333-3333-4333-8333-333333333309",
    courseId: FIXTURE_COURSE_ID,
    label: "Distributions",
    description: "Functions describing the probability of values for random variables",
    category: "Probability",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333310",
    courseId: FIXTURE_COURSE_ID,
    label: "Conditional Probability",
    description: "Probability of an event occurring given another event has already occurred",
    category: "Probability",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333311",
    courseId: FIXTURE_COURSE_ID,
    label: "Bayes' Theorem",
    description: "Mathematical rule describing the probability of an event based on prior knowledge",
    category: "Probability",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 4. ML Foundations (4)
  {
    id: "33333333-3333-4333-8333-333333333312",
    courseId: FIXTURE_COURSE_ID,
    label: "Loss Functions",
    description: "Functions mapping model predictions and true targets onto real numbers representing cost",
    category: "ML Foundations",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333313",
    courseId: FIXTURE_COURSE_ID,
    label: "MSE",
    description: "Mean squared error metric measuring average squared differences between prediction and truth",
    category: "ML Foundations",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333314",
    courseId: FIXTURE_COURSE_ID,
    label: "Cross-Entropy",
    description: "Loss metric quantifying difference between two probability distributions",
    category: "ML Foundations",
    difficulty: 4,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333315",
    courseId: FIXTURE_COURSE_ID,
    label: "Optimization",
    description: "Selection of best element with regard to some criterion from available alternatives",
    category: "ML Foundations",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 5. Gradient Descent (4)
  {
    id: "33333333-3333-4333-8333-333333333316",
    courseId: FIXTURE_COURSE_ID,
    label: "SGD",
    description: "Stochastic gradient descent replacing true gradient with estimate from mini-batches",
    category: "Gradient Descent",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333317",
    courseId: FIXTURE_COURSE_ID,
    label: "Gradient Descent",
    description: "Iterative optimization algorithm following negative gradient to reach local minima",
    category: "Gradient Descent",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333318",
    courseId: FIXTURE_COURSE_ID,
    label: "Learning Rate",
    description: "Hyperparameter tuning step size taken along the negative gradient vector",
    category: "Gradient Descent",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333319",
    courseId: FIXTURE_COURSE_ID,
    label: "Convergence",
    description: "Condition where iterative algorithm values approach stable stationary point",
    category: "Gradient Descent",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 6. Neural Networks (4)
  {
    id: "33333333-3333-4333-8333-333333333320",
    courseId: FIXTURE_COURSE_ID,
    label: "Perceptron",
    description: "Fundamental binary classification unit with weighted inputs and threshold activation",
    category: "Neural Networks",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333321",
    courseId: FIXTURE_COURSE_ID,
    label: "Activation Functions",
    description: "Non-linear mappings allowing neural networks to approximate non-trivial relationships",
    category: "Neural Networks",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333322",
    courseId: FIXTURE_COURSE_ID,
    label: "Layers",
    description: "Ordered collections of processing nodes between model inputs and predictions",
    category: "Neural Networks",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333323",
    courseId: FIXTURE_COURSE_ID,
    label: "Forward Pass",
    description: "Sequential calculation of activations from input nodes through layer outputs",
    category: "Neural Networks",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 7. Backpropagation (3)
  {
    id: "33333333-3333-4333-8333-333333333324",
    courseId: FIXTURE_COURSE_ID,
    label: "Backpropagation",
    description: "Algorithm computing loss gradients with respect to parameters via reverse chain rule",
    category: "Backpropagation",
    difficulty: 4,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333325",
    courseId: FIXTURE_COURSE_ID,
    label: "Computational Graphs",
    description: "Directed graphs describing data-flow dependencies for automatic differentiation",
    category: "Backpropagation",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333326",
    courseId: FIXTURE_COURSE_ID,
    label: "Weight Updates",
    description: "Application of computed gradients and step size rules to adjust network parameters",
    category: "Backpropagation",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 8. Regularization (4)
  {
    id: "33333333-3333-4333-8333-333333333327",
    courseId: FIXTURE_COURSE_ID,
    label: "Overfitting",
    description: "Failure of a model to generalize when fitting noise in training observations",
    category: "Regularization",
    difficulty: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333328",
    courseId: FIXTURE_COURSE_ID,
    label: "L1 Regularization",
    description: "Lasso penalty proportional to absolute weights encouraging model sparsity",
    category: "Regularization",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333329",
    courseId: FIXTURE_COURSE_ID,
    label: "L2 Regularization",
    description: "Ridge penalty proportional to squared weight values encouraging smaller magnitudes",
    category: "Regularization",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333330",
    courseId: FIXTURE_COURSE_ID,
    label: "Dropout",
    description: "Stochastic deactivation of hidden units during training to prevent co-adaptation",
    category: "Regularization",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },

  // 9. Evaluation (3)
  {
    id: "33333333-3333-4333-8333-333333333331",
    courseId: FIXTURE_COURSE_ID,
    label: "Train/Val/Test Split",
    description: "Partitioning datasets into disjoint sets for training, tuning, and evaluation",
    category: "Evaluation",
    difficulty: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    courseId: FIXTURE_COURSE_ID,
    label: "Cross-Validation",
    description: "Resampling procedure using different subsets to evaluate model performance",
    category: "Evaluation",
    difficulty: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    courseId: FIXTURE_COURSE_ID,
    label: "Bias-Variance Tradeoff",
    description: "Core balance between underfitting estimation error and sensitivity to data variance",
    category: "Evaluation",
    difficulty: 4,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
];

// ============================================================================
// Canonical 34 Directed Prerequisite Edges
// ============================================================================

export const FIXTURE_34_EDGES: [string, string][] = [
  ["Vectors", "Matrices"],
  ["Matrices", "Matrix Multiplication"],
  ["Matrices", "Eigenvalues"],
  ["Derivatives", "Partial Derivatives"],
  ["Partial Derivatives", "Gradients"],
  ["Derivatives", "Chain Rule"],
  ["Chain Rule", "Backpropagation"],
  ["Gradients", "Gradient Descent"],
  ["Conditional Probability", "Bayes' Theorem"],
  ["Distributions", "Conditional Probability"],
  ["Loss Functions", "MSE"],
  ["Loss Functions", "Cross-Entropy"],
  ["Loss Functions", "Optimization"],
  ["Optimization", "Gradient Descent"],
  ["Gradient Descent", "Learning Rate"],
  ["Gradient Descent", "Convergence"],
  ["Gradient Descent", "SGD"],
  ["Perceptron", "Activation Functions"],
  ["Perceptron", "Layers"],
  ["Activation Functions", "Forward Pass"],
  ["Layers", "Forward Pass"],
  ["Forward Pass", "Backpropagation"],
  ["Backpropagation", "Computational Graphs"],
  ["Backpropagation", "Weight Updates"],
  ["Weight Updates", "Gradient Descent"],
  ["Overfitting", "L1 Regularization"],
  ["Overfitting", "L2 Regularization"],
  ["Overfitting", "Dropout"],
  ["Train/Val/Test Split", "Cross-Validation"],
  ["Cross-Validation", "Bias-Variance Tradeoff"],
  ["Gradients", "Backpropagation"],
  ["Matrix Multiplication", "Forward Pass"],
  ["Distributions", "Loss Functions"],
  ["Bayes' Theorem", "Cross-Entropy"],
];

// ============================================================================
// Deterministic Fixture Prerequisite Graph Factory
// ============================================================================

export function fixturePrerequisiteGraph(): ExtractedPrerequisiteGraph {
  return {
    concepts: FIXTURE_33_CONCEPTS.map((c) => ({
      label: c.label,
      description: c.description,
      category: c.category,
      difficulty: c.difficulty,
    })),
    edges: FIXTURE_34_EDGES.map(([source, target]) => [source, target]),
  };
}
