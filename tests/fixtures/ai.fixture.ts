import {
  type UUID,
  type ConceptNode,
  type ConceptQuizQuestion,
  type StudentQuizQuestion,
  type AiService,
  type LearningService,
  type ActorContext,
  type PollResponseOutcome,
  applyMasteryEvidence,
} from "../../src/contracts/index.js";
import { fixtureSocraticTutorTurn } from "../../src/server/ai/fixtures/tutoring-turn.js";
import {
  FIXTURE_33_CONCEPTS,
  fixturePrerequisiteGraph,
  fixtureSummarizeLecture,
} from "../../src/server/ai/index.js";
import { fixtureDetectConcepts } from "../../src/server/ai/fixtures/detected-concepts.js";

// ============================================================================
// Canonical Fixture IDs
// ============================================================================

export const FIXTURE_TEACHER_ID: UUID = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_STUDENT_ID: UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const FIXTURE_STUDENT_2_ID: UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const FIXTURE_CONCEPT_ID_1: UUID = "33333333-3333-4333-8333-333333333316";
export const FIXTURE_CONCEPT_ID_2: UUID = "33333333-3333-4333-8333-333333333317";
export const FIXTURE_TUTORING_SESSION_ID: UUID = "99999999-9999-4999-8999-999999999999";
export const FIXTURE_QUIZ_ATTEMPT_ID: UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ============================================================================
// Canonical 5 Practice Quiz Questions for Gradient Descent
// ============================================================================

export const FIXTURE_CONCEPT_QUIZ_QUESTIONS: ConceptQuizQuestion[] = [
  {
    id: "44444444-4444-4444-8444-444444444401",
    conceptId: FIXTURE_CONCEPT_ID_2,
    question: "What is the primary objective of gradient descent in optimization?",
    optionA: "Maximize the loss function value",
    optionB: "Minimize the loss function by iteratively stepping opposite to the gradient",
    optionC: "Compute exact matrix inversions without iterative loops",
    optionD: "Randomly perturb parameters until prediction accuracy improves",
    correctAnswer: 1,
    explanation:
      "Gradient descent iteratively updates parameters in the direction of steepest descent (-gradient) to find local minima.",
    questionOrder: 0,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444402",
    conceptId: FIXTURE_CONCEPT_ID_2,
    question: "What occurs if the learning rate hyperparameter is chosen too large?",
    optionA: "The model converges faster to the optimal solution",
    optionB: "The loss immediately hits absolute zero",
    optionC: "The parameters overshoot the local minimum, oscillate wildly, or diverge",
    optionD: "The gradient becomes identically zero at the first epoch",
    correctAnswer: 2,
    explanation:
      "An excessively large learning rate causes update steps that overshoot the valley, destabilizing optimization and causing divergence.",
    questionOrder: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444403",
    conceptId: FIXTURE_CONCEPT_ID_2,
    question: "How does Stochastic Gradient Descent (SGD) differ from Batch Gradient Descent?",
    optionA: "SGD updates parameters using a single random sample or mini-batch instead of the full dataset",
    optionB: "SGD does not require computing partial derivatives",
    optionC: "SGD only works for convex quadratic loss functions",
    optionD: "SGD computes the exact second-order Hessian matrix at every step",
    correctAnswer: 0,
    explanation:
      "SGD estimates the gradient over mini-batches, offering computational efficiency and noise that assists in escaping saddle points.",
    questionOrder: 2,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444404",
    conceptId: FIXTURE_CONCEPT_ID_2,
    question: "What does the gradient vector represent geometrically on the loss surface?",
    optionA: "The tangent line parallel to the parameter coordinate axis",
    optionB: "The curvature of the level sets",
    optionC: "The direction of steepest ascent with magnitude equal to the rate of increase",
    optionD: "The distance from the current parameter values to the origin",
    correctAnswer: 2,
    explanation:
      "The gradient points in the direction of greatest rate of increase; taking its negative yields the direction of steepest descent.",
    questionOrder: 3,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444405",
    conceptId: FIXTURE_CONCEPT_ID_2,
    question: "When does standard gradient descent stop updating weights?",
    optionA: "When the learning rate decays to 1.0",
    optionB: "When the gradient norm approaches zero at a stationary point",
    optionC: "When the training batch count reaches 100",
    optionD: "When all dataset labels are strictly positive",
    correctAnswer: 1,
    explanation:
      "Because parameter updates are proportional to the gradient vector, updates vanish when the gradient norm approaches zero.",
    questionOrder: 4,
    createdAt: "2026-10-20T12:00:00.000Z",
  },
];

