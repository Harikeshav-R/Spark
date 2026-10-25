import { describe, it, expect, beforeEach } from "vitest";
import {
  // AI schemas & types
  extractedPrerequisiteConceptSchema,
  extractedPrerequisiteGraphSchema,
  prerequisiteGraphExtractionResultSchema,
  detectConceptsCandidateSchema,
  detectedConceptsSchema,
  generatedPollQuestionSchema,
  evaluatedPollResponseSchema,
  tutorConversationMessageSchema,
  socraticTutorTurnResponseSchema,
  checkUnderstandingResponseSchema,
  misconceptionRecommendationSchema,
  summarizedMisconceptionsSchema,
  lectureTimelineHighlightSchema,
  summarizedLectureSchema,
  interventionRecommendationSchema,
  suggestedInterventionsSchema,
  generatedLearningPageSchema,
  generatedQuizQuestionSchema,
  generatedQuizQuestionsSchema,
  academicResourceSchema,
  academicResourcesSchema,
  resourceCitationSchema,
  answeredResourceQuestionSchema,
  // Learning schemas & types
  tutoringSessionStatusSchema,
  tutoringMessageRoleSchema,
  tutoringSessionSchema,
  tutoringMessageSchema,
  createTutoringSessionRequestSchema,
  createTutoringSessionResponseSchema,
  submitTutoringMessageRequestSchema,
  submitTutoringMessageResponseSchema,
  conceptLearningPageSchema,
  getLearningPageResponseSchema,
  conceptQuizQuestionSchema,
  studentQuizQuestionSchema,
  getQuizResponseSchema,
  submitQuizAnswerSchema,
  submitQuizRequestSchema,
  submitQuizResponseSchema,
  type ActorContext,
} from "../../../src/contracts/index.js";
import {
  FIXTURE_COURSE_ID,
  FIXTURE_33_CONCEPTS,
  FIXTURE_34_EDGES,
} from "../../../src/server/ai/index.js";
import {
  FIXTURE_TEACHER_ID,
  FIXTURE_STUDENT_ID,
  FIXTURE_STUDENT_2_ID,
  FIXTURE_CONCEPT_ID_1,
  FIXTURE_CONCEPT_ID_2,
  FIXTURE_TUTORING_SESSION_ID,
  FIXTURE_QUIZ_ATTEMPT_ID,
  FIXTURE_CONCEPT_QUIZ_QUESTIONS,
  FIXTURE_STUDENT_QUIZ_QUESTIONS,
  FakeAiService,
  FakeLearningService,
} from "../../fixtures/ai.fixture.js";

