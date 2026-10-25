"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { UUID } from "@/contracts/common";
import { uuidSchema } from "@/contracts/common";
import {
  suggestedInterventionsSchema,
  type SuggestedInterventions,
} from "@/contracts/ai";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requestJson, ClientApiError } from "@/lib/client/http";

const lectureInterventionsSchema = suggestedInterventionsSchema.extend({
  lectureId: uuidSchema,
});

export interface InterventionsPanelProps {
  lectureId: UUID;
  getAccessToken: () => Promise<string | null>;
  className?: string;
}

export function InterventionsPanel({
  lectureId,
  getAccessToken,
  className = "",
}: InterventionsPanelProps): React.JSX.Element {
  const [interventions, setInterventions] = useState<SuggestedInterventions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset interventions when lectureId changes
  useEffect(() => {
    setInterventions(null);
    setError(null);
    setLoading(false);
  }, [lectureId]);

  const handleFetchInterventions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await requestJson(
        `/api/lectures/${encodeURIComponent(lectureId)}/interventions`,
        lectureInterventionsSchema,
        {
          method: "POST",
          body: {},
          getAccessToken,
        }
      );

      setInterventions({
        misconceptions: res.misconceptions,
        recommendations: res.recommendations,
      });
    } catch (err: unknown) {
      setError(
        err instanceof ClientApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to generate interventions."
      );
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, lectureId]);

  return (
    <Card className={className} data-testid="interventions-panel">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle as="h3">Pedagogical Interventions</CardTitle>
            <CardDescription>
              Analyze aggregated student poll responses and synthesize targeted teaching suggestions.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => void handleFetchInterventions()}
            disabled={loading}
            className="self-start sm:self-center"
          >
            {loading ? "Analyzing…" : "Suggest interventions"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="p-3 text-sm rounded-md bg-[var(--color-bg-danger-soft,#f8e0e3)] text-[var(--color-border-danger,#b0384a)] border border-[var(--color-border-danger,#b0384a)] flex items-center justify-between gap-2"
          >
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleFetchInterventions()}
              className="text-xs shrink-0"
            >
              Retry
            </Button>
          </div>
        )}

        {loading && !interventions && (
          <div className="py-6 text-center text-sm text-[var(--color-fg-muted)]">
            Analyzing class poll responses and generating recommendations…
          </div>
        )}

        {!loading && !interventions && !error && (
          <p className="text-sm text-[var(--color-fg-muted)]">
            Click &ldquo;Suggest interventions&rdquo; to analyze poll evaluations from this lecture.
          </p>
        )}

        {interventions && (
          <div className="space-y-4">
            {interventions.misconceptions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg-muted)]">
                  Detected Misconceptions ({interventions.misconceptions.length})
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-[var(--color-fg-default)]">
                  {interventions.misconceptions.map((m, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg-muted)]">
                Recommended Actions ({interventions.recommendations.length})
              </h4>
              <div className="grid grid-cols-1 gap-3">
                {interventions.recommendations.map((rec, idx) => (
                  <Card
                    key={idx}
                    className="p-4 bg-[var(--color-bg-panel)] border border-[var(--color-border-default)] space-y-2"
                  >
                    <p className="font-semibold text-sm text-[var(--color-fg-default)]">
                      {rec.title}
                    </p>
                    <p className="text-xs text-[var(--color-fg-muted)] leading-relaxed">
                      {rec.description}
                    </p>
                    <div className="p-2.5 rounded bg-[var(--color-cream,#fbeac2)] border border-[var(--color-border-default,#ed793c)] text-xs text-[var(--color-ink,#2b2a2e)] font-mono">
                      <span className="font-bold">Prompt: </span>
                      {rec.actionablePrompt}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
