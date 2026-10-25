"use client";

import React from "react";
import type { UUID } from "@/contracts/common";
import type { DailyQuestDTO, DailyQuestItemDTO } from "@/contracts/game";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { cn } from "@/lib/client/utils";

export interface QuestPanelProps {
  dailyQuest: DailyQuestDTO | null;
  conceptLabels?: Map<UUID, string> | Record<string, string>;
  loading?: boolean;
  onPracticeConcept?: (conceptId: UUID, questId?: UUID) => void;
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

function getReviewStateBadge(reviewState: DailyQuestItemDTO["reviewState"]): React.JSX.Element {
  switch (reviewState) {
    case "overdue":
      return (
        <Badge
          variant="outline"
          className="border-[var(--color-bad,#b0384a)] text-[var(--color-bad,#b0384a)] bg-[var(--color-bad-tint,#f8e0e3)] text-[11px] font-semibold"
        >
          Overdue
        </Badge>
      );
    case "unreviewed":
      return (
        <Badge
          variant="outline"
          className="border-[var(--color-yellow-deep,#cf951f)] text-[var(--color-ink,#2b2a2e)] bg-[var(--color-yellow-tint,#fbeac2)] text-[11px] font-medium"
        >
          Unreviewed
        </Badge>
      );
    case "current":
    default:
      return (
        <Badge
          variant="secondary"
          className="text-[11px] font-medium"
        >
          Current
        </Badge>
      );
  }
}

/**
 * DailyQuestPanel Component (P5-D-03)
 * Displays the persistent daily review queue of ready concepts.
 * Invariant INV-XP04:
 * - Empty candidate queue displays explicit "No review needed" state.
 * - Completed items render strikethrough styling and checkmark.
 * - Clearing the nonempty quest displays the +25 XP Daily Bonus reward.
 */
export function QuestPanel({
  dailyQuest,
  conceptLabels,
  loading = false,
  onPracticeConcept,
  className,
}: QuestPanelProps): React.JSX.Element {
  if (loading && !dailyQuest) {
    return (
      <Card className={cn("w-full animate-pulse", className)}>
        <CardHeader className="pb-3">
          <CardTitle as="h2" className="text-base font-semibold">
            Daily Quests
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-14 rounded-lg bg-[var(--color-cream,#f4e9d7)]" />
          <div className="h-14 rounded-lg bg-[var(--color-cream,#f4e9d7)]" />
        </CardContent>
      </Card>
    );
  }

  const items = dailyQuest?.items ?? [];
  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;
  const isCleared = totalCount > 0 && (dailyQuest?.clearedAt !== null || completedCount === totalCount);

  return (
    <Card className={cn("w-full", className)} data-testid="daily-quest-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle as="h2" className="text-base font-semibold text-[var(--color-ink,#2b2a2e)]">
              Daily Quests
            </CardTitle>
            {totalCount > 0 && (
              <Badge
                variant={isCleared ? "soft" : "secondary"}
                mastery={isCleared ? "green" : undefined}
                className="text-xs"
                data-testid="daily-quest-progress-badge"
              >
                {isCleared ? "Cleared!" : `${completedCount}/${totalCount} completed`}
              </Badge>
            )}
          </div>
          {dailyQuest?.date && (
            <span className="text-xs text-[var(--color-fg-muted,#5f5b54)]">
              {dailyQuest.date}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Cleared Reward Banner */}
        {isCleared && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-good,#2b7f55)] bg-[var(--color-good-tint,#dff1e5)] text-[var(--color-ink,#2b2a2e)]"
            data-testid="daily-quest-cleared-banner"
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-lg">
                🎉
              </span>
              <div>
                <p className="font-semibold text-xs text-[var(--color-good,#2b7f55)]">
                  Quest Cleared!
                </p>
                <p className="text-xs text-[var(--color-ink,#2b2a2e)]">
                  +25 XP Daily Bonus awarded & streak extended!
                </p>
              </div>
            </div>
            <Badge mastery="green" variant="soft" className="font-bold text-xs">
              +25 XP
            </Badge>
          </div>
        )}

        {/* Empty State: Domain Invariant check */}
        {totalCount === 0 ? (
          <div
            role="region"
            aria-label="No review needed"
            className="p-6 rounded-lg border border-dashed border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)] text-center space-y-1.5"
            data-testid="daily-quest-empty-state"
          >
            <div aria-hidden="true" className="text-2xl mb-1">
              ☀️
            </div>
            <p className="text-sm font-semibold text-[var(--color-ink,#2b2a2e)]">
              No review needed
            </p>
            <p className="text-xs text-[var(--color-fg-muted,#5f5b54)] max-w-sm mx-auto">
              Clear skies: All prerequisites mastered and current on review. Check back tomorrow!
            </p>
          </div>
        ) : (
          <ul
            className="space-y-2.5"
            aria-label="Daily quest concepts list"
            data-testid="daily-quest-items-list"
          >
            {items.map((item) => {
              const label = getConceptLabel(item.conceptId, conceptLabels);
              const confidencePct = Math.round(item.confidence * 100);

              return (
                <li
                  key={item.conceptId}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg",
                    "border transition-colors",
                    item.completed
                      ? "border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-cream,#f4e9d7)]/40 opacity-80"
                      : "border-[var(--color-border-default,#e6d8bd)] bg-[var(--color-panel,#fffdf8)] hover:border-[var(--color-orange,#ed793c)]/40"
                  )}
                  data-testid={`daily-quest-item-${item.conceptId}`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "font-semibold text-sm text-[var(--color-ink,#2b2a2e)] truncate",
                          item.completed && "line-through text-[var(--color-fg-muted,#5f5b54)]"
                        )}
                        data-testid={`quest-item-title-${item.conceptId}`}
                      >
                        {label}
                      </span>
                      {item.completed ? (
                        <Badge
                          mastery="green"
                          variant="soft"
                          className="text-[11px]"
                          data-testid={`quest-completed-badge-${item.conceptId}`}
                        >
                          ✓ Completed
                        </Badge>
                      ) : (
                        getReviewStateBadge(item.reviewState)
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted,#5f5b54)]">
                      <span>Mastery:</span>
                      <span className="font-semibold text-[var(--color-ink,#2b2a2e)]">
                        {`${confidencePct}%`}
                      </span>
                      <span className="text-[var(--color-border-default,#e6d8bd)]">•</span>
                      <span className="capitalize">{getMasteryLabel(item.band)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {item.completed ? (
                      <span
                        aria-hidden="true"
                        className="text-xs font-semibold text-[var(--color-good,#2b7f55)] px-2 py-1"
                      >
                        Done
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        className="min-h-[36px]"
                        onClick={() => onPracticeConcept?.(item.conceptId, dailyQuest?.id)}
                        aria-label={`Practice ${label}`}
                        data-testid={`practice-quest-${item.conceptId}`}
                      >
                        Practice
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