export const FIXTURE_STUDENT_QUIZ_QUESTIONS: StudentQuizQuestion[] =
  FIXTURE_CONCEPT_QUIZ_QUESTIONS.map((q) => ({
    id: q.id,
    question: q.question,
    options: [q.optionA, q.optionB, q.optionC, q.optionD],
    questionOrder: q.questionOrder,
  }));

// ============================================================================
// FakeAiService: Deterministic Offline AI Pipeline Implementation
// ============================================================================

export class FakeAiService implements AiService {
  async extractPrerequisiteGraph(_pdfBytes: Buffer): Promise<{
    totalPages: number;
    processedPages: number;
    truncated: boolean;
    concepts: { label: string; description: string; category: string; difficulty: number }[];
    edges: [string, string][];
  }> {
    const graph = fixturePrerequisiteGraph();
    return {
      totalPages: 11,
      processedPages: 10,
      truncated: true,
      concepts: graph.concepts,
      edges: graph.edges,
    };
  }

  async detectConcepts(
    chunkText: string,
    candidateConcepts: { id: UUID; label: string }[]
  ): Promise<UUID[]> {
    return fixtureDetectConcepts(chunkText, candidateConcepts).conceptIds;
  }

  async generatePollQuestion(
    _concept: ConceptNode,
    _recentTranscript: string
  ): Promise<{ question: string; expectedAnswer: string }> {
    return {
      question:
        "What happens to the gradient descent optimization trajectory if the learning rate is chosen too large?",
      expectedAnswer:
        "An excessively large learning rate causes the parameters to overshoot the local minimum, oscillate wildly, or diverge.",
    };
  }

  async evaluatePollResponse(
    _question: string,
    _expectedAnswer: string,
    studentAnswer: string
  ): Promise<{ outcome: PollResponseOutcome; feedback: string }> {
    const answerLower = studentAnswer.toLowerCase();
    let outcome: PollResponseOutcome;
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

    // Explicit domain invariant assertion: outcome must strictly be "correct" | "partial" | "wrong"
    if (!["correct", "partial", "wrong"].includes(outcome)) {
      throw new Error(`Invalid poll outcome evaluated: ${outcome}`);
    }

    return { outcome, feedback };
  }

  async socraticTutorTurn(
    concept: ConceptNode,
    messageHistory: { role: "user" | "assistant"; content: string }[],
    newStudentMessage: string
  ): Promise<{ assistantResponse: string; understandingDetected: boolean }> {
    return fixtureSocraticTutorTurn(concept, messageHistory, newStudentMessage);
  }

  async checkUnderstanding(
    _concept: ConceptNode,
    _tutorQuestion: string,
    studentAnswer: string
  ): Promise<{ understandingConfirmed: boolean; rationale: string }> {
    const answerLower = studentAnswer.toLowerCase();
    const understandingConfirmed =
      answerLower.includes("chain rule") ||
      answerLower.includes("activation") ||
      answerLower.includes("gradient");

    return {
      understandingConfirmed,
      rationale: understandingConfirmed
        ? "Student correctly articulated the core prerequisite mechanism."
        : "Student explanation lacks intermediate derivative concepts.",
    };
  }

