"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { getAccessToken, setRuntimeSession } from "@/lib/client/session";

const DEMO_PASSWORD = "DemoPass123!";
const CS229_COURSE_ID = "11111111-1111-4111-8111-111111111111";

interface DemoState {
  courseId: string;
  lectureId: string | null;
  activePollId: string | null;
  speech: {
    playing: boolean;
    speed: number;
    nextIndex: number;
    total: number;
  };
  lastError: string | null;
}

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "teacher" | "student";
}

export function DemoToolbar(): React.JSX.Element {
  const [demoState, setDemoState] = useState<DemoState | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isPollingRef = useRef(false);

  const fetchState = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const token = await getAccessToken();
      if (!token) {
        return;
      }

      // 1. Fetch demo state
      const res = await fetch("/api/demo/state", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
        },
        signal,
      });

      if (res.ok) {
        const data = (await res.json()) as DemoState;
        setDemoState(data);
      }

      // 2. Fetch current user identity if not loaded
      const meRes = await fetch("/api/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      if (meRes.ok) {
        const meData = (await meRes.json()) as CurrentUser;
        setCurrentUser(meData);
      }
    } catch {
      if (signal?.aborted) return;
      // Do not surface routine polling errors to avoid flashing UI
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchState(controller.signal);

    const interval = setInterval(() => {
      void fetchState(controller.signal);
    }, 3000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchState]);

  const handleSwitchPersona = async (email: string): Promise<void> => {
    setIsPending(true);
    setStatusMessage(`Switching to ${email}...`);
    setErrorMessage(null);

    try {
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: DEMO_PASSWORD }),
      });

      if (!loginRes.ok) {
        const errJson = (await loginRes.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errJson.error?.message ?? `Login failed (${loginRes.status})`);
      }

      const loginData = (await loginRes.json()) as {
        session: { accessToken: string; expiresAt: number };
      };

      setRuntimeSession(loginData.session);

      const meRes = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${loginData.session.accessToken}` },
      });

      if (!meRes.ok) {
        throw new Error("Failed to verify switched profile identity");
      }

      const meData = (await meRes.json()) as CurrentUser & {
        enrollments?: Array<{ courseId: string; studentId: string }>;
      };

      setStatusMessage(`Logged in as ${meData.name}. Navigating...`);

      if (meData.role === "teacher") {
        window.location.assign("/professor/dashboard");
      } else {
        const enrollment = meData.enrollments?.find((e) => e.courseId === CS229_COURSE_ID);
        const targetStudentId = enrollment?.studentId ?? meData.id;
        window.location.assign(`/student/${targetStudentId}?courseId=${CS229_COURSE_ID}`);
      }
    } catch (err: unknown) {
      setIsPending(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatusMessage(null);
    }
  };

  const handleSpeechAction = async (
    action: "play" | "pause" | "step" | "speed",
    speed?: 1 | 2 | 5,
  ): Promise<void> => {
    if (!demoState?.lectureId) return;

    setIsPending(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/demo/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lectureId: demoState.lectureId,
          action,
          speed,
        }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errJson.error?.message ?? `Speech control failed (${res.status})`);
      }

      setStatusMessage(`Speech action '${action}' completed.`);
      await fetchState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsPending(false);
    }
  };

  const handleSubmitPoll = async (): Promise<void> => {
    if (!demoState?.activePollId) return;

    setIsPending(true);
    setErrorMessage(null);
    setStatusMessage("Submitting simulated responses for Hari & Rahul...");

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/demo/poll-responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pollId: demoState.activePollId }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errJson.error?.message ?? `Poll submission failed (${res.status})`);
      }

      setStatusMessage("Poll responses submitted for Hari and Rahul.");
      await fetchState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatusMessage(null);
    } finally {
      setIsPending(false);
    }
  };

  const handleInstantMatch = async (): Promise<void> => {
    setIsPending(true);
    setErrorMessage(null);
    setStatusMessage("Matching Hari & Rahul for Backpropagation...");

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/demo/instant-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errJson.error?.message ?? `Instant match failed (${res.status})`);
      }

      setStatusMessage("Instant match successfully established between Hari and Rahul.");
      await fetchState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatusMessage(null);
    } finally {
      setIsPending(false);
    }
  };

  const isTeacher = currentUser?.role === "teacher";
  const hasLiveLecture = Boolean(demoState?.lectureId);
  const hasActivePoll = Boolean(demoState?.activePollId);
  const speech = demoState?.speech;

  return (
    <aside
      aria-label="Demo toolbar"
      className="sticky top-0 z-40 w-full bg-[#fffdf8] border-b border-[#e6d8bd] text-[#2b2a2e] text-xs shadow-sm"
    >
      <details className="group md:open">
        <summary className="flex items-center justify-between px-4 py-2 cursor-pointer list-none select-none hover:bg-[#f4e9d7]">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-[#f4e9d7] border border-[#e6d8bd] text-[#2b2a2e]">
              Demo · simulated actions
            </span>
            <span className="text-[#5f5b54]">
              {currentUser ? `Signed in as ${currentUser.name}` : "Not signed in"}
            </span>
            {isPending && <span className="text-[#ed793c] animate-pulse">Working...</span>}
          </div>
          <span className="text-[#5f5b54] md:hidden">Toggle toolbar</span>
        </summary>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-[#e6d8bd] bg-[#faf6ee]">
          {/* Persona Switchers */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Switch persona">
            <span className="font-medium text-[#5f5b54] mr-1">Personas:</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void handleSwitchPersona("sarah.chen@example.test")}
              className={`min-h-[44px] px-3 py-1.5 rounded border text-xs font-medium cursor-pointer transition-colors ${
                currentUser?.email === "sarah.chen@example.test"
                  ? "bg-[#ed793c] text-[#2b2a2e] border-[#3a3a3d]"
                  : "bg-[#fffdf8] text-[#2b2a2e] border-[#e6d8bd] hover:bg-[#f4e9d7]"
              }`}
            >
              Prof. Chen
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void handleSwitchPersona("hari@example.test")}
              className={`min-h-[44px] px-3 py-1.5 rounded border text-xs font-medium cursor-pointer transition-colors ${
                currentUser?.email === "hari@example.test"
                  ? "bg-[#ed793c] text-[#2b2a2e] border-[#3a3a3d]"
                  : "bg-[#fffdf8] text-[#2b2a2e] border-[#e6d8bd] hover:bg-[#f4e9d7]"
              }`}
            >
              Hari
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void handleSwitchPersona("rahul@example.test")}
              className={`min-h-[44px] px-3 py-1.5 rounded border text-xs font-medium cursor-pointer transition-colors ${
                currentUser?.email === "rahul@example.test"
                  ? "bg-[#ed793c] text-[#2b2a2e] border-[#3a3a3d]"
                  : "bg-[#fffdf8] text-[#2b2a2e] border-[#e6d8bd] hover:bg-[#f4e9d7]"
              }`}
            >
              Rahul
            </button>
          </div>

          {/* Speech Controls */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Speech controls">
            <span className="font-medium text-[#5f5b54] mr-1">Lecture:</span>
            <button
              type="button"
              disabled={isPending || !isTeacher || !hasLiveLecture}
              onClick={() => void handleSpeechAction(speech?.playing ? "pause" : "play")}
              className="min-h-[44px] px-3 py-1.5 rounded border border-[#e6d8bd] bg-[#fffdf8] hover:bg-[#f4e9d7] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
            >
              {speech?.playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              disabled={isPending || !isTeacher || !hasLiveLecture || speech?.playing}
              onClick={() => void handleSpeechAction("step")}
              className="min-h-[44px] px-3 py-1.5 rounded border border-[#e6d8bd] bg-[#fffdf8] hover:bg-[#f4e9d7] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
            >
              Step Chunk
            </button>
            <label className="flex items-center gap-1 text-[#5f5b54] text-xs">
              <span>Speed:</span>
              <select
                disabled={isPending || !isTeacher || !hasLiveLecture}
                value={speech?.speed ?? 1}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (val === 1 || val === 2 || val === 5) {
                    void handleSpeechAction("speed", val);
                  }
                }}
                className="min-h-[44px] px-2 py-1 bg-[#fffdf8] border border-[#e6d8bd] rounded text-xs text-[#2b2a2e]"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
              </select>
            </label>
            <span className="text-[#5f5b54] px-1">
              {speech ? `${speech.nextIndex} / ${speech.total}` : "—"}
            </span>
          </div>

          {/* Assessment & Match Actions */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Interactive actions">
            <button
              type="button"
              disabled={isPending || !isTeacher || !hasActivePoll}
              onClick={() => void handleSubmitPoll()}
              className="min-h-[44px] px-3 py-1.5 rounded border border-[#e6d8bd] bg-[#fffdf8] hover:bg-[#f4e9d7] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
            >
              Auto-Submit Responses
            </button>
            <button
              type="button"
              disabled={isPending || !isTeacher}
              onClick={() => void handleInstantMatch()}
              className="min-h-[44px] px-3 py-1.5 rounded border border-[#e6d8bd] bg-[#fffdf8] hover:bg-[#f4e9d7] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
            >
              Instant Match
            </button>
          </div>
        </div>

        {/* Live Feedback Banner */}
        <div
          aria-live="polite"
          className="px-4 py-1 text-xs border-t border-[#e6d8bd] flex items-center justify-between min-h-[28px]"
        >
          {errorMessage && (
            <span className="text-[#b0384a] font-medium">Error: {errorMessage}</span>
          )}
          {!errorMessage && statusMessage && (
            <span className="text-[#2b7f55] font-medium">{statusMessage}</span>
          )}
          {!errorMessage && !statusMessage && (
            <span className="text-[#5f5b54]">Ready</span>
          )}
        </div>
      </details>
    </aside>
  );
}
