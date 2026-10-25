"use client";

import React, { useState, useCallback, useRef, useEffect, useId } from "react";
import { z } from "zod";
import type { UUID, ActorContext } from "@/contracts/common";
import type {
  EncounterDTO,
  EncounterResultDTO,
  EncounterQuestionDTO,
  HintLevel,
  GameSummaryDTO,
} from "@/contracts/game";
import {
  encounterSchema,
  encounterResultSchema,
  gameSummarySchema,
} from "@/contracts/game";
import { courseGraphResponseSchema } from "@/contracts/course";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { SparkMascot } from "@/features/mascot/spark-mascot";
import type { SparkMood } from "@/features/mascot/spark-moods";
import { HintDrawer } from "./hint-drawer";
import { MathMarkdown } from "@/features/learning/math-markdown";
import { requestJson, getRuntimeAccessToken, ClientApiError } from "@/lib/client/http";
import { cn } from "@/lib/client/utils";

export interface EncounterFeatureProps {
  encounter: EncounterDTO;
  conceptLabel?: string;
  onClose?: () => void;
  onCompleted?: (result: EncounterResultDTO) => void;
  className?: string;
  actor?: ActorContext;
}

const encounterRestorationResponseSchema = z.object({
  encounter: encounterSchema,
  result: encounterResultSchema.nullable(),
});

/**
 * EncounterFeature Component (P5-C-07)
 * Five-question practice encounter with KaTeX math rendering, sequential server-controlled
 * hint drawer, 84px Spark mascot mood transitions, and server-authoritative scoring.
 */
export function EncounterFeature(props: EncounterFeatureProps): React.JSX.Element {
  return (
    <EncounterSession
      key={`${props.encounter.studentId}:${props.encounter.id}`}
      {...props}
    />
  );
}