  async summarizeMisconceptions(
    _pollId: UUID,
    _responses: { answer: string; outcome: string }[]
  ): Promise<{
    misconceptions: string[];
    recommendations: { title: string; description: string; actionablePrompt: string }[];
  }> {
    return {
      misconceptions: [
        "Confusing learning rate magnitude with gradient magnitude",
        "Assuming gradient descent always converges regardless of step size",
      ],
      recommendations: [
        {
          title: "Visualizing Loss Trajectories",
          description: "Display side-by-side loss surface trajectory plots comparing step sizes.",
          actionablePrompt:
            "Plot gradient descent trajectories on a 2D paraboloid with eta=0.01 vs eta=1.5.",
        },
      ],
    };
  }

  async summarizeLecture(
    transcriptChunks: { text: string; timestampSec: number }[]
  ): Promise<{
    summary: string;
    keyConceptsCovered: UUID[];
    timelineHighlights: { timestampSec: number; conceptLabel: string; description: string }[];
  }> {
    return fixtureSummarizeLecture(transcriptChunks, FIXTURE_33_CONCEPTS);
  }

  async suggestInterventions(
    _lectureId: UUID,
    _pollResponses: { answer: string; outcome: string }[]
  ): Promise<{
    misconceptions: string[];
    recommendations: { title: string; description: string; actionablePrompt: string }[];
  }> {
    return {
      misconceptions: ["Conflating gradient magnitude with learning rate"],
      recommendations: [
        {
          title: "Interactive Momentum Demo",
          description: "Demonstrate how momentum dampens cross-axis oscillations in narrow valleys.",
          actionablePrompt:
            "Compare standard SGD against SGD with momentum on the Rosenbrock benchmark valley.",
        },
      ],
    };
  }

  async generateLearningPage(concept: ConceptNode): Promise<string> {
    return `# ${concept.label}

## Overview & Intuition
${concept.description}. In modern machine learning and computational optimization, mastering this concept provides the foundation for designing, training, and diagnosing neural architectures.

## Mathematical Formulation
Let $J(\\theta)$ denote the objective loss function parameterized by weights $\\theta \\in \\mathbb{R}^d$. The standard update rule is given by:

$$\\theta_{t+1} = \\theta_t - \\eta \\nabla J(\\theta_t)$$

where $\\eta > 0$ denotes the learning rate, and $\\nabla J(\\theta_t)$ represents the vector of first-order partial derivatives evaluated at the current parameter estimate $\\theta_t$.

## Key Invariants & Properties
1. **Convergence**: Under Lipschitz continuous gradients and appropriate learning rates $\\eta < \\frac{2}{L}$, the sequence of function values monotonically decreases toward a stationary point.
2. **Step Size Sensitivity**: If $\\eta$ is chosen excessively large, the iterate sequence diverges. If $\\eta$ is overly conservative, convergence becomes prohibitively slow.
3. **Stochastic Approximation**: When computed over mini-batches, the gradient estimator exhibits variance that aids in escaping shallow saddle points.

## Common Misconceptions
- Gradient descent does not guarantee finding a global minimum in non-convex landscapes.
- The gradient vector points in the direction of maximum rate of increase; subtracting it moves toward steepest descent.`;
  }

  async generateQuizQuestions(_concept: ConceptNode): Promise<{
    question: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: number;
    explanation: string;
  }[]> {
    return FIXTURE_CONCEPT_QUIZ_QUESTIONS.map((q) => ({
      question: q.question,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    }));
  }

  async searchAcademicResources(
    _conceptLabel: string,
    _query?: string
  ): Promise<{
    title: string;
    url: string;
    snippet: string;
    citationNumber: number;
  }[]> {
    return [
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
    ];
  }

  async answerResourceQuestion(
    concept: ConceptNode,
    _studentInquiry: string
  ): Promise<{
    answer: string;
    citations: { number: number; title: string; url: string }[];
  }> {
    return {
      answer: `For ${concept.label}, standard optimization theory establishes a linear convergence rate for strongly convex functions, achieving error epsilon in $O(\\log(1/\\epsilon))$ iterations.`,
      citations: [
        {
          number: 1,
          title: "Optimization Methods for Large-Scale Machine Learning",
          url: "https://arxiv.org/abs/1606.04838",
        },
      ],
    };
  }
}

