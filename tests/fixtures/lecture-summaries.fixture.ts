import type { LectureSummaryItem } from "@/features/student/lecture-summaries-view";

export const FIXTURE_LECTURE_SUMMARIES: LectureSummaryItem[] = [
  {
    lectureId: "44444444-4444-4444-8444-444444444441",
    title: "Lecture 1: Introduction to Deep Learning, Perceptrons & Loss Surfaces",
    summary:
      "This opening lecture established the foundational principles of artificial neural networks. We traced the mathematical progression from the Rosenblatt perceptron to multi-layer feed-forward networks, analyzing the representational capacity of linear layers and proving why non-linear activation functions are mathematically indispensable. We concluded with loss surface formulations and convexity characteristics.",
    keyConceptsCovered: [
      "Perceptrons",
      "Activation Functions",
      "Loss Surfaces",
      "Convexity",
    ],
    timelineHighlights: [
      {
        timestampSec: 495,
        conceptLabel: "Biological vs Artificial Neurons",
        description: "Comparison of biological dendrite summation to mathematical dot-product weights.",
      },
      {
        timestampSec: 1470,
        conceptLabel: "Sigmoid and ReLU Nonlinearities",
        description: "Why non-linear activations prevent collapsing deep architectures into a single linear matrix.",
      },
      {
        timestampSec: 2700,
        conceptLabel: "Mean Squared Error Formulation",
        description: "Deriving loss gradients with respect to output predictions and analyzing convexity.",
      },
    ],
    generatedAt: "2026-10-18T11:30:00.000Z",
  },
  {
    lectureId: "44444444-4444-4444-8444-444444444442",
    title: "Lecture 2: Computational Graphs, Forward Propagation & Vectorization",
    summary:
      "An in-depth mathematical exploration of computational graph architecture. The class covered the formalization of forward propagation as a topological sort through DAG operators. We explored matrix calculus and vectorized tensor operations, highlighting performance advantages of mini-batch computations over scalar loops.",
    keyConceptsCovered: [
      "Computational Graphs",
      "Vectorization",
      "Broadcasting",
      "Matrix Calculus",
    ],
    timelineHighlights: [
      {
        timestampSec: 720,
        conceptLabel: "Directed Acyclic Graphs for Math",
        description: "Visualizing scalar and tensor operations as topological graph nodes.",
      },
      {
        timestampSec: 1845,
        conceptLabel: "Vectorized Mini-Batch Processing",
        description: "How GPU tensor cores leverage SIMD primitives for batch matrix products.",
      },
      {
        timestampSec: 3130,
        conceptLabel: "Chain Rule on Directed Paths",
        description: "Decomposing multivariate gradient accumulation along multiple graph branches.",
      },
    ],
    generatedAt: "2026-10-20T11:30:00.000Z",
  },
  {
    lectureId: "44444444-4444-4444-8444-444444444443",
    title: "Lecture 3: Reverse-Mode Automatic Differentiation & Backpropagation",
    summary:
      "This lecture presented the complete mathematical derivation of the backpropagation algorithm. We demonstrated that reverse-mode automatic differentiation computes the gradient of a scalar output with respect to all parameters in computational complexity proportional to the forward pass. We examined Jacobian-vector products and diagnosed vanishing and exploding gradient phenomena.",
    keyConceptsCovered: [
      "Backpropagation",
      "Chain Rule",
      "Jacobian Matrices",
      "Gradient Accumulation",
    ],
    timelineHighlights: [
      {
        timestampSec: 620,
        conceptLabel: "Forward vs Reverse Mode AD",
        description: "Why reverse mode scales as O(1) in the number of inputs for scalar loss functions.",
      },
      {
        timestampSec: 1780,
        conceptLabel: "Jacobian-Vector Products",
        description: "Efficient backward pass formulation avoiding explicit Jacobian matrix materialization.",
      },
      {
        timestampSec: 3315,
        conceptLabel: "Vanishing Gradient Breakdown",
        description: "How repeated sigmoid squashing diminishes gradient norms exponentially in deep nets.",
      },
    ],
    generatedAt: "2026-10-22T11:30:00.000Z",
  },
];
