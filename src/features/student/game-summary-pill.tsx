"use client";

import React from "react";
import type { GameSummaryDTO } from "@/contracts/game";
import { SparkMascot } from "@/features/mascot/spark-mascot";
import { SPARK_FORM_LABELS } from "@/features/mascot/spark-moods";
import { cn } from "@/lib/client/utils";

export interface GameSummaryPillProps {
  summary: GameSummaryDTO | null;
  loading?: boolean;
  className?: string;
}

/**
 * GameSummaryPill Component (P5-D-03)
 * Displays live student progression:
 * - XP Counter (append-only ledger)
 * - Streak Flame (consecutive active UTC quest days)
 * - Sky Brightness (average course mastery)
 * - Spark Avatar (32px mascot thumbnail and form label)
 */
export function GameSummaryPill({
  summary,
  loading = false,
  className,
}: GameSummaryPillProps): React.JSX.Element {
  if (loading && !summary) {
    return (
      <div
        role="status"
        aria-label="Loading student progression"
        className={cn(
          "inline-flex items-center gap-3 px-3 py-1.5 rounded-full",
          "border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)]",
          "text-xs text-[var(--color-fg-muted,#5f5b54)] animate-pulse",
          className
        )}
      >
        <div className="w-5 h-5 rounded-full bg-[var(--color-cream,#f4e9d7)]" />
        <span>Loading stats…</span>
      </div>
    );
  }

  const xp = summary?.xp ?? 0;
  const streakDays = summary?.streakDays ?? 0;
  const skyBrightness = summary?.skyBrightness ?? 0;
  const form = summary?.form ?? "spark";
  const formLabel = SPARK_FORM_LABELS[form] ?? "Spark";
  const skyPercentage = Math.round(skyBrightness * 100);

  return (
    <div
      role="region"
      aria-label="Student progression summary"
      className={cn(
        "inline-flex flex-wrap items-center gap-2 sm:gap-3 px-3 py-1.5 rounded-full",
        "border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)]",
        "shadow-xs transition-colors",
        className
      )}
      data-testid="game-summary-pill"
    >
      {/* XP Counter */}
      <div
        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink,#2b2a2e)]"
        title="Total effort XP earned"
      >
        <span aria-hidden="true" className="text-[var(--color-orange,#ed793c)] font-bold">
          ⚡
        </span>
        <span data-testid="game-summary-xp">{`${xp} XP`}</span>
      </div>

      <span aria-hidden="true" className="text-[var(--color-border-default,#e6d8bd)] select-none">
        •
      </span>

      {/* Streak Flame */}
      <div
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink,#2b2a2e)]"
        title="Consecutive daily review quest streak"
      >
        <span aria-hidden="true" className="text-[var(--color-orange-deep,#c85c22)]">
          🔥
        </span>
        <span data-testid="game-summary-streak">
          {`${streakDays} ${streakDays === 1 ? "day" : "days"}`}
        </span>
      </div>

      <span aria-hidden="true" className="text-[var(--color-border-default,#e6d8bd)] select-none">
        •
      </span>

      {/* Sky Brightness */}
      <div
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink,#2b2a2e)]"
        title="Course average mastery (Sky Brightness)"
      >
        <span aria-hidden="true" className="text-[var(--color-yellow-deep,#cf951f)]">
          ☀️
        </span>
        <span data-testid="game-summary-sky">{`${skyPercentage}% sky`}</span>
      </div>

      <span aria-hidden="true" className="text-[var(--color-border-default,#e6d8bd)] select-none">
        •
      </span>

      {/* Spark Avatar Thumbnail & Form */}
      <div
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-fg-muted,#5f5b54)]"
        title={`Companion form: ${formLabel}`}
      >
        <div data-testid="game-summary-mascot" className="w-5 h-5 flex items-center justify-center shrink-0">
          <SparkMascot
            skyBrightness={skyBrightness}
            mood="calm"
            size={32}
            className="w-5 h-5"
          />
        </div>
        <span data-testid="game-summary-form" className="font-semibold text-[var(--color-ink,#2b2a2e)]">
          {formLabel}
        </span>
      </div>
    </div>
  );
}
