import type { GeneratedLearningPage } from "../../../contracts/ai.js";
import { generatedLearningPageSchema } from "../../../contracts/ai.js";
import type { ConceptNode } from "../../../contracts/course.js";
import { sanitizeLearningMarkdown } from "../markdown/sanitize-learning-markdown.js";

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, "\\$1");
}

export function fixtureGenerateLearningPage(concept: ConceptNode): GeneratedLearningPage {
  const isGradientDescent = concept.label.toLowerCase() === "gradient descent";
  const safeLabel = escapeMarkdown(concept.label);
  const safeDesc = escapeMarkdown(concept.description);

  const contextNote = isGradientDescent
    ? ""
    : "\n\n*Note: The following worked numerical example illustrates first-order iterative parameter optimization to demonstrate concrete quantitative convergence principles for this topic.*";

  const rawMarkdown = `# ${safeLabel}

## Formal Definition
${safeDesc}

Formally, consider a parameter space $\\Theta \\subseteq \\mathbb{R}^d$ and an objective function $J: \\Theta \\to \\mathbb{R}$. In mathematical optimization and machine learning, this concept formalizes the mechanism through which state representations or parameters $\\theta \\in \\Theta$ are systematically evaluated, updated, and converged toward stationary criteria.

## Intuition
At an intuitive level, mastering ${safeLabel} requires understanding how directional updates navigate complex loss surfaces. Rather than attempting a brute-force analytical solution across high-dimensional parameter spaces, the algorithm takes incremental steps proportional to the local curvature or rate of change. By continually refining parameter estimates, the system balances stability, computational efficiency, and asymptotic convergence.

## Mathematical Formulation
Let $J(\\theta)$ denote the objective loss parameterized by weights $\\theta \\in \\mathbb{R}^d$. The first-order update equation is expressed as:

$$
\\theta_{t+1} = \\theta_t - \\eta \\nabla J(\\theta_t)
$$

where $\\eta > 0$ represents the step size or learning rate, and $\\nabla J(\\theta_t)$ is the gradient vector of first-order partial derivatives:

$$
\\nabla J(\\theta) = \\left[ \\frac{\\partial J}{\\partial \\theta_1}, \\frac{\\partial J}{\\partial \\theta_2}, \\dots, \\frac{\\partial J}{\\partial \\theta_d} \\right]^T
$$

Under $L$-Lipschitz continuity of the gradient, where $\\|\\nabla J(\\theta) - \\nabla J(\\theta')\\| \\le L \\|\\theta - \\theta'\\|$, convergence is guaranteed when the step size satisfies $0 < \\eta < \\frac{2}{L}$.

## Worked Examples
Consider a one-dimensional quadratic loss function $J(\\theta) = (\\theta + 2)^2 = \\theta^2 + 4\\theta + 4$. The global minimum is analytically located at $\\theta^* = -2.0$, where $J(\\theta^*) = 0$.

We compute three discrete iterations using step size $\\eta = 0.1$ starting from an initial parameter value $\\theta_0 = 4.0$.${contextNote}

The gradient function is:

$$
\\nabla J(\\theta) = 2\\theta + 4
$$

### Iteration 1 ($t = 0$)
1. **Evaluate Gradient**:
   $$\\nabla J(\\theta_0) = 2(4.0) + 4 = 8.0 + 4 = 12.0$$
2. **Parameter Update**:
   $$\\theta_1 = \\theta_0 - \\eta \\nabla J(\\theta_0) = 4.0 - (0.1)(12.0) = 4.0 - 1.2 = 2.8$$
3. **Loss Evaluation**:
   $$J(\\theta_1) = (2.8 + 2.0)^2 = 4.8^2 = 23.04$$

### Iteration 2 ($t = 1$)
1. **Evaluate Gradient**:
   $$\\nabla J(\\theta_1) = 2(2.8) + 4 = 5.6 + 4 = 9.6$$
2. **Parameter Update**:
   $$\\theta_2 = \\theta_1 - \\eta \\nabla J(\\theta_1) = 2.8 - (0.1)(9.6) = 2.8 - 0.96 = 1.84$$
3. **Loss Evaluation**:
   $$J(\\theta_2) = (1.84 + 2.0)^2 = 3.84^2 = 14.7456$$

### Iteration 3 ($t = 2$)
1. **Evaluate Gradient**:
   $$\\nabla J(\\theta_2) = 2(1.84) + 4 = 3.68 + 4 = 7.68$$
2. **Parameter Update**:
   $$\\theta_3 = \\theta_2 - \\eta \\nabla J(\\theta_2) = 1.84 - (0.1)(7.68) = 1.84 - 0.768 = 1.072$$
3. **Loss Evaluation**:
   $$J(\\theta_3) = (1.072 + 2.0)^2 = 3.072^2 = 9.437184$$

With each successive step, the parameter estimate moves monotonically closer to the theoretical minimizer $\\theta^* = -2.0$, and the loss value decreases from $36.0$ down to $9.437$.

## Common Pitfalls
1. **Excessive Learning Rate**: Setting $\\eta \\ge \\frac{2}{L}$ causes iterate overshooting, resulting in numerical oscillation or exponential divergence.
2. **Premature Convergence at Saddle Points**: In non-convex multi-dimensional surfaces, zero-gradient stationary points may correspond to saddle points or local minima rather than global optima.
3. **Ill-Conditioned Curvature**: Disparate feature scales lead to elongated loss contours where standard first-order updates oscillate perpendicular to the descent valley. Preconditioning or adaptive momentum mitigates this pathology.
`;

  const sanitized = sanitizeLearningMarkdown(rawMarkdown);
  return generatedLearningPageSchema.parse({ content: sanitized });
}
