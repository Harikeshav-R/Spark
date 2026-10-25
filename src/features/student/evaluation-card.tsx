"use client";

import React from "react";
import type { PollResponseResult } from "@/contracts/classroom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, getMasteryLabel } from "@/components/ui/badge";
import { SparkMascot } from "@/features/mascot/spark-mascot";
import { getPollOutcomeMood } from "@/features/mascot/spark-moods";
import { cn } from "@/lib/client/utils";

export interface EvaluationCardProps {
  result: PollResponseResult;
  conceptLabel: string;
  skyBrightness: number;
  className?: string;
}

export function EvaluationCard({
  result,
  conceptLabel,
  skyBrightness,
  className,
}: EvaluationCardProps): React.JSX.Element {
  const outcome = result.evaluation.outcome;

  const outcomeConfig = {
    correct: {
      label: "Correct",
      badgeClass: "bg-[#dff1e5] text-[#1b5e3b] border-[#1b5e3b]",
    },
    partial: {
      label: "Partially correct",
      badgeClass: "bg-[#fbeac2] text-[#cf951f] border-[#cf951f]",
    },
    wrong: {
      label: "Incorrect",
      badgeClass: "bg-[#f8e0e3] text-[#b0384a] border-[#b0384a]",
    },
  }[outcome];

  return (
    <Card
      className={cn(
        "border-[#e6d8bd] bg-[#fffdf8] shadow-sm",
        className
      )}
    >
      {/* Screen reader polite live region */}
      <div className="sr-only" role="status" aria-live="polite">
        {`Poll evaluation result: ${outcomeConfig.label}. Concept ${conceptLabel} mastery updated to ${getMasteryLabel(result.newBand, result.newConfidence)}.`}
      </div>

      <CardHeader className="p-4 sm:p-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  "font-semibold border text-xs px-2.5 py-0.5",
                  outcomeConfig.badgeClass
                )}
              >
                {outcomeConfig.label}
              </Badge>
              <Badge
                mastery={result.newBand}
                confidence={result.newConfidence}
                variant="soft"
                className="text-xs font-medium"
              >
                {getMasteryLabel(result.newBand, result.newConfidence)}
              </Badge>
              <span className="text-xs text-[#5f5b54]">
                Private to you
              </span>
            </div>
            <CardTitle as="h3" className="text-base font-semibold text-[#2b2a2e] truncate">
              {conceptLabel}
            </CardTitle>
          </div>

          <div className="shrink-0 flex items-center justify-center">
            <SparkMascot
              skyBrightness={skyBrightness}
              mood={getPollOutcomeMood(outcome)}
              size={84}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 pt-0 space-y-2">
        <div className="rounded-lg bg-[#faf6ee] border border-[#e6d8bd] p-3 sm:p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#5f5b54] block mb-1">
            Feedback
          </span>
          <p className="text-sm leading-relaxed text-[#2b2a2e] whitespace-pre-wrap break-words">
            {result.evaluation.feedback}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
