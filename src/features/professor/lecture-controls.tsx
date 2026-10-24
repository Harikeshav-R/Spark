"use client";

import React, { useState, useEffect } from "react";
import type { LectureSession } from "@/contracts/classroom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getElapsedSeconds, formatElapsedTimer } from "./teacher-lecture-state";

export interface LectureElapsedTimerProps {
  lecture: LectureSession;
}

export function LectureElapsedTimer({ lecture }: LectureElapsedTimerProps): React.JSX.Element {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (lecture.status !== "live") {
      return;
    }
    setNowMs(Date.now());
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, [lecture.id, lecture.status]);

  let displaySeconds = 0;
  if (lecture.status === "completed") {
    displaySeconds = getElapsedSeconds(lecture, 0);
  } else if (nowMs !== null) {
    displaySeconds = getElapsedSeconds(lecture, nowMs);
  }

  const formatted = formatElapsedTimer(displaySeconds);

  return (
    <span
      className="tabular-nums font-mono text-sm font-medium text-[var(--color-fg-muted)] tracking-wider"
      aria-label={`Elapsed time: ${formatted}`}
    >
      {formatted}
    </span>
  );
}

export interface LectureControlsProps {
  lecture: LectureSession | null;
  pending: "start" | "end" | null;
  error: string | null;
  onStart: (title: string) => void;
  onEnd: () => void;
}

export function LectureControls({
  lecture,
  pending,
  error,
  onStart,
  onEnd,
}: LectureControlsProps): React.JSX.Element {
  const [titleInput, setTitleInput] = useState("");
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [localTitleError, setLocalTitleError] = useState<string | null>(null);

  const trimmedTitle = titleInput.trim();
  const isTitleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= 255;

  const handleStartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTitleValid) {
      setLocalTitleError("Lecture title must be between 1 and 255 characters.");
      return;
    }
    setLocalTitleError(null);
    onStart(trimmedTitle);
  };

  const handleConfirmEnd = () => {
    setConfirmingEnd(false);
    onEnd();
  };

  // Idle state: no lecture active or selected
  if (!lecture) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle as="h2">Start Lecture Session</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleStartSubmit} className="space-y-4">
            <Input
              label="Lecture title"
              id="lecture-title-input"
              value={titleInput}
              onChange={(e) => {
                setTitleInput(e.target.value);
                if (localTitleError) setLocalTitleError(null);
              }}
              placeholder="e.g. Lecture 4: Backpropagation & Computational Graphs"
              disabled={pending === "start"}
              error={localTitleError || undefined}
              maxLength={255}
              required
            />
            {error && (
              <div
                role="alert"
                className="rounded-md border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-3 text-sm text-[var(--color-fg-default)]"
              >
                {error}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!isTitleValid || pending === "start"}
                isLoading={pending === "start"}
              >
                Start lecture
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  const isLive = lecture.status === "live";

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle as="h2" className="text-xl font-bold break-words">
              {lecture.title}
            </CardTitle>
            {isLive ? (
              <Badge variant="default" className="bg-[#2b7f55] text-white border-transparent">
                Live
              </Badge>
            ) : (
              <Badge variant="secondary">Completed</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--color-fg-muted)]">
            <span>Started {new Date(lecture.startedAt).toLocaleTimeString()}</span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <span>Duration:</span>
              <LectureElapsedTimer lecture={lecture} />
            </span>
          </div>
        </div>

        {isLive && (
          <div className="flex items-center gap-2">
            {!confirmingEnd ? (
              <Button
                variant="destructive"
                onClick={() => setConfirmingEnd(true)}
                disabled={pending === "end"}
              >
                End lecture
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-panel)]">
                <span className="text-xs font-medium text-[var(--color-fg-default)]">
                  End lecture?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmEnd}
                  isLoading={pending === "end"}
                  disabled={pending === "end"}
                >
                  Confirm end lecture
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingEnd(false)}
                  disabled={pending === "end"}
                >
                  Keep teaching
                </Button>
              </div>
            )}
          </div>
        )}
      </CardHeader>

      {error && (
        <CardContent className="pt-0">
          <div
            role="alert"
            className="rounded-md border border-[var(--color-border-danger,#b0384a)] bg-[var(--color-bg-danger-soft,#f8e0e3)] p-3 text-sm text-[var(--color-fg-default)]"
          >
            {error}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
