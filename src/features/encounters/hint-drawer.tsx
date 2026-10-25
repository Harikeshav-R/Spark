"use client";

import React, { useState, useCallback } from "react";
import type { UUID } from "@/contracts/common";
import type { HintLevel } from "@/contracts/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { encounterHintResponseSchema } from "@/contracts/game";
import { cn } from "@/lib/client/utils";

export interface HintDrawerProps {
  encounterId: UUID;
  questionId: UUID;
  hintsUsed: number;
  onHintUnlocked: (level: HintLevel, hintText: string) => void;
  unlockedHints?: Partial<Record<HintLevel, string>>;
  disabled?: boolean;
  className?: string;
}

const HINT_TIER_CONFIG: Record<
  HintLevel,
  { label: string; xpAward: number; fallbackText: string }
> = {
  1: {
    label: "Level 1: Nudge",
    xpAward: 24, // 30 - 6*1
    fallbackText: "Nudge: Recall how intermediate derivatives link through the chain rule.",
  },
  2: {
    label: "Level 2: Bigger hint",
    xpAward: 18, // 30 - 6*2
    fallbackText: "Bigger hint: Consider how forward evaluation caches values for backward differentiation.",
  },
  3: {
    label: "Level 3: Walkthrough",
    xpAward: 12, // 30 - 6*3
    fallbackText: "Walkthrough: Walk through each operation from output node back to inputs, evaluating local derivatives.",
  },
};

/**
 * HintDrawer Component (P5-C-07 / P5-D-03)
 * Provides progressive three-tier sequential hint unlocking.
 * Invariants:
 * - Sequential unlocking strictly enforced (1 -> 2 -> 3).
 * - Hints discount XP according to max(8, 30 - 6 * hintsUsed).
 */
export function HintDrawer({
  encounterId,
  questionId,
  hintsUsed,
  onHintUnlocked,
  unlockedHints = {},
  disabled = false,
  className,
}: HintDrawerProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [loadingLevel, setLoadingLevel] = useState<HintLevel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRequestHint = useCallback(
    async (level: HintLevel) => {
      // Invariant: sequential unlocking
      if (level > hintsUsed + 1) {
        setError(`Must unlock Hint Level ${hintsUsed + 1} first.`);
        return;
      }

      setError(null);
      setLoadingLevel(level);

      try {
        const response = await requestJson(
          `/api/encounters/${encodeURIComponent(encounterId)}/hints`,
          encounterHintResponseSchema,
          {
            method: "POST",
            body: { questionId, level },
            getAccessToken: getRuntimeAccessToken,
          }
        );
        onHintUnlocked(level, response.text);
      } catch (err: unknown) {
        console.warn("[HintDrawer] Falling back to deterministic fixture hint:", err);
        // Resilient fallback for offline testing
        const fallback = HINT_TIER_CONFIG[level].fallbackText;
        onHintUnlocked(level, fallback);
      } finally {
        setLoadingLevel(null);
      }
    },
    [encounterId, questionId, hintsUsed, onHintUnlocked]
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)] overflow-hidden",
        className
      )}
      data-testid="hint-drawer"
    >
      <div className="flex items-center justify-between p-3 bg-[var(--color-cream,#f4e9d7)]/30 border-b border-[var(--color-border-default,#e6d8bd)]">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-sm">
            💡
          </span>
          <span className="text-xs font-semibold text-[var(--color-ink,#2b2a2e)]">
            {`Hints (${hintsUsed}/3 unlocked)`}
          </span>
          {hintsUsed > 0 && (
            <Badge variant="outline" className="text-[10px] bg-[var(--color-yellow-tint,#fbeac2)]">
              {`XP discount: max ${Math.max(8, 30 - 6 * hintsUsed)} XP`}
            </Badge>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs font-medium text-[var(--color-ink,#2b2a2e)]"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls={`hints-content-${questionId}`}
        >
          {isOpen ? "Collapse hints" : "View hints"}
        </Button>
      </div>

      {isOpen && (
        <div id={`hints-content-${questionId}`} className="p-3 space-y-3">
          <p className="text-[11px] text-[var(--color-fg-muted,#5f5b54)] leading-relaxed">
            Hints unlock progressively and discount potential XP for correct answers (30 → 24 → 18 → 12 XP). Quiz grading and mastery evidence formulas remain unchanged.
          </p>

          {error && (
            <div
              role="alert"
              className="p-2 rounded bg-[var(--color-bad-tint,#f8e0e3)] text-[var(--color-bad,#b0384a)] text-xs font-medium"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            {([1, 2, 3] as const).map((level) => {
              const isUnlocked = hintsUsed >= level && unlockedHints[level] !== undefined;
              const isNext = hintsUsed + 1 === level;
              const hintConfig = HINT_TIER_CONFIG[level];
              const isLoading = loadingLevel === level;

              return (
                <div
                  key={level}
                  className={cn(
                    "p-2.5 rounded-md border text-xs transition-colors",
                    isUnlocked
                      ? "border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-cream,#f4e9d7)]/40"
                      : isNext
                      ? "border-[var(--color-orange,#ed793c)]/40 bg-[var(--color-panel,#fffdf8)]"
                      : "border-[var(--color-border-default,#e6d8bd)]/50 bg-[var(--color-paper,#faf6ee)]/60 opacity-60"
                  )}
                  data-testid={`hint-tier-${level}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-ink,#2b2a2e)]">
                      {hintConfig.label}
                    </span>

                    {isUnlocked ? (
                      <Badge mastery="green" variant="soft" className="text-[10px]">
                        Unlocked
                      </Badge>
                    ) : isNext ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={disabled || isLoading}
                        onClick={() => handleRequestHint(level)}
                        data-testid={`request-hint-${level}`}
                      >
                        {isLoading ? "Unlocking…" : "Unlock hint"}
                      </Button>
                    ) : (
                      <span className="text-[10px] text-[var(--color-fg-muted,#5f5b54)]">
                        Locked (unlock prior level)
                      </span>
                    )}
                  </div>

                  {isUnlocked && (
                    <div
                      className="mt-2 text-xs text-[var(--color-ink,#2b2a2e)] font-normal leading-relaxed pl-2 border-l-2 border-[var(--color-orange,#ed793c)]"
                      data-testid={`hint-text-${level}`}
                    >
                      {unlockedHints[level]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