describe("Lane C: AI & Learning Service Ports & Deterministic Fixtures (P0-C-01)", () => {
  let fakeAi: FakeAiService;
  let fakeLearning: FakeLearningService;

  const studentActor: ActorContext = {
    userId: FIXTURE_STUDENT_ID,
    authId: FIXTURE_STUDENT_ID,
    email: "student@example.test",
    name: "Hari Student",
    role: "student",
    enrolledCourses: [{ courseId: FIXTURE_COURSE_ID, studentId: FIXTURE_STUDENT_ID }],
  };

  const teacherActor: ActorContext = {
    userId: FIXTURE_TEACHER_ID,
    authId: FIXTURE_TEACHER_ID,
    email: "teacher@example.test",
    name: "Sarah Chen",
    role: "teacher",
    teacherId: FIXTURE_TEACHER_ID,
    enrolledCourses: [],
  };
  beforeEach(() => {
    fakeAi = new FakeAiService();
    fakeLearning = new FakeLearningService();
  });

  // ==========================================================================
  // 1. Pipeline 2.1: extractPrerequisiteGraph & Strict DAG Invariant (GATE 4)
  // ==========================================================================

  describe("Pipeline 2.1: extractPrerequisiteGraph", () => {
    it("validates individual concept schema with valid fields", () => {
      const validConcept = {
        label: "Gradient Descent",
        description: "Iterative optimization following the negative gradient direction.",
        category: "Gradient Descent",
        difficulty: 3,
      };
      const parsed = extractedPrerequisiteConceptSchema.safeParse(validConcept);
      expect(parsed.success).toBe(true);
    });

    it("rejects concepts with invalid difficulty, empty labels, or descriptions out of bounds", () => {
      expect(
        extractedPrerequisiteConceptSchema.safeParse({
          label: "A",
          description: "Valid description longer than ten characters.",
          category: "Math",
          difficulty: 0, // Difficulty must be >= 1
        }).success
      ).toBe(false);

      expect(
        extractedPrerequisiteConceptSchema.safeParse({
          label: "A",
          description: "Valid description longer than ten characters.",
          category: "Math",
          difficulty: 6, // Difficulty must be <= 5
        }).success
      ).toBe(false);

      expect(
        extractedPrerequisiteConceptSchema.safeParse({
          label: "", // Empty label
          description: "Valid description longer than ten characters.",
          category: "Math",
          difficulty: 3,
        }).success
      ).toBe(false);

      expect(
        extractedPrerequisiteConceptSchema.safeParse({
          label: "Gradient",
          description: "Too short", // < 10 chars
          category: "Math",
          difficulty: 3,
        }).success
      ).toBe(false);
    });

    it("enforces graph concept count between 1 and 40", () => {
      expect(
        extractedPrerequisiteGraphSchema.safeParse({
          concepts: [], // Min 1 concept
          edges: [],
        }).success
      ).toBe(false);

      const tooManyConcepts = Array.from({ length: 41 }, (_, i) => ({
        label: `Concept ${i}`,
        description: `Description for concept ${i} exceeding ten characters.`,
        category: "Test",
        difficulty: 1,
      }));

      expect(
        extractedPrerequisiteGraphSchema.safeParse({
          concepts: tooManyConcepts,
          edges: [],
        }).success
      ).toBe(false);
    });

    it("FakeAiService.extractPrerequisiteGraph returns valid result satisfying schema", async () => {
      const result = await fakeAi.extractPrerequisiteGraph(Buffer.from("dummy pdf"));
      const parseResult = prerequisiteGraphExtractionResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        expect(parseResult.data.totalPages).toBe(11);
        expect(parseResult.data.processedPages).toBe(10);
        expect(parseResult.data.truncated).toBe(true);
        expect(parseResult.data.concepts).toHaveLength(33);
        expect(parseResult.data.edges).toHaveLength(34);
      }
    });

    it("GATE 4 Invariant: 33-node CS229 curriculum graph is strictly acyclic with valid edge endpoints", () => {
      expect(FIXTURE_33_CONCEPTS).toHaveLength(33);
      expect(FIXTURE_34_EDGES).toHaveLength(34);

      // Verify all concept labels are unique
      const conceptLabels = new Set(FIXTURE_33_CONCEPTS.map((c) => c.label));
      expect(conceptLabels.size).toBe(33);

      // Verify all edges connect known concepts
      for (const [from, to] of FIXTURE_34_EDGES) {
        expect(conceptLabels.has(from)).toBe(true);
        expect(conceptLabels.has(to)).toBe(true);
        expect(from).not.toBe(to); // Self-loops strictly prohibited
      }

      // Kahn's algorithm for topological sorting to guarantee acyclicity
      const inDegree: Record<string, number> = {};
      const adjacency: Record<string, string[]> = {};

      for (const label of conceptLabels) {
        inDegree[label] = 0;
        adjacency[label] = [];
      }

      for (const [from, to] of FIXTURE_34_EDGES) {
        inDegree[to] = (inDegree[to] ?? 0) + 1;
        adjacency[from]?.push(to);
      }

      const queue: string[] = [];
      for (const label of conceptLabels) {
        if (inDegree[label] === 0) {
          queue.push(label);
        }
      }

      let visitedCount = 0;
      while (queue.length > 0) {
        const node = queue.shift()!;
        visitedCount++;

        for (const neighbor of adjacency[node] ?? []) {
          inDegree[neighbor] = (inDegree[neighbor] ?? 1) - 1;
          if (inDegree[neighbor] === 0) {
            queue.push(neighbor);
          }
        }
      }

      // Visited count must equal total node count (no cycle)
      expect(visitedCount).toBe(33);
    });
  });

  // ==========================================================================
  // 2. Pipeline 2.2: detectConcepts
  // ==========================================================================

  describe("Pipeline 2.2: detectConcepts", () => {
    it("validates detectedConceptsSchema with UUID arrays", () => {
      const valid = { conceptIds: [FIXTURE_CONCEPT_ID_1, FIXTURE_CONCEPT_ID_2] };
      expect(detectedConceptsSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects non-UUID strings in detectedConceptsSchema", () => {
      expect(detectedConceptsSchema.safeParse({ conceptIds: ["not-a-uuid"] }).success).toBe(false);
    });

    it("FakeAiService.detectConcepts detects concepts present in transcript window", async () => {
      const candidates = [
        { id: FIXTURE_CONCEPT_ID_1, label: "SGD" },
        { id: FIXTURE_CONCEPT_ID_2, label: "Gradient Descent" },
      ];

      const detected = await fakeAi.detectConcepts(
        "Today we are discussing Gradient Descent and step sizes.",
        candidates
      );

      expect(detected).toEqual([FIXTURE_CONCEPT_ID_2]);
    });

  });

  // ==========================================================================
  // 3. Pipeline 2.3: generatePollQuestion
  // ==========================================================================

  describe("Pipeline 2.3: generatePollQuestion", () => {
    it("validates generatedPollQuestionSchema", () => {
      const payload = {
        question: "How does batch size affect gradient variance in stochastic optimization?",
        expectedAnswer: "Smaller batch sizes increase gradient noise and variance across epochs.",
      };
      expect(generatedPollQuestionSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects questions or answers that are too short", () => {
      expect(
        generatedPollQuestionSchema.safeParse({
          question: "Too short?",
          expectedAnswer: "Valid expected answer longer than fifteen characters.",
        }).success
      ).toBe(false);

      expect(
        generatedPollQuestionSchema.safeParse({
          question: "Valid question longer than fifteen characters?",
          expectedAnswer: "Short.",
        }).success
      ).toBe(false);
    });

    it("FakeAiService.generatePollQuestion returns valid poll question", async () => {
      const question = await fakeAi.generatePollQuestion(
        FIXTURE_33_CONCEPTS[16]!,
        "Recent transcript on learning rate"
      );
      expect(generatedPollQuestionSchema.safeParse(question).success).toBe(true);
    });
  });

  // ==========================================================================
  // 4. Pipeline 2.4: evaluatePollResponse
  // ==========================================================================

  describe("Pipeline 2.4: evaluatePollResponse", () => {
    it("validates evaluatedPollResponseSchema with correct/partial/wrong", () => {
      for (const outcome of ["correct", "partial", "wrong"] as const) {
        const payload = {
          outcome,
          feedback: "Constructive feedback on student reasoning.",
        };
        expect(evaluatedPollResponseSchema.safeParse(payload).success).toBe(true);
      }
    });

    it("rejects outcomes outside canonical union", () => {
      expect(
        evaluatedPollResponseSchema.safeParse({
          outcome: "pass",
          feedback: "Valid feedback string.",
        }).success
      ).toBe(false);

      expect(
        evaluatedPollResponseSchema.safeParse({
          outcome: "fail",
          feedback: "Valid feedback string.",
        }).success
      ).toBe(false);
    });

    it("FakeAiService.evaluatePollResponse evaluates correct, partial, and wrong responses deterministically", async () => {
      const question = "What happens if learning rate is too large?";
      const rubric = "Causes overshoot, oscillation, or divergence.";

      // 1. Correct answer
      const correctEval = await fakeAi.evaluatePollResponse(
        question,
        rubric,
        "The parameters will overshoot the minimum and diverge."
      );
      expect(correctEval.outcome).toBe("correct");
      expect(evaluatedPollResponseSchema.safeParse(correctEval).success).toBe(true);

      // 2. Partial answer
      const partialEval = await fakeAi.evaluatePollResponse(
        question,
        rubric,
        "It will jump too fast."
      );
      expect(partialEval.outcome).toBe("partial");
      expect(evaluatedPollResponseSchema.safeParse(partialEval).success).toBe(true);

      // 3. Wrong answer
      const wrongEval = await fakeAi.evaluatePollResponse(
        question,
        rubric,
        "It makes inference run instantly."
      );
      expect(wrongEval.outcome).toBe("wrong");
      expect(evaluatedPollResponseSchema.safeParse(wrongEval).success).toBe(true);
    });
  });

  // ==========================================================================
  // 5. Pipeline 2.5: socraticTutorTurn
  // ==========================================================================

  describe("Pipeline 2.5: socraticTutorTurn", () => {
    it("validates socraticTutorTurnResponseSchema", () => {
      const payload = {
        assistantResponse: "What role does the local derivative play in chain rule propagation?",
        understandingDetected: false,
      };
      expect(socraticTutorTurnResponseSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects responses shorter than 10 characters", () => {
      expect(
        socraticTutorTurnResponseSchema.safeParse({
          assistantResponse: "Why?",
          understandingDetected: false,
        }).success
      ).toBe(false);
    });

    it("FakeAiService.socraticTutorTurn detects conceptual breakthrough in student query", async () => {
      const concept = FIXTURE_33_CONCEPTS[23]!; // Backpropagation

      // Non-breakthrough query
      const turn1 = await fakeAi.socraticTutorTurn(concept, [], "I don't understand.");
      expect(turn1.understandingDetected).toBe(false);
      expect(socraticTutorTurnResponseSchema.safeParse(turn1).success).toBe(true);

      // Breakthrough query
      const turn2 = await fakeAi.socraticTutorTurn(
        concept,
        [],
        "The chain rule requires intermediate activation values to compute local gradients!"
      );
      expect(turn2.understandingDetected).toBe(true);
      expect(socraticTutorTurnResponseSchema.safeParse(turn2).success).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Pipeline 2.6: checkUnderstanding
  // ==========================================================================

  describe("Pipeline 2.6: checkUnderstanding", () => {
    it("validates checkUnderstandingResponseSchema", () => {
      const payload = {
        understandingConfirmed: true,
        rationale: "Student identified local derivative propagation via chain rule.",
      };
      expect(checkUnderstandingResponseSchema.safeParse(payload).success).toBe(true);
    });

    it("FakeAiService.checkUnderstanding returns valid confirmation", async () => {
      const result = await fakeAi.checkUnderstanding(
        FIXTURE_33_CONCEPTS[16]!,
        "Explain step size",
        "Gradient magnitude multiplies learning rate."
      );
      expect(checkUnderstandingResponseSchema.safeParse(result).success).toBe(true);
      expect(result.understandingConfirmed).toBe(true);
    });
  });

  // ==========================================================================
  // 7. Pipeline 2.7: summarizeMisconceptions
  // ==========================================================================

  describe("Pipeline 2.7: summarizeMisconceptions", () => {
    it("validates summarizedMisconceptionsSchema", () => {
      const payload = {
        misconceptions: ["Confusing learning rate with gradient magnitude"],
        recommendations: [
          {
            title: "Visualize Steps",
            description: "Display side-by-side loss surface plots comparing step sizes.",
            actionablePrompt: "Plot trajectories with eta=0.01 vs 1.5.",
          },
        ],
      };
      expect(summarizedMisconceptionsSchema.safeParse(payload).success).toBe(true);
    });

    it("FakeAiService.summarizeMisconceptions returns valid payload", async () => {
      const result = await fakeAi.summarizeMisconceptions(FIXTURE_CONCEPT_ID_1, [
        { answer: "too fast", outcome: "wrong" },
      ]);
      expect(summarizedMisconceptionsSchema.safeParse(result).success).toBe(true);
    });
  });

  // ==========================================================================
  // 8. Pipeline 2.8: summarizeLecture
  // ==========================================================================

  describe("Pipeline 2.8: summarizeLecture", () => {
    it("validates summarizedLectureSchema", () => {
      const payload = {
        summary: "A".repeat(150),
        keyConceptsCovered: [FIXTURE_CONCEPT_ID_1],
        timelineHighlights: [
          {
            timestampSec: 60,
            conceptLabel: "Gradient Descent",
            description: "Introduction to cost surfaces",
          },
        ],
      };
      expect(summarizedLectureSchema.safeParse(payload).success).toBe(true);
    });

    it("FakeAiService.summarizeLecture produces valid lecture summary", async () => {
      const summary = await fakeAi.summarizeLecture([
        { text: "Today we start gradient descent.", timestampSec: 0 },
      ]);
      expect(summarizedLectureSchema.safeParse(summary).success).toBe(true);
      expect(summary.keyConceptsCovered).toEqual([FIXTURE_CONCEPT_ID_2]);
      expect(summary.timelineHighlights).toHaveLength(1);
      expect(summary.timelineHighlights[0].timestampSec).toBe(0);
      expect(summary.timelineHighlights[0].description).toBe(
        "Today we start gradient descent."
      );
    });
  });

  // ==========================================================================
  // 9. Pipeline 2.9: suggestInterventions
  // ==========================================================================

  describe("Pipeline 2.9: suggestInterventions", () => {
    it("validates suggestedInterventionsSchema", () => {
      const payload = {
        misconceptions: ["Overestimating gradient step stability"],
        recommendations: [
          {
            title: "Momentum Demonstration",
            description: "Show dampening oscillations.",
            actionablePrompt: "Ask the class how momentum modifies steps.",
          },
        ],
      };
      expect(suggestedInterventionsSchema.safeParse(payload).success).toBe(true);
    });

    it("FakeAiService.suggestInterventions returns valid interventions", async () => {
      const interventions = await fakeAi.suggestInterventions(FIXTURE_COURSE_ID, []);
      expect(suggestedInterventionsSchema.safeParse(interventions).success).toBe(true);
    });
  });

  // ==========================================================================
  // 10. Pipeline 2.10: generateLearningPage
  // ==========================================================================

  describe("Pipeline 2.10: generateLearningPage", () => {
    it("validates generatedLearningPageSchema with content >= 500 characters", () => {
      expect(generatedLearningPageSchema.safeParse({ content: "Too short" }).success).toBe(false);
      expect(
        generatedLearningPageSchema.safeParse({ content: "A".repeat(500) }).success
      ).toBe(true);
    });

    it("FakeAiService.generateLearningPage returns formatted Markdown with LaTeX math >= 500 chars", async () => {
      const markdown = await fakeAi.generateLearningPage(FIXTURE_33_CONCEPTS[16]!);
      expect(markdown.length).toBeGreaterThanOrEqual(500);
      expect(markdown).toContain("# Gradient Descent");
      expect(markdown).toContain("$$\\theta_{t+1} = \\theta_t - \\eta \\nabla J(\\theta_t)$$");
      expect(generatedLearningPageSchema.safeParse({ content: markdown }).success).toBe(true);
    });
  });

  // ==========================================================================
  // 11. Pipeline 2.11: generateQuizQuestions
  // ==========================================================================

  describe("Pipeline 2.11: generateQuizQuestions", () => {
    it("validates individual quiz question schema", () => {
      const q = FIXTURE_CONCEPT_QUIZ_QUESTIONS[0]!;
      expect(generatedQuizQuestionSchema.safeParse(q).success).toBe(true);
    });

    it("enforces generated quiz question set has exactly 5 items", () => {
      expect(
        generatedQuizQuestionsSchema.safeParse({
          questions: FIXTURE_CONCEPT_QUIZ_QUESTIONS.slice(0, 4), // only 4
        }).success
      ).toBe(false);

      expect(
        generatedQuizQuestionsSchema.safeParse({
          questions: FIXTURE_CONCEPT_QUIZ_QUESTIONS,
        }).success
      ).toBe(true);
    });

    it("FakeAiService.generateQuizQuestions returns 5 valid multiple choice questions", async () => {
      const questions = await fakeAi.generateQuizQuestions(FIXTURE_33_CONCEPTS[16]!);
      expect(questions).toHaveLength(5);
      const parsed = generatedQuizQuestionsSchema.safeParse({ questions });
      expect(parsed.success).toBe(true);

      for (const q of questions) {
        expect(q.correctAnswer).toBeGreaterThanOrEqual(0);
        expect(q.correctAnswer).toBeLessThanOrEqual(3);
        expect(q.explanation.length).toBeGreaterThanOrEqual(10);
      }
    });
  });

  // ==========================================================================
  // 12. Pipeline 2.12: searchAcademicResources
  // ==========================================================================

  describe("Pipeline 2.12: searchAcademicResources", () => {
    it("validates academicResourceSchema and rejects invalid URLs", () => {
      const valid = {
        title: "Paper title",
        url: "https://arxiv.org/abs/1606.04838",
        snippet: "A valid snippet describing the paper.",
        citationNumber: 1,
      };
      expect(academicResourceSchema.safeParse(valid).success).toBe(true);

      expect(
        academicResourceSchema.safeParse({
          ...valid,
          url: "not-a-valid-url",
        }).success
      ).toBe(false);
    });

    it("FakeAiService.searchAcademicResources returns verified citation structures", async () => {
      const resources = await fakeAi.searchAcademicResources("Gradient Descent");
      expect(resources.length).toBeGreaterThanOrEqual(1);
      const parsed = academicResourcesSchema.safeParse({ resources });
      expect(parsed.success).toBe(true);

      for (const res of resources) {
        expect(res.citationNumber).toBeGreaterThan(0);
        expect(res.url).toMatch(/^https?:\/\//);
      }
    });
  });

  // ==========================================================================
  // 13. Pipeline 2.13: answerResourceQuestion
  // ==========================================================================

  describe("Pipeline 2.13: answerResourceQuestion", () => {
    it("validates answeredResourceQuestionSchema", () => {
      const payload = {
        answer: "Convex optimization guarantees convergence in polynomial time.",
        citations: [
          {
            number: 1,
            title: "Boyd & Vandenberghe",
            url: "https://web.stanford.edu/~boyd/cvxbook/",
          },
        ],
      };
      expect(answeredResourceQuestionSchema.safeParse(payload).success).toBe(true);
    });

    it("FakeAiService.answerResourceQuestion returns valid answer and citations", async () => {
      const answer = await fakeAi.answerResourceQuestion(
        FIXTURE_33_CONCEPTS[16]!,
        "What is the convergence rate?"
      );
      expect(answeredResourceQuestionSchema.safeParse(answer).success).toBe(true);
      expect(answer.citations).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 14. Learning Service Port & Fixture Verification
  // ==========================================================================

  describe("LearningService & Fixture Implementation", () => {
    it("createTutoringSession creates session returning valid UUID", async () => {
      const result = await fakeLearning.createTutoringSession(studentActor, FIXTURE_STUDENT_ID, [
        FIXTURE_CONCEPT_ID_2,
      ]);
      expect(createTutoringSessionResponseSchema.safeParse(result).success).toBe(true);
      expect(result.sessionId).toBe(FIXTURE_TUTORING_SESSION_ID);
    });

    it("submitTutoringMessage handles non-breakthrough and breakthrough turns correctly", async () => {
      // 1. Initial turn: no breakthrough
      const turn1 = await fakeLearning.submitTutoringMessage(
        studentActor,
        FIXTURE_TUTORING_SESSION_ID,
        "I need help with this concept.",
        FIXTURE_CONCEPT_ID_2
      );
      expect(submitTutoringMessageResponseSchema.safeParse(turn1).success).toBe(true);
      expect(turn1.understandingDetected).toBe(false);
      expect(turn1.masteryUpdated).toBeUndefined();

      // 2. Breakthrough turn: sets understanding and updates mastery
      const turn2 = await fakeLearning.submitTutoringMessage(
        studentActor,
        FIXTURE_TUTORING_SESSION_ID,
        "The chain rule uses intermediate activations to backpropagate gradients!",
        FIXTURE_CONCEPT_ID_2
      );
      expect(submitTutoringMessageResponseSchema.safeParse(turn2).success).toBe(true);
      expect(turn2.understandingDetected).toBe(true);
      expect(turn2.masteryUpdated).toBeDefined();
      expect(turn2.masteryUpdated?.confidence).toBe(0.7); // 0.5 + 0.2
      expect(turn2.masteryUpdated?.band).toBe("green");
    });

    it("getLearningPage returns Markdown guide for concept", async () => {
      const page = await fakeLearning.getLearningPage(studentActor, FIXTURE_CONCEPT_ID_2);
      expect(typeof page).toBe("string");
      expect(page.length).toBeGreaterThanOrEqual(500);
    });

    it("getQuiz returns 5 sanitized questions without leaking answers", async () => {
      const questions = await fakeLearning.getQuiz(studentActor, FIXTURE_CONCEPT_ID_2);
      expect(questions).toHaveLength(5);

      for (const q of questions) {
        expect(studentQuizQuestionSchema.safeParse(q).success).toBe(true);
        // Guarantee answer keys and explanations are omitted in student view
        expect(q).not.toHaveProperty("correctAnswer");
        expect(q).not.toHaveProperty("explanation");
      }
    });

    it("submitQuiz evaluates answers, calculates score, and applies mastery update", async () => {
      // Submit all 5 correct answers
      const allCorrectAnswers = FIXTURE_CONCEPT_QUIZ_QUESTIONS.map((q) => ({
        questionId: q.id,
        selectedOption: q.correctAnswer,
      }));

      const result = await fakeLearning.submitQuiz(
        studentActor,
        FIXTURE_STUDENT_ID,
        FIXTURE_CONCEPT_ID_2,
        allCorrectAnswers
      );

      const parsed = submitQuizResponseSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.correctCount).toBe(5);
        expect(parsed.data.totalQuestions).toBe(5);
        expect(parsed.data.score).toBe(1.0);
        // Starting confidence was 0.50. Quiz score 1.0 (>= 0.80) applies delta +0.15 -> 0.65 (yellow)
        expect(parsed.data.newConfidence).toBe(0.65);
        expect(parsed.data.newBand).toBe("yellow");
      }
    });

    it("submitQuiz handles imperfect quiz attempts", async () => {
      // Submit 2 correct and 3 wrong answers (score 0.40)
      const partialAnswers = [
        { questionId: FIXTURE_CONCEPT_QUIZ_QUESTIONS[0]!.id, selectedOption: FIXTURE_CONCEPT_QUIZ_QUESTIONS[0]!.correctAnswer },
        { questionId: FIXTURE_CONCEPT_QUIZ_QUESTIONS[1]!.id, selectedOption: FIXTURE_CONCEPT_QUIZ_QUESTIONS[1]!.correctAnswer },
        { questionId: FIXTURE_CONCEPT_QUIZ_QUESTIONS[2]!.id, selectedOption: (FIXTURE_CONCEPT_QUIZ_QUESTIONS[2]!.correctAnswer + 1) % 4 },
        { questionId: FIXTURE_CONCEPT_QUIZ_QUESTIONS[3]!.id, selectedOption: (FIXTURE_CONCEPT_QUIZ_QUESTIONS[3]!.correctAnswer + 1) % 4 },
        { questionId: FIXTURE_CONCEPT_QUIZ_QUESTIONS[4]!.id, selectedOption: (FIXTURE_CONCEPT_QUIZ_QUESTIONS[4]!.correctAnswer + 1) % 4 },
      ];

      const result = await fakeLearning.submitQuiz(
        studentActor,
        FIXTURE_STUDENT_2_ID,
        FIXTURE_CONCEPT_ID_2,
        partialAnswers
      );

      expect(result.correctCount).toBe(2);
      expect(result.score).toBe(0.4);
      // Starting from default 0.50, delta for 0.40 is +0.05 -> 0.55
      expect(result.newConfidence).toBe(0.55);
      expect(result.newBand).toBe("yellow");
    });

    it("teacherActor can inspect student learning page and practice quiz templates", async () => {
      const page = await fakeLearning.getLearningPage(teacherActor, FIXTURE_CONCEPT_ID_2);
      expect(page).toContain("# Gradient Descent");

      const quiz = await fakeLearning.getQuiz(teacherActor, FIXTURE_CONCEPT_ID_2);
      expect(quiz).toHaveLength(5);
      expect(getQuizResponseSchema.safeParse({ conceptId: FIXTURE_CONCEPT_ID_2, questions: quiz }).success).toBe(true);
    });

    it("validates all learning entity and request/response DTO schemas", () => {
      // Candidate schema
      expect(detectConceptsCandidateSchema.safeParse({ id: FIXTURE_CONCEPT_ID_1, label: "SGD" }).success).toBe(true);

      // Tutor conversation message
      expect(tutorConversationMessageSchema.safeParse({ role: "user", content: "Hello" }).success).toBe(true);

      // Recommendations and highlights
      expect(misconceptionRecommendationSchema.safeParse({ title: "Title", description: "Long enough description", actionablePrompt: "Long enough prompt" }).success).toBe(true);
      expect(lectureTimelineHighlightSchema.safeParse({ timestampSec: 0, conceptLabel: "SGD", description: "Intro" }).success).toBe(true);
      expect(interventionRecommendationSchema.safeParse({ title: "T", description: "D", actionablePrompt: "P" }).success).toBe(true);
      expect(resourceCitationSchema.safeParse({ number: 1, title: "T", url: "https://example.com" }).success).toBe(true);

      // Tutoring session & message schemas
      expect(tutoringSessionStatusSchema.safeParse("active").success).toBe(true);
      expect(tutoringMessageRoleSchema.safeParse("assistant").success).toBe(true);

      const session = {
        id: FIXTURE_TUTORING_SESSION_ID,
        studentId: FIXTURE_STUDENT_ID,
        targetConcepts: [FIXTURE_CONCEPT_ID_2],
        status: "active" as const,
        createdAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
      };
      expect(tutoringSessionSchema.safeParse(session).success).toBe(true);

      const msg = {
        id: FIXTURE_TUTORING_SESSION_ID,
        sessionId: FIXTURE_TUTORING_SESSION_ID,
        role: "assistant" as const,
        content: "What is gradient descent?",
        conceptId: FIXTURE_CONCEPT_ID_2,
        understandingDetected: false,
        createdAt: "2026-10-20T12:00:00.000Z",
      };
      expect(tutoringMessageSchema.safeParse(msg).success).toBe(true);

      // Request & Response DTOs
      expect(createTutoringSessionRequestSchema.safeParse({ studentId: FIXTURE_STUDENT_ID, conceptIds: [FIXTURE_CONCEPT_ID_2] }).success).toBe(true);
      expect(submitTutoringMessageRequestSchema.safeParse({ content: "What is this?" }).success).toBe(true);

      // Learning Page
      const page = {
        id: FIXTURE_CONCEPT_ID_2,
        conceptId: FIXTURE_CONCEPT_ID_2,
        content: "# Markdown",
        createdAt: "2026-10-20T12:00:00.000Z",
      };
      expect(conceptLearningPageSchema.safeParse(page).success).toBe(true);
      expect(getLearningPageResponseSchema.safeParse({ conceptId: FIXTURE_CONCEPT_ID_2, content: "# Markdown" }).success).toBe(true);

      // Quiz Question entity & Student Quiz Question
      const quizQ = FIXTURE_CONCEPT_QUIZ_QUESTIONS[0]!;
      expect(conceptQuizQuestionSchema.safeParse(quizQ).success).toBe(true);
      expect(FIXTURE_STUDENT_QUIZ_QUESTIONS).toHaveLength(5);

      // Submit quiz schemas
      expect(submitQuizAnswerSchema.safeParse({ questionId: quizQ.id, selectedOption: 1 }).success).toBe(true);
      expect(submitQuizRequestSchema.safeParse({ studentId: FIXTURE_STUDENT_ID, conceptId: FIXTURE_CONCEPT_ID_2, answers: [{ questionId: quizQ.id, selectedOption: 1 }] }).success).toBe(true);
      expect(FIXTURE_QUIZ_ATTEMPT_ID).toBeDefined();
    });
  });
});
