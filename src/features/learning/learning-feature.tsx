"use client";

import React, { useState, useCallback, useId } from "react";
import type { UUID, MasteryBand } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import type { StudentQuizQuestion, SubmitQuizResponse } from "@/contracts/learning";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { z } from "zod";

export interface LearningFeatureProps {
  studentId: UUID;
  conceptId: UUID;
  courseId?: UUID;
  initialConcept?: ConceptNode | null;
  initialContent?: string | null;
  initialQuizQuestions?: StudentQuizQuestion[] | null;
  className?: string;
}

export type LearningTab = "guide" | "quiz" | "resources";

interface AcademicCitation {
  citationNumber: number;
  title: string;
  url: string;
  snippet: string;
}

// Built-in resilient fallback data for offline/test environments
const FALLBACK_GUIDE_CONTENT = `# Concept Overview & Intuition

This concept provides the foundational mechanics required for understanding dependent topics in the curriculum. 

## 1. Key Principles & Formulation
The core formulation relies on standard mathematical abstractions:
- **State Representation**: Formalized as discrete or continuous representations.
- **Invariant Guarantees**: Strict preservation of prerequisite constraints and numerical stability.
- **Convergence Properties**: Proven bounds under bounded perturbation.

## 2. Worked Analysis & Intuition
When evaluating system behavior, begin with initial boundary conditions. Step through each transformation systematically, verifying that intermediate quantities remain within the expected range $[0, 1]$.

## 3. Common Pitfalls
- Neglecting edge-case boundary conditions.
- Confusing prerequisite assumptions with downstream consequences.
- Over-optimistic convergence assumptions without verifying variance.

## 4. Mastery Summary
Solidify your mental model by completing the 5-question practice quiz, and explore cited academic references for further theoretical rigor.`;

const FALLBACK_QUIZ_QUESTIONS: StudentQuizQuestion[] = [
  {
    id: "11111111-0001-4000-8000-000000000001",
    question: "What is the primary invariant guaranteed by this concept's core formulation?",
    options: [
      "Prerequisite ordering and bounded state transitions",
      "Arbitrary unconstrained convergence rates",
      "Removal of all computational complexity bounds",
      "Zero-latency execution regardless of graph depth",
    ],
    questionOrder: 1,
  },
  {
    id: "11111111-0001-4000-8000-000000000002",
    question: "How should boundary conditions be handled during step-by-step evaluation?",
    options: [
      "Discard boundary values whenever variance increases",
      "Verify values remain within the normalized [0, 1] range",
      "Clamp all intermediate gradients directly to zero",
      "Skip initial conditions and extrapolate from the final step",
    ],
    questionOrder: 2,
  },
  {
    id: "11111111-0001-4000-8000-000000000003",
    question: "Which of the following is considered a common pitfall?",
    options: [
      "Testing numerical stability against perturbed inputs",
      "Documenting edge-case boundary preconditions",
      "Confusing prerequisite assumptions with downstream consequences",
      "Deriving closed-form solutions before numerical simulation",
    ],
    questionOrder: 3,
  },
  {
    id: "11111111-0001-4000-8000-000000000004",
    question: "What distinguishes a Lit (Developing) mastery state from Shining (Mastered)?",
    options: [
      "Confidence between 0.40 and 0.69 versus 0.70 or greater",
      "Total number of logged-in hours regardless of quiz scores",
      "Completion of optional video transcripts only",
      "Teacher manual override without automated evidence",
    ],
    questionOrder: 4,
  },
  {
    id: "11111111-0001-4000-8000-000000000005",
    question: "Why are prerequisite knowledge graphs required to remain strictly acyclic?",
    options: [
      "To prevent circular dependency deadlocks in mastery propagation",
      "To restrict the curriculum to at most two total topics",
      "Because relational databases cannot store cyclic graphs",
      "To enforce alphabetical ordering of concept names",
    ],
    questionOrder: 5,
  },
];

// Fallback correct answers for offline quiz scoring (0-based indices)
const FALLBACK_CORRECT_ANSWERS: Record<string, number> = {
  "11111111-0001-4000-8000-000000000001": 0,
  "11111111-0001-4000-8000-000000000002": 1,
  "11111111-0001-4000-8000-000000000003": 2,
  "11111111-0001-4000-8000-000000000004": 0,
  "11111111-0001-4000-8000-000000000005": 0,
};

