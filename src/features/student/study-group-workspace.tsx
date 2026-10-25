"use client";

import React, { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import { uuidSchema } from "@/contracts/common";
import { requestJson, ClientApiError, getRuntimeAccessToken } from "@/lib/client/http";
import { SignInPrompt } from "@/features/auth/sign-in-prompt";
import { FeatureErrorNotice } from "@/features/learning/feature-error-boundary";
import { StudyGroupFeature } from "@/features/study-groups";
import { StudyGroupAvailability } from "./study-group-availability";
import { MatchedPeerSession } from "./matched-peer-session";

export interface StudyGroupWorkspaceProps {
  studentId: UUID;
  courseId: UUID;
}

const authMeSchema = z.object({
  role: z.enum(["teacher", "student"]),
  enrollments: z.array(
    z.object({
      studentId: uuidSchema,
      courseId: uuidSchema,
    })
  ),
});

export function StudyGroupWorkspace({
  studentId,
  courseId,
}: StudyGroupWorkspaceProps): React.JSX.Element {
  const [authStatus, setAuthStatus] = useState<
    "loading" | "unauthorized" | "forbidden" | "error" | "authorized"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const verifyEnrollment = useCallback(
    async (signal?: AbortSignal) => {
      setAuthStatus("loading");
      setErrorMessage(null);

      try {
        const profile = await requestJson("/api/auth/me", authMeSchema, {
          getAccessToken: getRuntimeAccessToken,
          signal,
        });

        if (profile.role !== "student") {
          setAuthStatus("forbidden");
          return;
        }

        const isEnrolled = profile.enrollments.some(
          (e) => e.studentId === studentId && e.courseId === courseId
        );

        if (!isEnrolled) {
          setAuthStatus("forbidden");
          return;
        }

        setAuthStatus("authorized");
      } catch (err: unknown) {
        if (signal?.aborted) return;

        if (err instanceof ClientApiError) {
          if (err.status === 401) {
            setAuthStatus("unauthorized");
            return;
          }
          if (err.status === 403) {
            setAuthStatus("forbidden");
            return;
          }
        }

        setAuthStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to verify student authorization."
        );
      }
    },
    [studentId, courseId]
  );

  useEffect(() => {
    const controller = new AbortController();
    verifyEnrollment(controller.signal);
    return () => {
      controller.abort();
    };
  }, [verifyEnrollment]);

  if (authStatus === "loading") {
    return (
      <div className="p-8 text-center" data-testid="study-group-loading">
        <p className="text-sm text-[#5f5b54]">Verifying student authorization...</p>
      </div>
    );
  }

  if (authStatus === "unauthorized") {
    return (
      <div className="py-6 flex justify-center" data-testid="study-group-unauthorized">
        <SignInPrompt />
      </div>
    );
  }

  if (authStatus === "forbidden") {
    return (
      <div
        role="alert"
        className="p-6 rounded-xl border border-[#e2a898] bg-[#fbf2ef] text-[#8a2414] space-y-2 shadow-xs"
        data-testid="study-group-forbidden"
      >
        <h3 className="font-bold text-base">Access Forbidden</h3>
        <p className="text-sm">
          You do not have an active student enrollment in this course. Study group matchmaking
          and peer collaboration are restricted to enrolled students.
        </p>
      </div>
    );
  }

  if (authStatus === "error") {
    return (
      <div className="py-4" data-testid="study-group-error">
        <FeatureErrorNotice
          message={errorMessage ?? "An error occurred while loading your study group workspace."}
          onRetry={() => verifyEnrollment()}
        />
      </div>
    );
  }

  return (
    <div key={`${studentId}-${courseId}`} className="space-y-8" data-testid="study-group-workspace-content">
      {/* 1. Availability Picker */}
      <StudyGroupAvailability courseId={courseId} />

      {/* 2. Study Group Lobby & Matchmaking */}
      <StudyGroupFeature
        studentId={studentId}
        courseId={courseId}
        renderMatchedSession={(sessionCtx) => (
          <MatchedPeerSession
            key={sessionCtx.matchId}
            {...sessionCtx}
            studentId={studentId}
            courseId={courseId}
          />
        )}
      />
    </div>
  );
}
