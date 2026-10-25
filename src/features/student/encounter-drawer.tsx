"use client";

import React, { useEffect, useCallback } from "react";
import type { EncounterDTO, EncounterResultDTO } from "@/contracts/game";
import { EncounterFeature } from "@/features/encounters/encounter-feature";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";

export interface EncounterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  encounter: EncounterDTO | null;
  conceptLabel?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCompleted?: (result: EncounterResultDTO) => void;
}

/**
 * EncounterDrawer Component (P5-D-03)
 * Slide-over drawer mounting EncounterFeature.
 * Meets WCAG 2.1 AA accessibility:
 * - Traps escape key for closing.
 * - Proper ARIA dialog semantics.
 * - Accessible hit targets.
 */
export function EncounterDrawer({
  isOpen,
  onClose,
  encounter,
  conceptLabel,
  loading = false,
  error = null,
  onRetry,
  onCompleted,
}: EncounterDrawerProps): React.JSX.Element | null {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={conceptLabel ? `Practice Encounter: ${conceptLabel}` : "Practice Encounter"}
      className="fixed inset-0 z-50 flex items-center justify-end overflow-hidden"
      data-testid="encounter-drawer"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        className={cn(
          "relative z-10 w-full max-w-2xl h-full bg-[var(--color-bg-canvas,#faf6ee)]",
          "border-l border-[var(--color-border-default,#e6d8bd)] shadow-2xl",
          "flex flex-col overflow-y-auto p-4 sm:p-6"
        )}
      >
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[var(--color-border-default,#e6d8bd)]">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl">
              ⚔️
            </span>
            <h2 className="text-base font-bold text-[var(--color-ink,#2b2a2e)]">
              Practice Encounter
            </h2>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            aria-label="Close practice encounter drawer"
            className="h-8 px-2.5 text-xs font-semibold"
          >
            Close ✕
          </Button>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-[var(--color-orange,#ed793c)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-[var(--color-fg-muted,#5f5b54)]">
              Preparing practice encounter questions…
            </p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3" data-testid="encounter-drawer-error">
            <p className="text-sm font-medium text-[var(--color-error,#c53b27)]">
              {error}
            </p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry Encounter
              </Button>
            )}
          </div>
        ) : encounter ? (
          <div className="flex-1">
            <EncounterFeature
              encounter={encounter}
              conceptLabel={conceptLabel}
              onClose={onClose}
              onCompleted={onCompleted}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
            <p className="text-sm text-[var(--color-fg-muted,#5f5b54)]">
              No active encounter found.
            </p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Return to dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