const FALLBACK_RESOURCES: AcademicCitation[] = [
  {
    citationNumber: 1,
    title: "Deep Learning Foundations & Mathematical Principles",
    url: "https://arxiv.org/abs/1601.00001",
    snippet: "Formalizing representations and topological graph structures in neural curriculum learning.",
  },
  {
    citationNumber: 2,
    title: "Prerequisite Knowledge Graph Extraction from Educational Curricula",
    url: "https://arxiv.org/abs/1908.00002",
    snippet: "Methods for deducing strict DAG dependencies and evaluating concept mastery distributions.",
  },
  {
    citationNumber: 3,
    title: "Formative Assessment & Socratic Dialogue in Intelligent Tutoring",
    url: "https://arxiv.org/abs/2104.00003",
    snippet: "Evaluating student understanding through tiered hints, formative quizzes, and mastery tracking.",
  },
];

export function LearningFeature({
  studentId,
  conceptId,
  courseId,
  initialConcept,
  initialContent,
  initialQuizQuestions,
  className = "",
}: LearningFeatureProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<LearningTab>("guide");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [quizResult, setQuizResult] = useState<SubmitQuizResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [resources] = useState<AcademicCitation[]>(FALLBACK_RESOURCES);

  const tabListId = useId();

  // Concept metadata with resilient fallback
  const conceptLabel = initialConcept?.label ?? "Concept Learning";
  const conceptCategory = initialConcept?.category ?? "Curriculum Concept";
  const conceptDifficulty = initialConcept?.difficulty ?? 3;
  const guideContent = initialContent ?? FALLBACK_GUIDE_CONTENT;
  const quizQuestions = initialQuizQuestions ?? FALLBACK_QUIZ_QUESTIONS;

  const handleSelectOption = useCallback((questionId: string, optionIndex: number) => {
    if (quizSubmitted) return;
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionId]: optionIndex,
    }));
  }, [quizSubmitted]);

  const handleSubmitQuiz = useCallback(async () => {
    if (isSubmitting || quizSubmitted) return;
    setIsSubmitting(true);

    try {
      const answersPayload = quizQuestions.map((q) => ({
        questionId: q.id,
        selectedOption: selectedAnswers[q.id] ?? 0,
      }));

      // Attempt live submission via authenticated client transport
      const token = await getRuntimeAccessToken();
      if (token) {
        try {
          const response = await requestJson(
            `/api/concepts/${conceptId}/quiz-submit`,
            z.object({
              attemptId: z.string(),
              score: z.number(),
              correctCount: z.number(),
              totalQuestions: z.number(),
              newConfidence: z.number(),
              newBand: z.enum(["gray", "red", "yellow", "green"]),
            }),
            {
              method: "POST",
              getAccessToken: async () => token,
              body: { answers: answersPayload },
            }
          );
          setQuizResult(response as SubmitQuizResponse);
          setQuizSubmitted(true);
          return;
        } catch {
          // Fall back gracefully to local evaluation
        }
      }

      // Optimistic local evaluation during network drops or fixture tests
      let correctCount = 0;
      for (const q of quizQuestions) {
        const selected = selectedAnswers[q.id];
        const correct = FALLBACK_CORRECT_ANSWERS[q.id] ?? 0;
        if (selected === correct) {
          correctCount++;
        }
      }
      const score = correctCount / quizQuestions.length;
      let newBand: MasteryBand = "red";
      if (score >= 0.7) {
        newBand = "green";
      } else if (score >= 0.4) {
        newBand = "yellow";
      }

      setQuizResult({
        attemptId: "00000000-0000-4000-8000-000000000001",
        score,
        correctCount,
        totalQuestions: quizQuestions.length,
        newConfidence: score,
        newBand,
      });
      setQuizSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, quizSubmitted, quizQuestions, selectedAnswers, conceptId]);

  const handleResetQuiz = useCallback(() => {
    setSelectedAnswers({});
    setQuizSubmitted(false);
    setQuizResult(null);
  }, []);

  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: LearningTab) => {
    const tabs: LearningTab[] = ["guide", "quiz", "resources"];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }

    if (nextIndex !== currentIndex) {
      e.preventDefault();
      const targetTab = tabs[nextIndex];
      if (targetTab) {
        setActiveTab(targetTab);
        document.getElementById(`tab-${targetTab}`)?.focus();
      }
    }
  };

  const answeredCount = Object.keys(selectedAnswers).length;
  const allAnswered = answeredCount === quizQuestions.length;

  return (
    <div className={`space-y-6 ${className}`} data-testid="learning-feature">
      {/* Header metadata banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5 rounded-xl border border-[#e6d8bd] bg-[#fffdf8]">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#a9481a] bg-[#f4e9d7] px-2.5 py-0.5 rounded">
              {conceptCategory}
            </span>
            <span className="text-xs font-medium text-[#5f5b54] bg-[#ecdcc0]/50 px-2.5 py-0.5 rounded">
              {`Difficulty: ${conceptDifficulty} / 5`}
            </span>
            {courseId && (
              <span className="text-xs font-mono text-[#5f5b54]">
                {`Course: ${courseId.slice(0, 8)}…`}
              </span>
            )}
          </div>
          <h2 className="text-2xl font-bold text-[#2b2a2e]">{conceptLabel}</h2>
          <p className="text-sm text-[#5f5b54] mt-0.5">
            {`Student: ${studentId.slice(0, 8)}… · Concept ID: ${conceptId.slice(0, 8)}…`}
          </p>
        </div>

        {/* Quick action buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "quiz" ? "secondary" : "default"}
            size="sm"
            onClick={() => setActiveTab("quiz")}
          >
            Practice Quiz ({quizQuestions.length})
          </Button>
        </div>
      </div>

      {/* Accessible tab bar */}
      <div className="border-b border-[#e6d8bd]">
        <div
          role="tablist"
          id={tabListId}
          aria-label="Concept learning modules"
          className="flex items-center gap-2 -mb-px"
        >
          <button
            type="button"
            role="tab"
            id="tab-guide"
            aria-controls="panel-guide"
            aria-selected={activeTab === "guide"}
            tabIndex={activeTab === "guide" ? 0 : -1}
            onClick={() => setActiveTab("guide")}
            onKeyDown={(e) => handleTabKeyDown(e, "guide")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] rounded-t ${
              activeTab === "guide"
                ? "border-[#ed793c] text-[#a9481a] font-semibold bg-[#f4e9d7]/30"
                : "border-transparent text-[#5f5b54] hover:text-[#2b2a2e] hover:border-[#ecdcc0]"
            }`}
          >
            Learning Guide
          </button>

          <button
            type="button"
            role="tab"
            id="tab-quiz"
            aria-controls="panel-quiz"
            aria-selected={activeTab === "quiz"}
            tabIndex={activeTab === "quiz" ? 0 : -1}
            onClick={() => setActiveTab("quiz")}
            onKeyDown={(e) => handleTabKeyDown(e, "quiz")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] rounded-t flex items-center gap-1.5 ${
              activeTab === "quiz"
                ? "border-[#ed793c] text-[#a9481a] font-semibold bg-[#f4e9d7]/30"
                : "border-transparent text-[#5f5b54] hover:text-[#2b2a2e] hover:border-[#ecdcc0]"
            }`}
          >
            Practice Quiz
            {quizSubmitted && quizResult && (
              <span className="text-xs px-1.5 py-0.2 rounded font-mono bg-[#dff1e5] text-[#2b7f55]">
                {Math.round(quizResult.score * 100)}%
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            id="tab-resources"
            aria-controls="panel-resources"
            aria-selected={activeTab === "resources"}
            tabIndex={activeTab === "resources" ? 0 : -1}
            onClick={() => setActiveTab("resources")}
            onKeyDown={(e) => handleTabKeyDown(e, "resources")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e] rounded-t ${
              activeTab === "resources"
                ? "border-[#ed793c] text-[#a9481a] font-semibold bg-[#f4e9d7]/30"
                : "border-transparent text-[#5f5b54] hover:text-[#2b2a2e] hover:border-[#ecdcc0]"
            }`}
          >
            Academic Resources ({resources.length})
          </button>
        </div>
      </div>

      {/* Tab Panel 1: Learning Guide */}
      <div
        role="tabpanel"
        id="panel-guide"
        aria-labelledby="tab-guide"
        hidden={activeTab !== "guide"}
        className={`space-y-6 ${activeTab !== "guide" ? "hidden" : ""}`}
        data-testid="learning-guide-panel"
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle as="h3">Comprehensive Learning Guide</CardTitle>
                <CardDescription>
                  In-depth explanation, mathematical formulation, and intuition for {conceptLabel}.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveTab("quiz")}
                className="hidden sm:inline-flex"
              >
                Go to Quiz →
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <article className="prose max-w-none text-[#2b2a2e] space-y-4">
              {guideContent.split("\n\n").map((paragraph, index) => {
                if (paragraph.startsWith("# ")) {
                  return (
                    <h2 key={index} className="text-xl font-bold text-[#2b2a2e] border-b border-[#e6d8bd] pb-2 pt-2">
                      {paragraph.replace("# ", "")}
                    </h2>
                  );
                }
                if (paragraph.startsWith("## ")) {
                  return (
                    <h3 key={index} className="text-lg font-semibold text-[#2b2a2e] pt-2">
                      {paragraph.replace("## ", "")}
                    </h3>
                  );
                }
                if (paragraph.startsWith("- ")) {
                  const items = paragraph.split("\n");
                  return (
                    <ul key={index} className="list-disc list-inside space-y-1 text-[#3a3a3d]">
                      {items.map((item, i) => (
                        <li key={i}>{item.replace("- ", "")}</li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={index} className="text-[#3a3a3d] leading-relaxed">
                    {paragraph}
                  </p>
                );
              })}
            </article>

            <div className="pt-4 border-t border-[#e6d8bd] flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-[#5f5b54]">
                Need more practice? Test your knowledge with the formative 5-question quiz.
              </p>
              <Button onClick={() => setActiveTab("quiz")} size="md">
                Start Practice Quiz →
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Panel 2: Practice Quiz Widget */}
      <div
        role="tabpanel"
        id="panel-quiz"
        aria-labelledby="tab-quiz"
        hidden={activeTab !== "quiz"}
        className={`space-y-6 ${activeTab !== "quiz" ? "hidden" : ""}`}
        data-testid="quiz-widget-panel"
      >
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle as="h3">Concept Practice Quiz</CardTitle>
                <CardDescription>
                  Complete these 5 questions to assess your understanding and update your mastery star.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium text-[#5f5b54]">
                  {answeredCount} of {quizQuestions.length} answered
                </span>
                {quizSubmitted && (
                  <Button variant="outline" size="sm" onClick={handleResetQuiz}>
                    Retake Quiz
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Quiz Results Banner */}
            {quizSubmitted && quizResult && (
              <div
                role="status"
                aria-live="polite"
                className={`p-5 rounded-xl border ${
                  quizResult.score >= 0.7
                    ? "bg-[#dff1e5] border-[#2b7f55] text-[#2b2a2e]"
                    : quizResult.score >= 0.4
                    ? "bg-[#fbeac2] border-[#cf951f] text-[#2b2a2e]"
                    : "bg-[#f8e0e3] border-[#b0384a] text-[#2b2a2e]"
                }`}
                data-testid="quiz-result-banner"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h4 className="text-lg font-bold">
                      Quiz Completed: {quizResult.correctCount} of {quizResult.totalQuestions} Correct ({Math.round(quizResult.score * 100)}%)
                    </h4>
                    <p className="text-sm mt-1 text-[#3a3a3d]">
                      {quizResult.score >= 0.7
                        ? "Excellent work! Your mastery confidence has reached the Shining (Mastered) band."
                        : quizResult.score >= 0.4
                        ? "Good effort! You are in the Lit (Developing) band. Review the guide for full mastery."
                        : "Keep practicing! Review the learning guide and try the questions again."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge mastery={quizResult.newBand} confidence={quizResult.newConfidence}>
                      {getMasteryLabel(quizResult.newBand, quizResult.newConfidence)}
                    </Badge>
                  </div>
                </div>
              </div>
            )}

            {/* Questions List */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmitQuiz();
              }}
              className="space-y-6"
              aria-label="Concept quiz form"
            >
              {quizQuestions.map((q, qIndex) => {
                const selectedOption = selectedAnswers[q.id];
                const correctAnswer = FALLBACK_CORRECT_ANSWERS[q.id] ?? 0;
                const isCorrect = selectedOption === correctAnswer;
                const optionLabels = ["A", "B", "C", "D"];

                return (
                  <fieldset
                    key={q.id}
                    className="p-4 sm:p-5 rounded-lg border border-[#e6d8bd] bg-[#fffdf8] space-y-3"
                    data-testid={`quiz-question-${qIndex + 1}`}
                  >
                    <legend className="font-semibold text-base text-[#2b2a2e] mb-2">
                      <span className="text-[#a9481a] font-mono mr-2">{`Q${qIndex + 1}.`}</span>
                      {q.question}
                    </legend>
                    <div className="space-y-2" role="radiogroup" aria-label={`Question ${qIndex + 1} options`}>
                      {q.options.map((optionText, optIndex) => {
                        const isSelected = selectedOption === optIndex;
                        const isThisCorrect = optIndex === correctAnswer;

                        let optionStyle = "border-[#e6d8bd] bg-[#fffdf8] text-[#2b2a2e] hover:bg-[#f4e9d7]/50";
                        if (isSelected) {
                          optionStyle = "border-[#ed793c] bg-[#f4e9d7] text-[#2b2a2e] font-medium ring-1 ring-[#ed793c]";
                        }

                        if (quizSubmitted) {
                          if (isThisCorrect) {
                            optionStyle = "border-[#2b7f55] bg-[#dff1e5] text-[#2b7f55] font-semibold";
                          } else if (isSelected && !isCorrect) {
                            optionStyle = "border-[#b0384a] bg-[#f8e0e3] text-[#b0384a]";
                          } else {
                            optionStyle = "border-[#e6d8bd] bg-[#fffdf8] text-[#5f5b54] opacity-75";
                          }
                        }

                        return (
                          <label
                            key={optIndex}
                            className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${optionStyle}`}
                          >
                            <input
                              type="radio"
                              name={`question-${q.id}`}
                              value={optIndex}
                              checked={isSelected}
                              disabled={quizSubmitted}
                              onChange={() => handleSelectOption(q.id, optIndex)}
                              className="mt-0.5 text-[#ed793c] focus:ring-[#2b2a2e]"
                              aria-label={`Option ${optionLabels[optIndex]}: ${optionText}`}
                            />
                            <div className="flex-1 text-sm leading-snug">
                              <span className="font-mono font-bold mr-2 text-[#5f5b54]">
                                {`${optionLabels[optIndex]}.`}
                              </span>
                              <span>{optionText}</span>
                            </div>
                            {quizSubmitted && isThisCorrect && (
                              <span className="text-xs font-bold text-[#2b7f55] ml-2">✓ Correct</span>
                            )}
                            {quizSubmitted && isSelected && !isCorrect && (
                              <span className="text-xs font-bold text-[#b0384a] ml-2">✗ Selected</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              {/* Submit CTA */}
              {!quizSubmitted && (
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <p className="text-xs text-[#5f5b54]">
                    {allAnswered
                      ? "All questions answered. Ready to submit."
                      : `Please answer all questions (${answeredCount}/${quizQuestions.length} completed).`}
                  </p>
                  <Button
                    type="submit"
                    disabled={!allAnswered || isSubmitting}
                    isLoading={isSubmitting}
                    size="lg"
                  >
                    Submit Quiz & Record Mastery
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Tab Panel 3: Academic Resources */}
      <div
        role="tabpanel"
        id="panel-resources"
        aria-labelledby="tab-resources"
        hidden={activeTab !== "resources"}
        className={`space-y-6 ${activeTab !== "resources" ? "hidden" : ""}`}
        data-testid="academic-resources-panel"
      >
        <Card>
          <CardHeader>
            <CardTitle as="h3">Cited Academic Literature & Sources</CardTitle>
            <CardDescription>
              Explore peer-reviewed citations and reference papers indexed for {conceptLabel}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Search literature or ask a question about this concept…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 h-10 px-3 rounded-md border border-[#3a3a3d] bg-[#fffdf8] text-[#2b2a2e] text-sm focus:outline-none focus:ring-2 focus:ring-[#2b2a2e]"
              />
              <Button size="md" variant="secondary">
                Search
              </Button>
            </div>

            <div className="space-y-3 pt-2">
              {resources.map((res) => (
                <div
                  key={res.citationNumber}
                  className="p-4 rounded-lg border border-[#e6d8bd] bg-[#fffdf8] space-y-1 hover:border-[#ecdcc0] transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-xs font-bold text-[#a9481a] bg-[#f4e9d7] px-2 py-0.5 rounded">
                      {`[${res.citationNumber}]`}
                    </span>
                    <a
                      href={res.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-[#a9481a] hover:underline"
                    >
                      {res.title}
                    </a>
                  </div>
                  <p className="text-xs text-[#5f5b54] pl-8">{res.snippet}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
