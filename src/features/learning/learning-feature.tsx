"use client";

import React, { useState, useEffect, useCallback, useId, useRef } from "react";
import type { UUID } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import {
  type StudentQuizQuestion,
  type SubmitQuizResponse,
  getLearningPageResponseSchema,
  getQuizResponseSchema,
  submitQuizResponseSchema,
} from "@/contracts/learning";
import {
  type AcademicResource,
  type AnsweredResourceQuestion,
  academicResourcesSchema,
  answeredResourceQuestionSchema,
} from "@/contracts/ai";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { MathMarkdown } from "./math-markdown";
import { FeatureErrorBoundary, FeatureErrorNotice } from "./feature-error-boundary";

export type LearningTab = "guide" | "quiz" | "resources";

export interface LearningFeatureProps {
  studentId: UUID;
  conceptId: UUID;
  courseId?: UUID;
  initialConcept?: ConceptNode;
  initialContent?: string;
  initialQuizQuestions?: StudentQuizQuestion[];
  className?: string;
}

function isSafeUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateQuizQuestions(questions?: StudentQuizQuestion[]): StudentQuizQuestion[] | null {
  if (!questions || questions.length !== 5) {
    return null;
  }
  const uniqueIds = new Set<string>();
  for (const q of questions) {
    if (!q.id || uniqueIds.has(q.id)) {
      return null;
    }
    uniqueIds.add(q.id);
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      return null;
    }
  }
  return questions;
}

