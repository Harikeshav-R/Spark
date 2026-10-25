"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { UUID } from "@/contracts/common";
import {
  studyGroupCandidateSchema,
  studyGroupInvitationResponseSchema,
  type StudyGroupCandidate,
} from "@/contracts/classroom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requestJson, getRuntimeAccessToken, ClientApiError } from "@/lib/client/http";
import { FeatureErrorNotice } from "@/features/learning/feature-error-boundary";
import { z } from "zod";

export interface CandidateInvitesProps {
  studentId: UUID;
  courseId: UUID;
  conceptIds: UUID[];
  pool: {
    status: "waiting" | "leaving" | "expired";
    expiresAt: string;
  };
}

interface InvitationReceipt {
  invitationId: UUID;
  expiresAt: string;
}

const candidatesResponseSchema = z.object({
  candidates: z.array(studyGroupCandidateSchema),
});

export function CandidateInvites({
  studentId,
  courseId,
  conceptIds,
  pool,
}: CandidateInvitesProps): React.JSX.Element {
  const [candidates, setCandidates] = useState<StudyGroupCandidate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null);

  // Per-candidate invitation receipts and statuses
  const [invitationReceipts, setInvitationReceipts] = useState<Record<UUID, InvitationReceipt>>({});
  const [inFlightPeerIds, setInFlightPeerIds] = useState<Set<UUID>>(() => new Set());
  const [unavailablePeerIds, setUnavailablePeerIds] = useState<Set<UUID>>(() => new Set());
  const [, setTimerTick] = useState<number>(0);

  const inFlightPeersRef = useRef<Set<UUID>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchGenerationRef = useRef<number>(0);

  // Check if caller's pool has expired
  const isCallerExpired =
    pool.status === "expired" ||
    pool.status === "leaving" ||
    Date.now() >= Date.parse(pool.expiresAt);

  // Timer effect to refresh when caller pool or earliest invitation expires
  useEffect(() => {
    const callerDeadline = Date.parse(pool.expiresAt);
    const receiptDeadlines = Object.values(invitationReceipts)
      .map((r) => Date.parse(r.expiresAt))
      .filter((dl) => dl > Date.now());

    const allFutureDeadlines = [callerDeadline, ...receiptDeadlines].filter((dl) => dl > Date.now());

    if (allFutureDeadlines.length === 0) {
      return;
    }

    const nextDeadline = Math.min(...allFutureDeadlines);
    const delay = Math.max(50, nextDeadline - Date.now());

    const timeout = setTimeout(() => {
      setTimerTick((t) => t + 1);
    }, delay);

    return () => {
      clearTimeout(timeout);
    };
  }, [pool.expiresAt, invitationReceipts]);

  // Fetch candidates from server
  const fetchCandidates = useCallback(
    async (signal?: AbortSignal) => {
      // Only fetch when waiting and caller deadline has not passed
      if (pool.status !== "waiting" || Date.now() >= Date.parse(pool.expiresAt)) {
        setIsLoading(false);
        return;
      }

      const generation = ++fetchGenerationRef.current;
      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await requestJson(
          `/api/courses/${courseId}/study-groups/candidates`,
          candidatesResponseSchema,
          { getAccessToken: getRuntimeAccessToken, signal }
        );

        if (signal?.aborted || generation !== fetchGenerationRef.current) {
          return;
        }

        setCandidates(data.candidates);
      } catch (err: unknown) {
        if (signal?.aborted || generation !== fetchGenerationRef.current) {
          return;
        }
        setLoadError(
          err instanceof Error ? err.message : "Failed to load candidate study partners."
        );
      } finally {
        if (!signal?.aborted && generation === fetchGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [courseId, pool.status, pool.expiresAt]
  );

  // Initial fetch on mount or key change
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    void fetchCandidates(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchCandidates]);

  // Handle Send Invite
  const handleSendInvite = async (candidate: StudyGroupCandidate) => {
    // Synchronously verify caller pool state and wall-clock deadline
    if (pool.status !== "waiting" || Date.now() >= Date.parse(pool.expiresAt)) {
      return;
    }

    if (inFlightPeersRef.current.has(candidate.studentId)) {
      return;
    }

    inFlightPeersRef.current.add(candidate.studentId);
    setInFlightPeerIds((prev) => new Set(prev).add(candidate.studentId));
    setActionError(null);

    try {
      // Preflight: refetch candidates to check current consent/eligibility
      const preflight = await requestJson(
        `/api/courses/${courseId}/study-groups/candidates`,
        candidatesResponseSchema,
        { getAccessToken: getRuntimeAccessToken }
      );

      const stillEligible = preflight.candidates.find(
        (c) => c.studentId === candidate.studentId
      );

      if (!stillEligible) {
        setUnavailablePeerIds((prev) => new Set(prev).add(candidate.studentId));
        setStatusAnnouncement(`Classmate ${candidate.studentId.slice(0, 8)}… is no longer available.`);
        setCandidates([candidate, ...preflight.candidates.filter((c) => c.studentId !== candidate.studentId)]);
        return;
      }

      setCandidates(preflight.candidates);
      // Compute shared concepts preserving candidate order (1 to 3 concepts)
      const sharedIds: UUID[] = [];
      for (const req of stillEligible.requestedConcepts) {
        if (conceptIds.includes(req.conceptId) && !sharedIds.includes(req.conceptId)) {
          sharedIds.push(req.conceptId);
        }
      }

      if (sharedIds.length === 0) {
        setUnavailablePeerIds((prev) => new Set(prev).add(candidate.studentId));
        setStatusAnnouncement(`No shared concepts with Classmate ${candidate.studentId.slice(0, 8)}…`);
        return;
      }

      const payloadConceptIds = sharedIds.slice(0, 3);

      const invitation = await requestJson(
        `/api/courses/${courseId}/study-groups/invitations`,
        studyGroupInvitationResponseSchema,
        {
          getAccessToken: getRuntimeAccessToken,
          method: "POST",
          body: {
            inviteeId: candidate.studentId,
            conceptIds: payloadConceptIds,
          },
        }
      );

      setInvitationReceipts((prev) => ({
        ...prev,
        [candidate.studentId]: {
          invitationId: invitation.invitationId,
          expiresAt: invitation.expiresAt,
        },
      }));

      setStatusAnnouncement(`Invite sent to Classmate ${candidate.studentId.slice(0, 8)}…`);
    } catch (err: unknown) {
      if (err instanceof ClientApiError && (err.code === "INVITATION_EXPIRED" || err.status === 409)) {
        setUnavailablePeerIds((prev) => new Set(prev).add(candidate.studentId));
        setActionError(err.message || "Invitation expired or partner is no longer available.");
        void fetchCandidates();
      } else {
        setActionError(
          err instanceof Error ? err.message : "Failed to send study group invitation."
        );
      }
    } finally {
      inFlightPeersRef.current.delete(candidate.studentId);
      setInFlightPeerIds((prev) => {
        const next = new Set(prev);
        next.delete(candidate.studentId);
        return next;
      });
    }
  };

  // Filter candidates: exclude caller, require at least one shared concept
  const eligibleCandidates = candidates.filter((c) => {
    if (c.studentId === studentId) return false;
    return c.requestedConcepts.some((rc) => conceptIds.includes(rc.conceptId));
  });

  return (
    <Card className="border-[#e6d8bd] bg-[#fffdf8] shadow-sm">
      <CardHeader className="pb-3 border-b border-[#e6d8bd]/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-bold text-[#2b2a2e]">
              Available Study Partners
            </CardTitle>
            <CardDescription className="text-xs text-[#5f5b54]">
              Classmates currently waiting to study overlapping concepts with complementary strengths.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchCandidates()}
            disabled={isLoading || isCallerExpired || pool.status !== "waiting"}
          >
            Refresh candidates
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Status announcement for screen readers */}
        {statusAnnouncement && (
          <div role="status" aria-live="polite" className="sr-only">
            {statusAnnouncement}
          </div>
        )}

        {/* Action Error Notice */}
        {actionError && (
          <FeatureErrorNotice
            message={actionError}
            onRetry={() => setActionError(null)}
          />
        )}

        {/* Load Error Notice */}
        {loadError && (
          <FeatureErrorNotice
            message={loadError}
            onRetry={() => void fetchCandidates()}
          />
        )}

        {/* Loading State */}
        {isLoading && !loadError && (
          <div className="py-6 text-center text-xs text-[#5f5b54] italic">
            Finding consenting study partners…
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !loadError && eligibleCandidates.length === 0 && (
          <div className="rounded-lg border border-[#e6d8bd] bg-[#fbf5ec] p-4 text-xs text-[#5f5b54] text-center">
            No consenting study partners available right now.
          </div>
        )}

        {/* Candidate List */}
        {!isLoading && !loadError && eligibleCandidates.length > 0 && (
          <div className="space-y-3">
            {eligibleCandidates.map((candidate) => {
              const receipt = invitationReceipts[candidate.studentId];
              const isReceiptExpired = receipt && Date.now() >= Date.parse(receipt.expiresAt);
              const isUnavailable = unavailablePeerIds.has(candidate.studentId);
              const isInFlight = inFlightPeerIds.has(candidate.studentId);

              // Calculate shared concepts for this candidate
              const sharedConcepts = candidate.requestedConcepts.filter((rc) =>
                conceptIds.includes(rc.conceptId)
              );

              // Fit badge calculation
              const fitPercent = Math.min(99, Math.round(100 * candidate.complementaryGap));
              const fitText =
                candidate.fitKind === "reciprocal"
                  ? `${fitPercent}% Fit — Reciprocal Strengths`
                  : `${fitPercent}% Fit — Mentor Fit`;

              // Action button label & disabled logic
              let actionLabel = "Send Invite";
              let actionDisabled = isCallerExpired || pool.status !== "waiting";

              if (isUnavailable) {
                actionLabel = "No longer available";
                actionDisabled = true;
              } else if (isReceiptExpired) {
                actionLabel = "Invitation expired";
                actionDisabled = true;
              } else if (receipt) {
                actionLabel = "Invite sent";
                actionDisabled = true;
              } else if (isInFlight) {
                actionLabel = "Sending…";
                actionDisabled = true;
              }

              return (
                <div
                  key={candidate.studentId}
                  className="rounded-lg border border-[#e6d8bd] bg-[#fffdf8] p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors hover:border-[#ecdcc0]"
                  data-testid={`candidate-card-${candidate.studentId}`}
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-[#2b2a2e]">
                        {`Classmate ${candidate.studentId.slice(0, 8)}…`}
                      </span>
                      <Badge
                        variant="soft"
                        className={
                          candidate.fitKind === "reciprocal"
                            ? "border-[#2b7f55]/30 bg-[#dff1e5] text-[#2b7f55]"
                            : "border-[#cf951f]/30 bg-[#fef5e7] text-[#a9481a]"
                        }
                      >
                        {fitText}
                      </Badge>
                    </div>

                    {/* Concept Badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {candidate.requestedConcepts.map((rc) => {
                        const isShared = sharedConcepts.some((sc) => sc.conceptId === rc.conceptId);
                        return (
                          <Badge
                            key={rc.conceptId}
                            mastery={rc.band}
                            variant="soft"
                            className={
                              isShared
                                ? "border-[#ed793c]/60 bg-[#fffdf8] font-medium"
                                : "opacity-80"
                            }
                          >
                            {rc.label}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  <div className="shrink-0 sm:self-center">
                    <Button
                      type="button"
                      size="sm"
                      variant={receipt && !isReceiptExpired ? "outline" : "default"}
                      disabled={actionDisabled}
                      isLoading={isInFlight}
                      onClick={() => void handleSendInvite(candidate)}
                    >
                      {actionLabel}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
