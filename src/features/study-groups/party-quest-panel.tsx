"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { UUID } from "@/contracts/common";
import {
  partyQuestItemSchema,
  type PartyQuestItem,
} from "@/contracts/classroom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { FeatureErrorNotice } from "@/features/learning/feature-error-boundary";
import { z } from "zod";

export interface PartyQuestPanelProps {
  matchId: UUID;
  studentId: UUID;
  concepts: { id: UUID; label: string }[];
  peerName?: string;
  refreshKey: number;
}

const partyQuestsResponseSchema = z.object({
  partyQuests: z.array(partyQuestItemSchema),
});

interface ValidatedQuestMatrix {
  quest: PartyQuestItem;
  partnerId: UUID;
  totalPairs: number;
  completedPairs: number;
  isValid: boolean;
}

function validateQuestMatrix(
  quest: PartyQuestItem,
  currentStudentId: UUID
): ValidatedQuestMatrix {
  // Validate concepts: 1 to 3 distinct concepts
  if (
    quest.conceptIds.length < 1 ||
    quest.conceptIds.length > 3 ||
    new Set(quest.conceptIds).size !== quest.conceptIds.length
  ) {
    return {
      quest,
      partnerId: "" as UUID,
      totalPairs: 0,
      completedPairs: 0,
      isValid: false,
    };
  }

  // Find distinct students
  const studentIds = Array.from(new Set(quest.progress.map((p) => p.studentId)));
  if (studentIds.length !== 2 || !studentIds.includes(currentStudentId)) {
    return {
      quest,
      partnerId: "" as UUID,
      totalPairs: 0,
      completedPairs: 0,
      isValid: false,
    };
  }

  const partnerId = studentIds.find((id) => id !== currentStudentId)!;
  const expectedTotal = 2 * quest.conceptIds.length;

  if (quest.progress.length !== expectedTotal) {
    return {
      quest,
      partnerId,
      totalPairs: expectedTotal,
      completedPairs: 0,
      isValid: false,
    };
  }

  // Ensure exactly one progress entry for each (student, concept) pair
  const seenPairs = new Set<string>();
  let completedCount = 0;

  for (const item of quest.progress) {
    if (!quest.conceptIds.includes(item.conceptId)) {
      return {
        quest,
        partnerId,
        totalPairs: expectedTotal,
        completedPairs: 0,
        isValid: false,
      };
    }
    const key = `${item.studentId}:${item.conceptId}`;
    if (seenPairs.has(key)) {
      return {
        quest,
        partnerId,
        totalPairs: expectedTotal,
        completedPairs: 0,
        isValid: false,
      };
    }
    seenPairs.add(key);
    if (item.completed) {
      completedCount++;
    }
  }

  return {
    quest,
    partnerId,
    totalPairs: expectedTotal,
    completedPairs: completedCount,
    isValid: true,
  };
}

