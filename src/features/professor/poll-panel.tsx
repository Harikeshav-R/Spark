"use client";

import { useState } from "react";
import type { UUID } from "@/contracts/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getEffectiveResponseCount } from "./teacher-poll-state";
import type { UseTeacherPollsResult } from "./use-teacher-polls";

export interface PollPanelProps {
  isLive: boolean;
  concepts: Array<{ id: UUID; label: string; category?: string }>;
  hook: UseTeacherPollsResult;
}

export function PollPanel({ isLive, concepts, hook }: PollPanelProps) {
  const [selectedConceptId, setSelectedConceptId] = useState<string>("");

  const activePollSummary = hook.state.polls?.active ?? null;
  const draftPollSummary = hook.state.polls?.draft ?? null;
  const closedPollSummary = hook.state.polls?.closed ?? null;
  const announcedActiveId = hook.state.announcedActivePollId;

  const hasActivePoll = Boolean(activePollSummary || announcedActiveId);

  const activeCount = getEffectiveResponseCount(
    activePollSummary,
    hook.state.counts
  );
  const closedCount = getEffectiveResponseCount(
    closedPollSummary,
    hook.state.counts
  );

  return (
    <Card className="flex flex-col space-y-4 p-4 border border-[#e6d8bd] bg-[#fffdf8]">
      <CardHeader className="p-0 pb-2 border-b border-[#e6d8bd] flex flex-row items-center justify-between">
        <CardTitle as="h2" className="text-lg font-semibold text-[#2b2a2e]">
          Lecture Polls
        </CardTitle>
        {isLive ? (
          <Badge variant="outline" className="text-xs">
            Live Session
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Session Ended
          </Badge>
        )}
      </CardHeader>

      <CardContent className="p-0 space-y-4">
        {!isLive && (
          <div
            role="status"
            className="p-3 bg-[#f4e9d7] text-[#5f5b54] rounded-md text-sm"
          >
            Start or resume a live lecture to generate a poll.
          </div>
        )}

        {(hook.actionError || hook.pollsError) && (
          <div
            role="alert"
            className="p-3 bg-[#f8e0e3] border border-[#b0384a]/30 text-[#b0384a] rounded-md text-sm flex justify-between items-center"
          >
            <span>{hook.actionError ?? hook.pollsError}</span>
            <button
              type="button"
              onClick={hook.clearActionError}
              className="text-xs underline ml-2"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. ACTIVE POLL SECTION */}
        {activePollSummary && (
          <div
            className="p-4 border border-[#2b7f55]/40 bg-[#dff1e5]/30 rounded-lg space-y-3"
            aria-label="Active Poll"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#2b7f55]">
                Current Active Poll
              </span>
              <Badge variant="solid" mastery="green">
                Active
              </Badge>
            </div>

            <p className="text-base text-[#2b2a2e] font-medium leading-relaxed">
              {activePollSummary.poll.question}
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 border-t border-[#2b7f55]/20">
              <p
                aria-live="polite"
                className="text-sm font-semibold text-[#2b7f55] tabular-nums"
              >
                {activeCount === 1
                  ? "1 response received"
                  : `${activeCount} responses received`}
              </p>

              <Button
                variant="destructive"
                size="sm"
                isLoading={hook.actionPending}
                disabled={!isLive || hook.actionPending}
                onClick={() => void hook.closePoll(activePollSummary.poll.id)}
              >
                Close poll
              </Button>
            </div>
          </div>
        )}

        {/* 2. DRAFT POLL SECTION */}
        {draftPollSummary && (
          <div
            className="p-4 border border-[#ed793c]/40 bg-[#fffdf8] rounded-lg space-y-3 shadow-xs"
            aria-label="Draft Poll"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#ed793c]">
                Draft Poll
              </span>
              <Badge variant="secondary" className="text-xs">
                Draft
              </Badge>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="poll-question-input"
                className="block text-xs font-semibold text-[#2b2a2e]"
              >
                Question
              </label>
              <textarea
                id="poll-question-input"
                rows={3}
                disabled={!isLive || hook.actionPending}
                value={hook.activeDraftEdits.question}
                onChange={(e) =>
                  hook.updateDraftField("question", e.target.value)
                }
                className="w-full rounded-md border border-[#3a3a3d] bg-[#fffdf8] p-2 text-sm text-[#2b2a2e] focus:outline-none focus:ring-2 focus:ring-[#2b2a2e]"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="poll-rubric-input"
                  className="block text-xs font-semibold text-[#2b2a2e]"
                >
                  Expected answer / rubric
                </label>
                <span className="text-[11px] bg-[#f4e9d7] px-1.5 py-0.5 rounded font-mono text-[#2b2a2e]">
                  Teacher only
                </span>
              </div>
              <textarea
                id="poll-rubric-input"
                rows={3}
                disabled={!isLive || hook.actionPending}
                value={hook.activeDraftEdits.expectedAnswer}
                onChange={(e) =>
                  hook.updateDraftField("expectedAnswer", e.target.value)
                }
                className="w-full rounded-md border border-[#3a3a3d] bg-[#fffdf8] p-2 text-sm text-[#2b2a2e] focus:outline-none focus:ring-2 focus:ring-[#2b2a2e]"
              />
            </div>

            {/* Text Preview */}
            <div className="p-3 bg-[#fdfbf7] border border-[#e6d8bd] rounded-md space-y-1 text-xs text-[#5f5b54]">
              <span className="font-semibold text-[#2b2a2e] block">
                Preview (Students see only the question):
              </span>
              <p className="text-sm text-[#2b2a2e]">
                {hook.activeDraftEdits.question || "(Empty question)"}
              </p>
            </div>

            {hasActivePoll && (
              <p
                role="note"
                className="text-xs text-[#b0384a] font-medium"
              >
                Close the active poll before activating another.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e6d8bd]">
              <Button
                variant="outline"
                size="sm"
                isLoading={hook.actionPending}
                disabled={
                  !isLive ||
                  hook.actionPending ||
                  !hook.activeDraftEdits.isDirty
                }
                onClick={() => void hook.saveDraft()}
              >
                Save draft
              </Button>
              <Button
                variant="default"
                size="sm"
                isLoading={hook.actionPending}
                disabled={!isLive || hook.actionPending || hasActivePoll}
                onClick={() => void hook.activatePoll()}
              >
                Activate poll
              </Button>
            </div>
          </div>
        )}

        {/* 3. GENERATE POLL CONTROLS */}
        {!draftPollSummary && isLive && (
          <div className="p-3 border border-dashed border-[#e6d8bd] rounded-lg space-y-3 bg-[#fffdf8]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5f5b54]">
              Generate New Formative Poll
            </h3>

            <div className="space-y-1.5">
              <label
                htmlFor="poll-concept-select"
                className="block text-xs font-medium text-[#2b2a2e]"
              >
                Topic Concept
              </label>
              <select
                id="poll-concept-select"
                disabled={hook.actionPending || concepts.length === 0}
                value={selectedConceptId}
                onChange={(e) => setSelectedConceptId(e.target.value)}
                className="w-full rounded-md border border-[#3a3a3d] bg-[#fffdf8] p-2 text-sm text-[#2b2a2e] focus:outline-none focus:ring-2 focus:ring-[#2b2a2e]"
              >
                <option value="">Use recently detected concept</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} {c.category ? `(${c.category})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {concepts.length === 0 ? (
              <p className="text-xs text-[#5f5b54]">
                No course concepts found. Add concepts to syllabus to generate
                polls.
              </p>
            ) : (
              <Button
                variant="default"
                size="sm"
                isLoading={hook.actionPending}
                disabled={hook.actionPending}
                onClick={() =>
                  void hook.generatePoll(
                    selectedConceptId ? (selectedConceptId as UUID) : undefined
                  )
                }
              >
                Generate poll
              </Button>
            )}
          </div>
        )}

        {/* 4. CLOSED POLL SECTION (Most recent closed) */}
        {closedPollSummary && !activePollSummary && !draftPollSummary && (
          <div
            className="p-3 border border-[#e6d8bd] bg-[#f4e9d7]/20 rounded-lg space-y-2 text-sm"
            aria-label="Previous Closed Poll"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#5f5b54]">
                Previous Poll
              </span>
              <Badge variant="secondary" className="text-xs">
                Closed
              </Badge>
            </div>
            <p className="text-[#2b2a2e] text-sm font-medium">
              {closedPollSummary.poll.question}
            </p>
            <p className="text-xs text-[#5f5b54] tabular-nums">
              Final: {closedCount === 1 ? "1 response received" : `${closedCount} responses received`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