function EncounterSession({
  encounter,
  conceptLabel = "Practice Encounter",
  onClose,
  onCompleted,
  className,
  actor,
}: EncounterFeatureProps): React.JSX.Element {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [hintsPerQuestion, setHintsPerQuestion] = useState<Record<string, Partial<Record<HintLevel, string>>>>({});
  const [hintsUsedCount, setHintsUsedCount] = useState<Record<string, number>>(() =>
    encounter.questions.reduce<Record<string, number>>((acc, q) => {
      acc[q.questionId] = q.hintsUsed ?? 0;
      return acc;
    }, {})
  );

  const [openingConfidence, setOpeningConfidence] = useState<number | null>(null);
  const [gameSummary, setGameSummary] = useState<GameSummaryDTO | null>(null);
  const [contextLoading, setContextLoading] = useState<boolean>(encounter.status === "active");
  const [contextError, setContextError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isHintPending, setIsHintPending] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<EncounterResultDTO | null>(null);

  const [restoredResultLoading, setRestoredResultLoading] = useState<boolean>(false);
  const [restoredResultError, setRestoredResultError] = useState<string | null>(null);

  const [announcement, setAnnouncement] = useState<string>("");

  const submitInFlightRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const questionHeadingRef = useRef<HTMLLegendElement | null>(null);
  const rewardHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const radioGroupId = useId();

  const questions: EncounterQuestionDTO[] = encounter.questions;
  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch opening game context (game-summary and course graph confidence)
  const loadContext = useCallback(async () => {
    if (encounter.status !== "active") {
      setContextLoading(false);
      return;
    }

    setContextLoading(true);
    setContextError(null);

    try {
      // 1. Load game-summary
      const summary = await requestJson(
        `/api/students/${encodeURIComponent(encounter.studentId)}/game-summary`,
        gameSummarySchema,
        {
          method: "GET",
          getAccessToken: getRuntimeAccessToken,
        }
      );

      if (!isMountedRef.current) return;

      if (summary.studentId !== encounter.studentId) {
        setContextError("Encounter context does not match this student.");
        return;
      }

      // Check actor enrollment if actor is supplied
      if (actor) {
        const isEnrolled = actor.enrolledCourses.some(
          (e) => e.studentId === encounter.studentId && e.courseId === summary.courseId
        );
        if (!isEnrolled) {
          setContextError("Encounter context does not match this student.");
          return;
        }
      }

      // 2. Load course graph for baseline concept confidence
      const graph = await requestJson(
        `/api/courses/${encodeURIComponent(summary.courseId)}/graph`,
        courseGraphResponseSchema,
        {
          method: "GET",
          getAccessToken: getRuntimeAccessToken,
        }
      );

      if (!isMountedRef.current) return;

      const conceptNode = graph.nodes.find((n) => n.id === encounter.conceptId);
      if (
        !conceptNode ||
        typeof conceptNode.confidence !== "number" ||
        !Number.isFinite(conceptNode.confidence) ||
        conceptNode.confidence < 0 ||
        conceptNode.confidence > 1
      ) {
        setContextError("Encounter confidence is unavailable.");
        return;
      }

      setOpeningConfidence(conceptNode.confidence);
      setGameSummary(summary);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const message = err instanceof Error ? err.message : "Unable to load encounter context.";
      setContextError(message);
    } finally {
      if (isMountedRef.current) {
        setContextLoading(false);
      }
    }
  }, [encounter.status, encounter.studentId, encounter.conceptId, actor]);

  // Load completed encounter result when status is "completed"
  const loadCompletedResult = useCallback(async () => {
    setRestoredResultLoading(true);
    setRestoredResultError(null);

    try {
      const data = await requestJson(
        `/api/encounters/${encodeURIComponent(encounter.id)}`,
        encounterRestorationResponseSchema,
        {
          method: "GET",
          getAccessToken: getRuntimeAccessToken,
        }
      );

      if (!isMountedRef.current) return;

      if (data.result && data.result.encounterId === encounter.id) {
        setResult(data.result);
        if (data.result.summary) {
          setGameSummary(data.result.summary);
        }
      } else {
        setRestoredResultError("Encounter result is unavailable.");
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const message = err instanceof Error ? err.message : "Encounter result is unavailable.";
      setRestoredResultError(message);
    } finally {
      if (isMountedRef.current) {
        setRestoredResultLoading(false);
      }
    }
  }, [encounter.id]);

  useEffect(() => {
    if (encounter.status === "active") {
      void loadContext();
    } else if (encounter.status === "completed") {
      void loadCompletedResult();
    }
  }, [encounter.status, loadContext, loadCompletedResult]);

  const handleSelectOption = useCallback((questionId: UUID, optionIndex: number) => {
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionId]: optionIndex,
    }));
  }, []);

  const handleHintUnlocked = useCallback((level: HintLevel, text: string) => {
    if (!currentQuestion) return;
    const qId = currentQuestion.questionId;
    setHintsPerQuestion((prev) => ({
      ...prev,
      [qId]: {
        ...(prev[qId] ?? {}),
        [level]: text,
      },
    }));
    setHintsUsedCount((prev) => ({
      ...prev,
      [qId]: Math.max(prev[qId] ?? 0, level),
    }));
  }, [currentQuestion]);

  const handleEncounterAlreadySubmitted = useCallback(async () => {
    await loadCompletedResult();
  }, [loadCompletedResult]);

  // Check if all questions are answered
  const allAnswered = questions.every(
    (q) => typeof selectedAnswers[q.questionId] === "number" && selectedAnswers[q.questionId] >= 0
  );

  const canSubmit =
    allAnswered &&
    !isSubmitting &&
    !isHintPending &&
    !contextLoading &&
    !contextError &&
    !result &&
    encounter.status === "active";

  const handleSubmit = useCallback(async () => {
    if (submitInFlightRef.current || !canSubmit) {
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const answers = questions.map((q) => {
        const option = selectedAnswers[q.questionId];
        if (typeof option !== "number" || option < 0 || option > 3) {
          throw new Error(`Missing valid selection for question ${q.questionId}`);
        }
        return {
          questionId: q.questionId,
          selectedOption: option,
        };
      });

      const response = await requestJson(
        `/api/encounters/${encodeURIComponent(encounter.id)}/submit`,
        encounterResultSchema,
        {
          method: "POST",
          body: { answers },
          getAccessToken: getRuntimeAccessToken,
        }
      );

      if (!isMountedRef.current) return;

      if (response.encounterId !== encounter.id) {
        throw new Error("Invalid encounter response ID.");
      }

      setResult(response);
      setGameSummary(response.summary);
      setAnnouncement(
        `Encounter complete. Score: ${response.correctCount} of 5. Confidence: ${Math.round(
          response.newConfidence * 100
        )}%. XP awarded: ${response.xpAwarded}.`
      );

      // Focus reward heading on completion
      setTimeout(() => {
        rewardHeadingRef.current?.focus();
      }, 50);

      try {
        onCompleted?.(response);
      } catch (cbErr) {
        console.error("[EncounterFeature] onCompleted callback threw:", cbErr);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      if (err instanceof ClientApiError && err.code === "ENCOUNTER_ALREADY_SUBMITTED") {
        await handleEncounterAlreadySubmitted();
        return;
      }

      const message = err instanceof Error ? err.message : "Unable to submit encounter. Please try again.";
      setSubmitError(message);
    } finally {
      submitInFlightRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [
    canSubmit,
    questions,
    selectedAnswers,
    encounter.id,
    onCompleted,
    handleEncounterAlreadySubmitted,
  ]);

  const handleNextQuestion = useCallback(() => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setAnnouncement(`Question ${currentQuestionIndex + 2} of ${totalQuestions}`);
      setTimeout(() => {
        questionHeadingRef.current?.focus();
      }, 50);
    }
  }, [currentQuestionIndex, totalQuestions]);

  const handlePrevQuestion = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
      setAnnouncement(`Question ${currentQuestionIndex} of ${totalQuestions}`);
      setTimeout(() => {
        questionHeadingRef.current?.focus();
      }, 50);
    }
  }, [currentQuestionIndex, totalQuestions]);

  // Derive mascot mood and sky brightness
  let mascotMood: SparkMood = "think";
  if (result) {
    mascotMood = result.score >= 0.6 ? "cheer" : "oops";
  }

  // Effective sky brightness:
  // 1. Result summary skyBrightness if result available
  // 2. Real summary skyBrightness if loaded
  // 3. 0 during decorative initial loading state
  const effectiveSkyBrightness = result
    ? result.summary.skyBrightness
    : gameSummary
    ? gameSummary.skyBrightness
    : 0;

  // Confidence delta calculation
  let signedConfidenceDelta: string | null = null;
  if (result && openingConfidence !== null) {
    const rawDelta = Number((result.newConfidence - openingConfidence).toFixed(3));
    signedConfidenceDelta = (rawDelta >= 0 ? "+" : "") + rawDelta.toFixed(3);
  }

  // Abandoned state
  if (encounter.status === "abandoned") {
    return (
      <Card className={cn("w-full max-w-2xl mx-auto shadow-md", className)} data-testid="encounter-feature">
        <CardHeader className="pb-3 border-b border-[var(--color-border-default,#e6d8bd)]">
          <div className="flex items-center justify-between gap-4">
            <CardTitle as="h2" className="text-lg font-semibold text-[var(--color-ink,#2b2a2e)]">
              {conceptLabel}
            </CardTitle>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close encounter"
                className="h-8 w-8 p-0"
              >
                ✕
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6 pb-6 text-center space-y-3">
          <p className="text-sm font-medium text-[var(--color-fg-muted,#5f5b54)]">
            This encounter was abandoned.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Completed restoration loading or error
  if (encounter.status === "completed" && !result) {
    return (
      <Card className={cn("w-full max-w-2xl mx-auto shadow-md", className)} data-testid="encounter-feature">
        <CardHeader className="pb-3 border-b border-[var(--color-border-default,#e6d8bd)]">
          <div className="flex items-center justify-between gap-4">
            <CardTitle as="h2" className="text-lg font-semibold text-[var(--color-ink,#2b2a2e)]">
              {conceptLabel}
            </CardTitle>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close encounter"
                className="h-8 w-8 p-0"
              >
                ✕
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6 pb-6 text-center space-y-3">
          {restoredResultLoading ? (
            <p className="text-sm text-[var(--color-fg-muted,#5f5b54)]">
              Loading encounter result…
            </p>
          ) : restoredResultError ? (
            <div className="space-y-3">
              <div
                role="alert"
                className="p-3 rounded-lg bg-[var(--color-bad-tint,#f8e0e3)] text-[var(--color-bad,#b0384a)] text-xs font-medium"
              >
                {restoredResultError}
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadCompletedResult()}>
                Retry loading result
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-fg-muted,#5f5b54)]">
              Encounter result is unavailable.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full max-w-2xl mx-auto shadow-md", className)} data-testid="encounter-feature">
      {/* Live Region for Screen Readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Header */}
      <CardHeader className="pb-3 border-b border-[var(--color-border-default,#e6d8bd)]">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Practice Encounter
              </Badge>
              <span className="text-xs text-[var(--color-fg-muted,#5f5b54)]">
                {!result && `Question ${currentQuestionIndex + 1} of ${totalQuestions}`}
              </span>
            </div>
            <CardTitle as="h2" className="text-lg font-semibold text-[var(--color-ink,#2b2a2e)]">
              {conceptLabel}
            </CardTitle>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="w-[84px] h-[84px] flex items-center justify-center shrink-0"
              data-testid="encounter-mascot"
              data-mood={mascotMood}
            >
              <SparkMascot
                skyBrightness={effectiveSkyBrightness}
                mood={mascotMood}
                size={84}
              />
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close encounter"
                className="h-8 w-8 p-0"
              >
                ✕
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Context Loading Status Banner */}
        {contextLoading && (
          <div className="p-2 rounded bg-[var(--color-cream,#f4e9d7)]/60 text-xs text-[var(--color-fg-muted,#5f5b54)] text-center">
            Loading encounter context…
          </div>
        )}

        {/* Context Error Banner with Retry */}
        {contextError && (
          <div className="space-y-2">
            <div
              role="alert"
              className="p-3 rounded-lg bg-[var(--color-bad-tint,#f8e0e3)] text-[var(--color-bad,#b0384a)] text-xs font-medium"
            >
              {contextError}
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadContext()}>
              Retry loading context
            </Button>
          </div>
        )}

        {/* Result View or Quiz View */}
        {result ? (
          <div data-testid="encounter-result-card" className="space-y-4">
            <div className="space-y-1">
              <h3
                ref={rewardHeadingRef}
                tabIndex={-1}
                className="text-lg font-bold text-[var(--color-ink,#2b2a2e)] outline-none"
              >
                {result.score >= 0.6 ? "✨ Outstanding Mastery!" : "Keep Practicing!"}
              </h3>
              <p className="text-xs text-[var(--color-fg-muted,#5f5b54)]">
                Practice Encounter Completed
              </p>
            </div>

            {/* Score & Progression Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-cream,#f4e9d7)]/40 text-center">
                <span className="text-[10px] uppercase font-semibold text-[var(--color-fg-muted,#5f5b54)] block">
                  Score
                </span>
                <span className="text-base font-bold text-[var(--color-ink,#2b2a2e)]">
                  {`${result.correctCount} / 5`}
                </span>
                <span className="text-[10px] text-[var(--color-fg-muted,#5f5b54)] block">
                  {`(${Math.round(result.score * 100)}%)`}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-cream,#f4e9d7)]/40 text-center">
                <span className="text-[10px] uppercase font-semibold text-[var(--color-fg-muted,#5f5b54)] block">
                  XP Earned
                </span>
                <span className="text-base font-bold text-[var(--color-orange,#ed793c)]">
                  {`+${result.xpAwarded} XP`}
                </span>
                <span className="text-[10px] text-[var(--color-fg-muted,#5f5b54)] block">
                  Awarded
                </span>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-cream,#f4e9d7)]/40 text-center">
                <span className="text-[10px] uppercase font-semibold text-[var(--color-fg-muted,#5f5b54)] block">
                  Confidence
                </span>
                <span className="text-base font-bold text-[var(--color-ink,#2b2a2e)]">
                  {`${Math.round(result.newConfidence * 100)}%`}
                </span>
                <span className="text-[10px] text-[var(--color-fg-muted,#5f5b54)] block">
                  {getMasteryLabel(result.newBand)}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-cream,#f4e9d7)]/40 text-center">
                <span className="text-[10px] uppercase font-semibold text-[var(--color-fg-muted,#5f5b54)] block">
                  Delta
                </span>
                <span className="text-base font-bold text-[var(--color-ink,#2b2a2e)]">
                  {signedConfidenceDelta ?? "N/A"}
                </span>
                <span className="text-[10px] text-[var(--color-fg-muted,#5f5b54)] block">
                  {signedConfidenceDelta !== null
                    ? "Confidence change since opening"
                    : "Confidence change unavailable for restored encounter."}
                </span>
              </div>
            </div>

            {/* Explanations Review */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-semibold text-[var(--color-ink,#2b2a2e)]">
                Question Review & Explanations
              </h4>
              {result.feedback.map((item, idx) => (
                <div
                  key={item.questionId}
                  className="p-3 rounded-md border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-paper,#faf6ee)]/70 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--color-ink,#2b2a2e)]">
                      {`Question ${idx + 1}`}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        item.correct
                          ? "text-[var(--color-good,#347d39)]"
                          : "text-[var(--color-bad,#b0384a)]"
                      )}
                    >
                      {item.correct ? "✓ Correct" : "✕ Needs review"}
                    </span>
                  </div>
                  <div className="text-[var(--color-fg-muted,#5f5b54)] leading-relaxed">
                    <MathMarkdown content={item.explanation} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Question Card Form */}
            {currentQuestion && (
              <fieldset className="space-y-4 border-0 p-0 m-0">
                <legend
                  ref={questionHeadingRef}
                  tabIndex={-1}
                  className="font-medium text-sm text-[var(--color-ink,#2b2a2e)] mb-3 leading-relaxed outline-none"
                >
                  <MathMarkdown content={currentQuestion.question} />
                </legend>

                {/* 4 Native Radio Options */}
                <div className="space-y-2" role="radiogroup" aria-label={`Question ${currentQuestionIndex + 1} options`}>
                  {currentQuestion.options.map((optionText, optIndex) => {
                    const optionId = `${radioGroupId}-q${currentQuestionIndex}-opt${optIndex}`;
                    const isSelected = selectedAnswers[currentQuestion.questionId] === optIndex;

                    return (
                      <label
                        key={optIndex}
                        htmlFor={optionId}
                        className={cn(
                          "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                          isSelected
                            ? "border-[var(--color-orange,#ed793c)] bg-[var(--color-yellow-tint,#fbeac2)]/30"
                            : "border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)] hover:bg-[var(--color-cream,#f4e9d7)]/20",
                          isSubmitting && "opacity-60 cursor-not-allowed"
                        )}
                      >
                        <input
                          type="radio"
                          id={optionId}
                          name={`question-radio-${currentQuestion.questionId}`}
                          value={optIndex}
                          checked={isSelected}
                          disabled={isSubmitting}
                          onChange={() => handleSelectOption(currentQuestion.questionId, optIndex)}
                          className="mt-0.5 text-[var(--color-orange,#ed793c)] focus:ring-[var(--color-orange,#ed793c)]"
                        />
                        <div className="text-xs font-normal text-[var(--color-ink,#2b2a2e)] flex-1 leading-relaxed">
                          <MathMarkdown content={optionText} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {/* Hint Drawer for Current Question */}
            {currentQuestion && (
              <HintDrawer
                key={currentQuestion.questionId}
                encounterId={encounter.id}
                questionId={currentQuestion.questionId}
                hintsUsed={hintsUsedCount[currentQuestion.questionId] ?? 0}
                onHintUnlocked={handleHintUnlocked}
                unlockedHints={hintsPerQuestion[currentQuestion.questionId]}
                disabled={isSubmitting || contextLoading || Boolean(contextError)}
                onPendingChange={setIsHintPending}
                onEncounterAlreadySubmitted={handleEncounterAlreadySubmitted}
              />
            )}

            {/* Submit Error Alert */}
            {submitError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-[var(--color-bad-tint,#f8e0e3)] text-[var(--color-bad,#b0384a)] text-xs font-medium"
              >
                {submitError}
              </div>
            )}

            {/* Navigation & Submission Controls */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-default,#e6d8bd)] gap-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePrevQuestion}
                  disabled={currentQuestionIndex === 0 || isSubmitting || isHintPending}
                >
                  Previous
                </Button>
                {currentQuestionIndex < totalQuestions - 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleNextQuestion}
                    disabled={isSubmitting || isHintPending}
                  >
                    Next
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  className="bg-[var(--color-orange,#ed793c)] hover:bg-[var(--color-orange-deep,#d46227)] text-white"
                >
                  {isSubmitting ? "Submitting…" : "Submit"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