export function PartyQuestPanel({
  matchId,
  studentId,
  concepts,
  peerName,
  refreshKey,
}: PartyQuestPanelProps): React.JSX.Element {
  const [partyQuests, setPartyQuests] = useState<PartyQuestItem[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchGenerationRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchQuests = useCallback(
    async (signal?: AbortSignal) => {
      const generation = ++fetchGenerationRef.current;
      setIsLoading(true);

      try {
        const data = await requestJson(
          `/api/study-groups/${matchId}/quests`,
          partyQuestsResponseSchema,
          { getAccessToken: getRuntimeAccessToken, signal }
        );

        if (signal?.aborted || generation !== fetchGenerationRef.current) {
          return;
        }

        setPartyQuests(data.partyQuests);
        setFetchError(null);
      } catch (err: unknown) {
        if (signal?.aborted || generation !== fetchGenerationRef.current) {
          return;
        }
        setFetchError(
          err instanceof Error ? err.message : "Failed to load party quests."
        );
      } finally {
        if (!signal?.aborted && generation === fetchGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [matchId]
  );

  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    void fetchQuests(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchQuests, refreshKey]);

  const partnerLabel = peerName || "Study partner";

  return (
    <div className="space-y-4" data-testid="party-quest-panel">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-[#2b2a2e]">Party Quests</h3>
          <p className="text-xs text-[#5f5b54]">
            Collaborative goals for this study session. Complete quizzes together to earn bilateral rewards.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchQuests()}
          disabled={isLoading}
        >
          Refresh progress
        </Button>
      </div>

      {/* Fetch error when no previous data exists */}
      {fetchError && partyQuests === null && (
        <FeatureErrorNotice
          message={fetchError}
          onRetry={() => void fetchQuests()}
        />
      )}

      {/* Stale notice when refresh fails but previous data exists */}
      {fetchError && partyQuests !== null && (
        <FeatureErrorNotice
          message={`Unable to refresh progress. Showing last recorded snapshot: ${fetchError}`}
          onRetry={() => void fetchQuests()}
        />
      )}

      {/* Loading state without data */}
      {isLoading && partyQuests === null && (
        <div className="py-6 text-center text-xs text-[#5f5b54] italic">
          Loading party quests…
        </div>
      )}

      {/* Empty quests state */}
      {!isLoading && partyQuests !== null && partyQuests.length === 0 && !fetchError && (
        <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-xs text-[#5f5b54] text-center">
          No party quests for this match yet.
        </div>
      )}

      {/* Render Quests */}
      {partyQuests !== null && partyQuests.length > 0 && (
        <div className="space-y-4">
          {partyQuests.map((quest) => {
            const matrix = validateQuestMatrix(quest, studentId);

            let statusLabel: string;
            let statusBadgeClass: string;
            switch (quest.status) {
              case "active":
                statusLabel = "Active";
                statusBadgeClass = "border-[#cf951f]/40 bg-[#fef5e7] text-[#a9481a]";
                break;
              case "completed":
                statusLabel = "Completed";
                statusBadgeClass = "border-[#1b5e3b]/40 bg-[#dff1e5] text-[#1b5e3b]";
                break;
              case "cancelled":
                statusLabel = "Cancelled";
                statusBadgeClass = "border-[#e6d8bd] bg-[#fbf5ec] text-[#5f5b54]";
                break;
            }

            if (!matrix.isValid) {
              return (
                <Card
                  key={quest.partyQuestId}
                  className="border-[#e6d8bd] bg-[#fffdf8] shadow-xs"
                >
                  <CardHeader className="pb-3 border-b border-[#e6d8bd]/60">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold text-[#2b2a2e]">
                        Collaborative Quest
                      </CardTitle>
                      <Badge variant="soft" className={statusBadgeClass}>
                        {statusLabel}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <FeatureErrorNotice message="Party quest progress is unavailable." />
                  </CardContent>
                </Card>
              );
            }

            return (
              <Card
                key={quest.partyQuestId}
                className="border-[#e6d8bd] bg-[#fffdf8] shadow-xs"
                data-testid={`party-quest-card-${quest.partyQuestId}`}
              >
                <CardHeader className="pb-3 border-b border-[#e6d8bd]/60">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm font-bold text-[#2b2a2e]">
                          Collaborative Study Goal
                        </CardTitle>
                        <Badge variant="soft" className={statusBadgeClass}>
                          {statusLabel}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs text-[#5f5b54]">
                        {matrix.completedPairs} of {matrix.totalPairs} pairs completed
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-4">
                  <div className="overflow-x-auto rounded-lg border border-[#e6d8bd]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#e6d8bd] bg-[#fbf5ec] text-[#5f5b54]">
                          <th scope="col" className="py-2.5 px-3.5 font-semibold">
                            Target Concept
                          </th>
                          <th scope="col" className="py-2.5 px-3.5 font-semibold text-center w-28">
                            You
                          </th>
                          <th scope="col" className="py-2.5 px-3.5 font-semibold text-center w-36">
                            {partnerLabel}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e6d8bd]/60">
                        {quest.conceptIds.map((cid) => {
                          const foundConcept = concepts.find((c) => c.id === cid);
                          const conceptLabel =
                            foundConcept?.label || `Concept ${cid.slice(0, 8)}…`;

                          const userProgress = quest.progress.find(
                            (p) => p.studentId === studentId && p.conceptId === cid
                          );
                          const partnerProgress = quest.progress.find(
                            (p) => p.studentId === matrix.partnerId && p.conceptId === cid
                          );

                          const isUserComplete = userProgress?.completed ?? false;
                          const isPartnerComplete = partnerProgress?.completed ?? false;

                          return (
                            <tr
                              key={cid}
                              className="hover:bg-[#fffdf8]/80 transition-colors"
                            >
                              <td className="py-3 px-3.5 font-medium text-[#2b2a2e]">
                                {conceptLabel}
                              </td>

                              {/* You Column */}
                              <td className="py-3 px-3.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    disabled
                                    checked={isUserComplete}
                                    aria-label={`Your ${conceptLabel} quiz`}
                                    className="h-4 w-4 rounded border-[#e6d8bd] text-[#2b7f55] cursor-default accent-[#2b7f55]"
                                  />
                                  <span
                                    className={`text-[11px] font-medium ${
                                      isUserComplete
                                        ? "text-[#2b7f55]"
                                        : "text-[#5f5b54]"
                                    }`}
                                  >
                                    {isUserComplete ? "Complete" : "Pending"}
                                  </span>
                                </div>
                              </td>

                              {/* Partner Column */}
                              <td className="py-3 px-3.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    disabled
                                    checked={isPartnerComplete}
                                    aria-label={`${partnerLabel} ${conceptLabel} quiz`}
                                    className="h-4 w-4 rounded border-[#e6d8bd] text-[#2b7f55] cursor-default accent-[#2b7f55]"
                                  />
                                  <span
                                    className={`text-[11px] font-medium ${
                                      isPartnerComplete
                                        ? "text-[#2b7f55]"
                                        : "text-[#5f5b54]"
                                    }`}
                                  >
                                    {isPartnerComplete ? "Complete" : "Pending"}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
