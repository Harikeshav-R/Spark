"use client";

import React, { useRef, useState, useEffect } from "react";
import type { TranscriptChunk } from "@/contracts/classroom";
import type { UUID } from "@/contracts/common";
import { Button } from "@/components/ui/button";
import { formatElapsedTimer } from "./teacher-lecture-state";

export interface TranscriptFeedProps {
  chunks: readonly TranscriptChunk[];
  conceptLabels: ReadonlyMap<UUID, string>;
  isSimulated: boolean | null;
  lectureStatus: "live" | "completed";
}

export function TranscriptFeed({
  chunks,
  conceptLabels,
  isSimulated,
  lectureStatus,
}: TranscriptFeedProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFollowingBottom, setIsFollowingBottom] = useState<boolean>(true);

  // Check scroll position to determine if the user has scrolled up
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsFollowingBottom(distanceToBottom <= 48);
  };

  // Scroll to bottom when new chunks arrive, if following bottom
  useEffect(() => {
    if (!isFollowingBottom) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chunks, isFollowingBottom]);

  const handleJumpToLatest = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setIsFollowingBottom(true);
    }
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-[var(--color-fg-default)]">
          Lecture transcript
        </h3>

        <div className="flex items-center gap-2">
          {isSimulated === true && (
            <span
              role="status"
              className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-[#fbeac2] text-[#854d0e] border border-[#cf951f]"
            >
              [SIMULATED TRANSCRIPT]
            </span>
          )}
          {isSimulated === null && (
            <span
              role="status"
              className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium text-[var(--color-fg-muted)] border border-[var(--color-border-default)] bg-[var(--color-bg-panel)]"
            >
              Transcript source unavailable
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          role="region"
          aria-label="Lecture transcript timeline"
          tabIndex={0}
          onScroll={handleScroll}
          className="relative overflow-y-auto overscroll-contain h-[min(60vh,36rem)] min-h-[16rem] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b2a2e]"
        >
          {chunks.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-fg-muted)] italic py-12">
              {lectureStatus === "live"
                ? "Waiting for transcript…"
                : "No transcript was recorded."}
            </div>
          ) : (
            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              <ol className="space-y-4">
              {chunks.map((chunk) => {
                const speaker = chunk.speakerName?.trim() || "Unknown speaker";
                const timestamp = formatElapsedTimer(chunk.timestampSec);

                return (
                  <li
                    key={chunk.id}
                    className="flex flex-col gap-1.5 border-b border-[var(--color-border-default)]/40 pb-3 last:border-0"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="tabular-nums font-mono font-medium text-[var(--color-fg-muted)]">
                        {timestamp}
                      </span>
                      <span className="font-semibold text-[var(--color-fg-default)]">
                        {speaker}
                      </span>
                    </div>

                    <p className="text-base text-[var(--color-fg-default)] leading-relaxed max-w-[70ch] break-words">
                      {chunk.text}
                    </p>

                    {chunk.detectedConceptIds.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {chunk.detectedConceptIds.map((conceptId) => {
                          const label = conceptLabels.get(conceptId);
                          const displayLabel = label ?? `Unknown concept (${conceptId})`;

                          return (
                            <span
                              key={conceptId}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#f4e9d7] text-[#2b2a2e] border border-[#e6d8bd]"
                            >
                              {displayLabel}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
              </ol>
            </div>
          )}
        </div>

        {!isFollowingBottom && chunks.length > 0 && (
          <div className="absolute bottom-3 right-4 z-10">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleJumpToLatest}
              className="shadow-md"
            >
              Jump to latest ↓
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
