"use client";

import React, { useMemo } from "react";
import type { UUID } from "@/contracts/common";
import type { EclipseDTO } from "@/contracts/game";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";

export interface EclipseBannerProps {
  eclipse: EclipseDTO | null;
  conceptLabels?: Map<UUID, string> | Record<string, string>;
  onPracticeConcept?: (conceptId: UUID) => void;
  className?: string;
}

function getConceptLabel(
  conceptId: UUID,
  conceptLabels?: Map<UUID, string> | Record<string, string>
): string {
  if (!conceptLabels) return `Concept ${conceptId.slice(0, 8)}`;
  if (conceptLabels instanceof Map) {
    return conceptLabels.get(conceptId) ?? `Concept ${conceptId.slice(0, 8)}`;
  }
  return conceptLabels[conceptId] ?? `Concept ${conceptId.slice(0, 8)}`;
}

function formatExamCountdown(examAtStr: string | null): string | null {
  if (!examAtStr) return null;
  try {
    const examDate = new Date(examAtStr);
    const now = new Date();
    const diffMs = examDate.getTime() - now.getTime();

    if (diffMs <= 0) {
      return "Exam concluded";
    }

    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;

    if (days > 0) {
      return `Upcoming exam in ${days} ${days === 1 ? "day" : "days"}${
        remainingHours > 0 ? `, ${remainingHours} hr` : ""
      }`;
    }

    if (remainingHours > 0) {
      return `Upcoming exam in ${remainingHours} ${remainingHours === 1 ? "hour" : "hours"}`;
    }

    const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    return `Upcoming exam in ${minutes} min`;
  } catch {
    return null;
  }
}

/**
 * EclipseBanner Component (P5-D-03)
 * Visual indicator of course-wide review pressure targeting ready concepts with c < 0.70.
 * Invariants:
 * - Strength in [0, 100]%.
 * - If strength === 0 or targets empty: displays "Clear skies" state.
 * - Displays upcoming exam countdown when examAt is present.
 */
export function EclipseBanner({
  eclipse,
  conceptLabels,
  onPracticeConcept,
  className,
}: EclipseBannerProps): React.JSX.Element {
  const strength = eclipse?.strength ?? 0;
  const targets = eclipse?.targets ?? [];
  const examCountdown = useMemo(
    () => formatExamCountdown(eclipse?.examAt ?? null),
    [eclipse?.examAt]
  );

  const isClearSkies = strength === 0 || targets.length === 0;

  return (
    <section
      role="region"
      aria-label="Eclipse review pressure diagnostic"
      className={cn(
        "rounded-xl border p-4 sm:p-5 transition-all",
        isClearSkies
          ? "border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)] text-[var(--color-ink,#2b2a2e)]"
          : "border-[var(--color-orange-deep,#c85c22)]/30 bg-[var(--color-yellow-tint,#fbeac2)]/35 text-[var(--color-ink,#2b2a2e)] shadow-xs",
        className
      )}
      data-testid="eclipse-banner"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Strength Gauge and Diagnosis */}
        <div className="space-y-2 max-w-xl">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex items-center justify-center w-7 h-7 rounded-full text-sm",
                isClearSkies
                  ? "bg-[var(--color-good-tint,#dff1e5)] text-[var(--color-good,#2b7f55)]"
                  : "bg-[var(--color-orange,#ed793c)]/20 text-[var(--color-orange-deep,#c85c22)] font-bold"
              )}
            >
              {isClearSkies ? "☀️" : "🌘"}
            </span>

            <h2 className="text-sm sm:text-base font-semibold text-[var(--color-ink,#2b2a2e)]">
              {isClearSkies ? "Clear skies" : "Eclipse review pressure"}
            </h2>

            <Badge
              variant={isClearSkies ? "soft" : "secondary"}
              mastery={isClearSkies ? "green" : strength > 50 ? "red" : undefined}
              className="text-xs font-semibold"
              data-testid="eclipse-strength-badge"
            >
              {`${strength}% pressure`}
            </Badge>

            {examCountdown && (
              <span
                className="text-xs font-medium text-[var(--color-orange-text,#a9481a)] bg-[var(--color-yellow-tint,#fbeac2)] px-2.5 py-0.5 rounded-full border border-[var(--color-yellow-deep,#cf951f)]/30"
                data-testid="eclipse-exam-countdown"
              >
                📅 {examCountdown}
              </span>
            )}
          </div>

          <p className="text-xs text-[var(--color-fg-muted,#5f5b54)] leading-relaxed">
            {isClearSkies
              ? "All ready concepts meet or exceed 70% confidence. No exam review pressure detected."
              : `Review pressure is currently at ${strength}%. Targeting ready concepts with confidence below 70% to prepare for upcoming evaluations.`}
          </p>

          {/* Progress bar visual indicator */}
          <div
            role="progressbar"
            aria-label="Review pressure meter"
            aria-valuenow={strength}
            aria-valuemin={0}
            aria-valuemax={100}
            className="w-full h-2 rounded-full bg-[var(--color-cream,#f4e9d7)] overflow-hidden"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isClearSkies
                  ? "bg-[var(--color-good,#2b7f55)]"
                  : strength > 50
                  ? "bg-[var(--color-bad,#b0384a)]"
                  : "bg-[var(--color-orange,#ed793c)]"
              )}
              style={{ width: `${Math.min(100, Math.max(0, strength))}%` }}
            />
          </div>
        </div>

        {/* Right: Target Concepts Pills */}
        {!isClearSkies && targets.length > 0 && (
          <div className="space-y-1.5 lg:max-w-md w-full">
            <span className="text-[11px] font-semibold text-[var(--color-fg-muted,#5f5b54)] uppercase tracking-wider">
              Focus review targets ({targets.length})
            </span>
            <div
              className="flex flex-wrap gap-2"
              data-testid="eclipse-targets-container"
            >
              {targets.map((target) => {
                const label = getConceptLabel(target.conceptId, conceptLabels);
                const confidencePct = Math.round(target.confidence * 100);

                return (
                  <div
                    key={target.conceptId}
                    className="inline-flex items-center gap-2 p-1.5 pr-2 rounded-lg border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)] text-xs text-[var(--color-ink,#2b2a2e)]"
                    data-testid={`eclipse-target-${target.conceptId}`}
                  >
                    <span className="font-medium truncate max-w-[140px] sm:max-w-[180px]">
                      {label}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono px-1 py-0">
                      {confidencePct}%
                    </Badge>
                    {onPracticeConcept && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs text-[var(--color-orange-text,#a9481a)] hover:text-[var(--color-orange-deep,#c85c22)] hover:bg-[var(--color-cream,#f4e9d7)] font-medium"
                        onClick={() => onPracticeConcept(target.conceptId)}
                        aria-label={`Practice target ${label}`}
                      >
                        Practice
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