// ============================================================================
// FakeLearningService: In-Memory Implementation of Learning Service Port
// ============================================================================

export class FakeLearningService implements LearningService {
  private fakeAi = new FakeAiService();
  private studentConfidence = new Map<string, number>();

  constructor() {
    this.studentConfidence.set(
      `${FIXTURE_STUDENT_ID}:${FIXTURE_CONCEPT_ID_2}`,
      0.5
    );
  }

  async createTutoringSession(
    _actor: ActorContext,
    _studentId: UUID,
    _conceptIds: UUID[]
  ): Promise<{ sessionId: UUID }> {
    return { sessionId: FIXTURE_TUTORING_SESSION_ID };
  }

  async submitTutoringMessage(
    _actor: ActorContext,
    _sessionId: UUID,
    content: string,
    conceptId?: UUID
  ): Promise<{
    assistantContent: string;
    understandingDetected: boolean;
    masteryUpdated?: { confidence: number; band: "gray" | "red" | "yellow" | "green" };
  }> {
    const concept =
      FIXTURE_33_CONCEPTS.find((c) => c.id === conceptId) ?? FIXTURE_33_CONCEPTS[16];

    const turn = await this.fakeAi.socraticTutorTurn(concept, [], content);

    if (turn.understandingDetected) {
      const key = `${FIXTURE_STUDENT_ID}:${concept.id}`;
      const current = this.studentConfidence.get(key) ?? 0.5;
      const updated = applyMasteryEvidence(current, {
        type: "tutor",
        sourceId: FIXTURE_TUTORING_SESSION_ID,
      });
      this.studentConfidence.set(key, updated.confidence);

      return {
        assistantContent: turn.assistantResponse,
        understandingDetected: true,
        masteryUpdated: {
          confidence: updated.confidence,
          band: updated.band,
        },
      };
    }

    return {
      assistantContent: turn.assistantResponse,
      understandingDetected: false,
    };
  }

  async getLearningPage(_actor: ActorContext, conceptId: UUID): Promise<string> {
    const concept =
      FIXTURE_33_CONCEPTS.find((c) => c.id === conceptId) ?? FIXTURE_33_CONCEPTS[16];
    return this.fakeAi.generateLearningPage(concept);
  }

  async getQuiz(
    _actor: ActorContext,
    _conceptId: UUID
  ): Promise<{
    id: UUID;
    question: string;
    options: [string, string, string, string];
    questionOrder: number;
  }[]> {
    return FIXTURE_STUDENT_QUIZ_QUESTIONS;
  }

  async submitQuiz(
    _actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    answers: { questionId: UUID; selectedOption: number }[]
  ): Promise<{
    attemptId: UUID;
    score: number;
    correctCount: number;
    totalQuestions: number;
    newConfidence: number;
    newBand: "gray" | "red" | "yellow" | "green";
  }> {
    let correctCount = 0;
    const totalQuestions = FIXTURE_CONCEPT_QUIZ_QUESTIONS.length;

    for (const ans of answers) {
      const q = FIXTURE_CONCEPT_QUIZ_QUESTIONS.find((item) => item.id === ans.questionId);
      if (q && q.correctAnswer === ans.selectedOption) {
        correctCount++;
      }
    }

    const score = Math.round((correctCount / totalQuestions) * 100) / 100;
    const key = `${studentId}:${conceptId}`;
    const current = this.studentConfidence.get(key) ?? 0.5;
    const updated = applyMasteryEvidence(current, {
      type: "quiz",
      score,
      sourceId: FIXTURE_QUIZ_ATTEMPT_ID,
    });
    this.studentConfidence.set(key, updated.confidence);

    return {
      attemptId: FIXTURE_QUIZ_ATTEMPT_ID,
      score,
      correctCount,
      totalQuestions,
      newConfidence: updated.confidence,
      newBand: updated.band,
    };
  }
}