function InnerLearningView({
  studentId,
  conceptId,
  courseId,
  initialConcept,
  initialContent,
  initialQuizQuestions,
  className = "",
}: LearningFeatureProps): React.JSX.Element {
  const baseId = useId();
  const tabIdGuide = `${baseId}-tab-guide`;
  const tabIdQuiz = `${baseId}-tab-quiz`;
  const tabIdResources = `${baseId}-tab-resources`;
  const panelIdGuide = `${baseId}-panel-guide`;
  const panelIdQuiz = `${baseId}-panel-quiz`;
  const panelIdResources = `${baseId}-panel-resources`;

  const [activeTab, setActiveTab] = useState<LearningTab>("guide");

  // Metadata
  const conceptLabel = initialConcept?.label ?? "Concept Learning";
  const conceptCategory = initialConcept?.category ?? "Curriculum Concept";
  const conceptDifficulty = initialConcept?.difficulty ?? 3;

  // Guide State
  const [guideContent, setGuideContent] = useState<string | null>(() =>
    initialContent !== undefined ? initialContent : null
  );
  const [isLoadingGuide, setIsLoadingGuide] = useState<boolean>(initialContent === undefined);
  const [guideError, setGuideError] = useState<string | null>(null);

  // Quiz State
  const [quizQuestions, setQuizQuestions] = useState<StudentQuizQuestion[] | null>(() =>
    validateQuizQuestions(initialQuizQuestions)
  );
  const [isLoadingQuiz, setIsLoadingQuiz] = useState<boolean>(false);
  const [quizLoadError, setQuizLoadError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);
  const [isSubmittingQuiz, setIsSubmittingQuiz] = useState<boolean>(false);
  const [quizSubmitError, setQuizSubmitError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<SubmitQuizResponse | null>(null);

  // Resources State
  const [resources, setResources] = useState<AcademicResource[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchingResources, setIsSearchingResources] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [questionQuery, setQuestionQuery] = useState<string>("");
  const [qaResult, setQaResult] = useState<AnsweredResourceQuestion | null>(null);
  const [isAskingQuestion, setIsAskingQuestion] = useState<boolean>(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Fetch Guide Content if not supplied
  const fetchGuideContent = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingGuide(true);
      setGuideError(null);
      try {
        const data = await requestJson(
          `/api/concepts/${conceptId}/learning-page`,
          getLearningPageResponseSchema,
          { getAccessToken: getRuntimeAccessToken, signal }
        );
        setGuideContent(data.content);
      } catch (err: unknown) {
        if (signal?.aborted) return;
        setGuideError(
          err instanceof Error ? err.message : "Failed to load learning guide."
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoadingGuide(false);
        }
      }
    },
    [conceptId]
  );

  useEffect(() => {
    if (initialContent !== undefined) {
      setGuideContent(initialContent);
      setIsLoadingGuide(false);
      setGuideError(null);
      return;
    }

    const controller = new AbortController();
    fetchGuideContent(controller.signal);
    return () => {
      controller.abort();
    };
  }, [initialContent, conceptId, fetchGuideContent]);

  // Fetch Quiz Questions
  const fetchQuizQuestions = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingQuiz(true);
      setQuizLoadError(null);
      try {
        const data = await requestJson(
          `/api/concepts/${conceptId}/quiz`,
          getQuizResponseSchema,
          { getAccessToken: getRuntimeAccessToken, signal }
        );
        const validated = validateQuizQuestions(data.questions);
        if (!validated) {
          throw new Error("Invalid quiz questions returned by server.");
        }
        setQuizQuestions(validated);
      } catch (err: unknown) {
        if (signal?.aborted) return;
        hasFetchedQuizRef.current = false;
        setQuizLoadError(
          err instanceof Error ? err.message : "Failed to load quiz questions."
        );
        if (!signal?.aborted) {
          setIsLoadingQuiz(false);
        }
      }
    },
    [conceptId]
  );

  const hasFetchedQuizRef = useRef<boolean>(false);

  useEffect(() => {
    hasFetchedQuizRef.current = false;
  }, [conceptId]);

  // Lazy fetch quiz when tab becomes "quiz" if not loaded yet
  useEffect(() => {
    if (activeTab === "quiz" && !quizQuestions && !hasFetchedQuizRef.current) {
      hasFetchedQuizRef.current = true;
      const controller = new AbortController();
      fetchQuizQuestions(controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [activeTab, quizQuestions, fetchQuizQuestions]);
  // Handle Radio Selection
  const handleSelectOption = useCallback(
    (questionId: string, optionIndex: number) => {
      if (quizSubmitted || isSubmittingQuiz) return;
      setSelectedAnswers((prev) => ({
        ...prev,
        [questionId]: optionIndex,
      }));
    },
    [quizSubmitted, isSubmittingQuiz]
  );

  // Submit Quiz
  const handleSubmitQuiz = useCallback(async () => {
    if (isSubmittingQuiz || quizSubmitted || !quizQuestions || quizQuestions.length !== 5) {
      return;
    }

    // Verify all 5 questions have valid selected options
    for (const q of quizQuestions) {
      if (selectedAnswers[q.id] === undefined) {
        setQuizSubmitError("Please answer all 5 questions before submitting.");
        return;
      }
    }

    setIsSubmittingQuiz(true);
    setQuizSubmitError(null);

    try {
      const answersPayload = quizQuestions.map((q) => ({
        questionId: q.id,
        selectedOption: selectedAnswers[q.id]!,
      }));

      const response = await requestJson(
        `/api/concepts/${conceptId}/quiz-submit`,
        submitQuizResponseSchema,
        {
          method: "POST",
          getAccessToken: getRuntimeAccessToken,
          body: { answers: answersPayload },
        }
      );

      setQuizResult(response);
      setQuizSubmitted(true);
    } catch (err: unknown) {
      setQuizSubmitError(
        err instanceof Error ? err.message : "Failed to submit quiz."
      );
    } finally {
      setIsSubmittingQuiz(false);
    }
  }, [isSubmittingQuiz, quizSubmitted, quizQuestions, selectedAnswers, conceptId]);

  // Reset Quiz
  const handleResetQuiz = useCallback(() => {
    setSelectedAnswers({});
    setQuizSubmitted(false);
    setQuizResult(null);
    setQuizSubmitError(null);
  }, []);

  // Search Resources
  const handleSearchResources = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSearchingResources(true);
      setSearchError(null);
      try {
        const body: { conceptId: UUID; query?: string } = { conceptId };
        const trimmed = searchQuery.trim();
        if (trimmed) {
          body.query = trimmed;
        }

        const data = await requestJson(
          "/api/resources/search",
          academicResourcesSchema,
          {
            method: "POST",
            getAccessToken: getRuntimeAccessToken,
            body,
          }
        );
        setResources(data.resources);
      } catch (err: unknown) {
        setSearchError(
          err instanceof Error ? err.message : "Failed to search academic resources."
        );
      } finally {
        setIsSearchingResources(false);
      }
    },
    [conceptId, searchQuery]
  );

  // Ask Question on Resources
  const handleAskQuestion = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = questionQuery.trim();
      if (!trimmed || isAskingQuestion) return;

      setIsAskingQuestion(true);
      setAskError(null);
      try {
        const data = await requestJson(
          "/api/resources/ask",
          answeredResourceQuestionSchema,
          {
            method: "POST",
            getAccessToken: getRuntimeAccessToken,
            body: {
              conceptId,
              question: trimmed,
            },
          }
        );
        setQaResult(data);
      } catch (err: unknown) {
        setAskError(
          err instanceof Error ? err.message : "Failed to get answer for resource question."
        );
      } finally {
        setIsAskingQuestion(false);
      }
    },
    [conceptId, questionQuery, isAskingQuestion]
  );

  // Keyboard navigation for tablist
  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: LearningTab) => {
    const tabs: LearningTab[] = ["guide", "quiz", "resources"];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== currentIndex) {
      e.preventDefault();
      const targetTab = tabs[nextIndex];
      if (targetTab) {
        setActiveTab(targetTab);
        const targetId =
          targetTab === "guide"
            ? tabIdGuide
            : targetTab === "quiz"
            ? tabIdQuiz
            : tabIdResources;
        document.getElementById(targetId)?.focus();
      }
    }
  };

  const answeredCount = quizQuestions
    ? quizQuestions.filter((q) => selectedAnswers[q.id] !== undefined).length
    : 0;
  const allAnswered = quizQuestions ? answeredCount === quizQuestions.length : false;

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
            Practice Quiz {quizQuestions ? `(${quizQuestions.length})` : ""}
          </Button>
        </div>
      </div>

      {/* Accessible tab bar */}
      <div className="border-b border-[#e6d8bd] overflow-x-auto">
        <div
          role="tablist"
          id={baseId}
          aria-label="Concept learning modules"
          className="flex items-center gap-2 -mb-px min-w-max"
        >
          <button
            type="button"
            role="tab"
            id={tabIdGuide}
            aria-controls={panelIdGuide}
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
            id={tabIdQuiz}
            aria-controls={panelIdQuiz}
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
              <span className="text-xs px-1.5 py-0.2 rounded font-mono bg-[#dff1e5] text-[#1b5e3b]">
                {Math.round(quizResult.score * 100)}%
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            id={tabIdResources}
            aria-controls={panelIdResources}
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
            Academic Resources {resources.length > 0 ? `(${resources.length})` : ""}
          </button>
        </div>
      </div>

      {/* Tab Panel 1: Learning Guide */}
      <div
        role="tabpanel"
        id={panelIdGuide}
        aria-labelledby={tabIdGuide}
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
            {isLoadingGuide && (
              <div className="py-8 text-center text-sm text-[#5f5b54]">
                Loading learning guide…
              </div>
            )}

            {guideError && (
              <FeatureErrorNotice
                message={guideError}
                onRetry={() => fetchGuideContent()}
              />
            )}

            {!isLoadingGuide && !guideError && guideContent !== null && (
              guideContent.trim().length === 0 ? (
                <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-6 text-center text-sm text-[#5f5b54]">
                  No learning guide content has been authored for this concept yet.
                </div>
              ) : (
                <article className="prose max-w-none text-[#2b2a2e] space-y-4">
                  <MathMarkdown content={guideContent} />
                </article>
              )
            )}

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
        id={panelIdQuiz}
        aria-labelledby={tabIdQuiz}
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
                {quizQuestions && (
                  <span className="text-xs font-mono font-medium text-[#5f5b54]">
                    {answeredCount} of {quizQuestions.length} answered
                  </span>
                )}
                {quizSubmitted && (
                  <Button variant="outline" size="sm" onClick={handleResetQuiz}>
                    Retake Quiz
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {isLoadingQuiz && (
              <div className="py-8 text-center text-sm text-[#5f5b54]">
                Loading practice quiz questions…
              </div>
            )}

            {quizLoadError && (
              <FeatureErrorNotice
                message={quizLoadError}
                onRetry={() => fetchQuizQuestions()}
              />
            )}

            {/* Quiz Results Banner */}
            {quizSubmitted && quizResult && (
              <div
                role="status"
                aria-live="polite"
                className="p-5 rounded-xl border border-[#cf951f] bg-[#fffdf8] text-[#2b2a2e] shadow-xs"
                data-testid="quiz-result-banner"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h4 className="text-lg font-bold">
                      Quiz Completed: {quizResult.correctCount} of {quizResult.totalQuestions} Correct ({Math.round(quizResult.score * 100)}%)
                    </h4>
                    <p className="text-sm mt-1 text-[#5f5b54]">
                      Server-graded result recorded. Review your updated mastery status:
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

            {quizSubmitError && (
              <FeatureErrorNotice
                message={quizSubmitError}
                className="my-3"
              />
            )}

            {/* Questions List */}
            {quizQuestions && quizQuestions.length === 5 && (
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
                  const optionLabels = ["A", "B", "C", "D"];

                  return (
                    <fieldset
                      key={q.id}
                      className="p-4 sm:p-5 rounded-lg border border-[#e6d8bd] bg-[#fffdf8] space-y-3"
                      data-testid={`quiz-question-${qIndex + 1}`}
                    >
                      <legend className="font-semibold text-base text-[#2b2a2e] mb-2 flex items-baseline gap-2">
                        <span className="text-[#a9481a] font-mono shrink-0">{`Q${qIndex + 1}.`}</span>
                        <div className="inline-block">
                          <MathMarkdown content={q.question} />
                        </div>
                      </legend>
                      <div
                        className="space-y-2"
                        role="radiogroup"
                        aria-label={`Question ${qIndex + 1} options`}
                      >
                        {q.options.map((optionText, optIndex) => {
                          const isSelected = selectedOption === optIndex;
                          const optionInputId = `${baseId}-q-${q.id}-opt-${optIndex}`;

                          let optionStyle =
                            "border-[#e6d8bd] bg-[#fffdf8] text-[#2b2a2e] hover:bg-[#f4e9d7]/50";
                          if (isSelected) {
                            optionStyle =
                              "border-[#ed793c] bg-[#f4e9d7] text-[#2b2a2e] font-medium ring-1 ring-[#ed793c]";
                          }
                          if (quizSubmitted) {
                            optionStyle = isSelected
                              ? "border-[#a9481a] bg-[#f4e9d7] text-[#2b2a2e] font-medium"
                              : "border-[#e6d8bd] bg-[#fffdf8] text-[#5f5b54] opacity-75";
                          }

                          return (
                            <label
                              key={optIndex}
                              htmlFor={optionInputId}
                              className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${optionStyle}`}
                            >
                              <input
                                type="radio"
                                id={optionInputId}
                                name={`${baseId}-question-${q.id}`}
                                value={optIndex}
                                checked={isSelected}
                                disabled={quizSubmitted || isSubmittingQuiz}
                                onChange={() => handleSelectOption(q.id, optIndex)}
                                className="mt-1 text-[#ed793c] focus:ring-[#2b2a2e]"
                                aria-label={`Option ${optionLabels[optIndex]}: ${optionText}`}
                              />
                              <div className="flex-1 text-sm leading-snug">
                                <span className="font-mono font-bold mr-2 text-[#5f5b54]">
                                  {`${optionLabels[optIndex]}.`}
                                </span>
                                <span className="inline-block">
                                  <MathMarkdown content={optionText} />
                                </span>
                              </div>
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
                      disabled={!allAnswered || isSubmittingQuiz}
                      isLoading={isSubmittingQuiz}
                      size="lg"
                    >
                      Submit Quiz & Record Mastery
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tab Panel 3: Academic Resources */}
      <div
        role="tabpanel"
        id={panelIdResources}
        aria-labelledby={tabIdResources}
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
          <CardContent className="space-y-6">
            {/* Search literature form */}
            <form onSubmit={handleSearchResources} className="space-y-2">
              <label htmlFor={`${baseId}-search-input`} className="block text-xs font-semibold text-[#2b2a2e]">
                Search Academic Literature:
              </label>
              <div className="flex items-center gap-3">
                <input
                  id={`${baseId}-search-input`}
                  type="text"
                  placeholder="Enter keywords or topic to search cited papers…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-md border border-[#3a3a3d] bg-[#fffdf8] text-[#2b2a2e] text-sm focus:outline-none focus:ring-2 focus:ring-[#2b2a2e]"
                />
                <Button
                  type="submit"
                  size="md"
                  variant="secondary"
                  disabled={isSearchingResources}
                  isLoading={isSearchingResources}
                >
                  Search Literature
                </Button>
              </div>
            </form>

            {searchError && (
              <FeatureErrorNotice message={searchError} />
            )}

            {/* Resources list */}
            {resources.length > 0 ? (
              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold text-[#5f5b54] uppercase tracking-wider">
                  Indexed Literature ({resources.length}):
                </p>
                {resources.map((res) => {
                  const safe = isSafeUrl(res.url);
                  return (
                    <div
                      key={res.citationNumber}
                      className="p-4 rounded-lg border border-[#e6d8bd] bg-[#fffdf8] space-y-1 hover:border-[#ecdcc0] transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-xs font-bold text-[#a9481a] bg-[#f4e9d7] px-2 py-0.5 rounded">
                          {`[${res.citationNumber}]`}
                        </span>
                        {safe ? (
                          <a
                            href={res.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-[#a9481a] hover:underline"
                          >
                            {res.title}
                          </a>
                        ) : (
                          <span className="text-sm font-semibold text-[#2b2a2e]">
                            {res.title}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#5f5b54] pl-8 leading-relaxed">
                        {res.snippet}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              !isSearchingResources && (
                <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-xs text-[#5f5b54] leading-relaxed">
                  Search academic literature or ask a question citing peer-reviewed papers for this concept.
                </div>
              )
            )}

            {/* Separately labeled Q&A Form */}
            <div className="pt-4 border-t border-[#e6d8bd] space-y-4">
              <form onSubmit={handleAskQuestion} className="space-y-3">
                <label
                  htmlFor={`${baseId}-qa-input`}
                  className="block text-xs font-semibold text-[#2b2a2e]"
                >
                  Ask a Question About This Concept:
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    id={`${baseId}-qa-input`}
                    type="text"
                    placeholder="e.g. How does backpropagation scale with network depth?"
                    value={questionQuery}
                    onChange={(e) => setQuestionQuery(e.target.value)}
                    disabled={isAskingQuestion}
                    className="flex-1 h-10 px-3 rounded-md border border-[#3a3a3d] bg-[#fffdf8] text-[#2b2a2e] text-sm focus:outline-none focus:ring-2 focus:ring-[#2b2a2e] disabled:opacity-50"
                  />
                  <Button
                    type="submit"
                    size="md"
                    disabled={!questionQuery.trim() || isAskingQuestion}
                    isLoading={isAskingQuestion}
                  >
                    Ask Question
                  </Button>
                </div>
              </form>

              {askError && (
                <FeatureErrorNotice message={askError} />
              )}

              {/* Cited Q&A Result */}
              {qaResult && (
                <div
                  role="region"
                  aria-label="Cited answer"
                  className="p-5 rounded-xl border border-[#e6d8bd] bg-[#fffdf8] space-y-3 shadow-xs"
                >
                  <h4 className="text-sm font-bold text-[#2b2a2e] flex items-center gap-2">
                    <span>📖 Cited Academic Answer</span>
                  </h4>
                  <div className="text-sm leading-relaxed text-[#2b2a2e]">
                    <MathMarkdown content={qaResult.answer} />
                  </div>
                  {qaResult.citations.length > 0 && (
                    <div className="pt-2 border-t border-[#e6d8bd] space-y-1">
                      <p className="text-xs font-semibold text-[#5f5b54]">Citations:</p>
                      <ul className="text-xs space-y-1">
                        {qaResult.citations.map((c) => {
                          const safe = isSafeUrl(c.url);
                          return (
                            <li key={c.number} className="flex items-center gap-2">
                              <span className="font-mono text-[#a9481a] font-bold">[{c.number}]</span>
                              {safe ? (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#a9481a] underline hover:text-[#883610]"
                                >
                                  {c.title}
                                </a>
                              ) : (
                                <span>{c.title}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function LearningFeature(props: LearningFeatureProps): React.JSX.Element {
  const resetKey = `${props.studentId}-${props.conceptId}`;
  return (
    <FeatureErrorBoundary resetKey={resetKey}>
      <InnerLearningView {...props} />
    </FeatureErrorBoundary>
  );
}
