"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import type { UUID } from "@/contracts/common";
import {
  studyGroupMessageSchema,
  timeIntervalSchema,
  type TimeInterval,
} from "@/contracts/classroom";
import {
  studyGroupMessageEventSchema,
  studyGroupUpdatedEventSchema,
} from "@/contracts/realtime";
import type { StudyGroupMatchedSessionContext } from "@/features/study-groups";
import { requestJson, getRuntimeAccessToken } from "@/lib/client/http";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FeatureErrorNotice } from "@/features/learning/feature-error-boundary";

export interface MatchedPeerSessionProps extends StudyGroupMatchedSessionContext {
  studentId: UUID;
  courseId: UUID;
}

interface MessageItem {
  id: UUID;
  senderId: UUID;
  content: string;
  createdAt: string;
}

interface SchedulingState {
  status: "pending" | "proposed" | "accepted" | "no-overlap";
  slot?: TimeInterval;
  meetingStatus: "pending" | "created" | "unavailable";
  zoomLink?: string;
  student1Accepted: boolean;
  student2Accepted: boolean;
}

const proposeResponseSchema = z.object({
  schedulingStatus: z.enum(["proposed", "no-overlap"]),
  proposedSlot: timeIntervalSchema.optional(),
});

const acceptResponseSchema = z.object({
  schedulingStatus: z.enum(["pending", "proposed", "accepted", "no-overlap"]),
  bothAccepted: z.boolean(),
  zoomMeeting: z
    .object({
      meetingId: z.string().min(1),
      joinUrl: z.string().url(),
    })
    .optional(),
});

function formatSlotTime(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isValidHttpsUrl(urlString?: string): boolean {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function MatchedPeerSession({
  matchId,
  peerName,
  socket,
  roomJoined,
  roomRevision,
  studentId,
}: MatchedPeerSessionProps): React.JSX.Element {
  // Chat state
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(true);
  const [messageHistoryError, setMessageHistoryError] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Scheduling state
  const [schedulingState, setSchedulingState] = useState<SchedulingState>({
    status: "pending",
    meetingStatus: "pending",
    student1Accepted: false,
    student2Accepted: false,
  });
  const [localAcceptedSlot, setLocalAcceptedSlot] = useState<TimeInterval | null>(null);
  const [isSchedulingActionPending, setIsSchedulingActionPending] = useState<boolean>(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [schedulingEventCounter, setSchedulingEventCounter] = useState<number>(0);
  const eventCounterRef = useRef<number>(0);
  eventCounterRef.current = schedulingEventCounter;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // 1. Subscribe to study-group:message
  useEffect(() => {
    if (!socket) return;

    const handleMessageEvent = (rawData: unknown) => {
      const parsed = studyGroupMessageEventSchema.safeParse(rawData);
      if (!parsed.success) return;
      const ev = parsed.data;
      if (ev.matchId !== matchId) return;

      const incomingMsg: MessageItem = {
        id: ev.messageId,
        senderId: ev.senderId,
        content: ev.content,
        createdAt: ev.occurredAt,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === incomingMsg.id)) return prev;
        const merged = [...prev, incomingMsg];
        merged.sort((a, b) => {
          const timeDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });
        return merged;
      });
    };

    socket.on("study-group:message", handleMessageEvent);
    return () => {
      socket.off("study-group:message", handleMessageEvent);
    };
  }, [socket, matchId]);

  // 2. Fetch message history on roomJoined and roomRevision
  const fetchMessages = useCallback(
    async (signal?: AbortSignal) => {
      if (!roomJoined) return;
      setIsLoadingMessages(true);
      setMessageHistoryError(null);
      try {
        const history = await requestJson(
          `/api/study-groups/${matchId}/messages`,
          z.array(studyGroupMessageSchema),
          { getAccessToken: getRuntimeAccessToken, signal }
        );

        setMessages((prev) => {
          const map = new Map<string, MessageItem>();
          for (const m of history) {
            map.set(m.id, {
              id: m.id,
              senderId: m.senderId,
              content: m.content,
              createdAt: m.createdAt,
            });
          }
          for (const m of prev) {
            map.set(m.id, m);
          }
          const merged = Array.from(map.values());
          merged.sort((a, b) => {
            const timeDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
            if (timeDiff !== 0) return timeDiff;
            return a.id.localeCompare(b.id);
          });
          return merged;
        });
      } catch (err: unknown) {
        if (signal?.aborted) return;
        setMessageHistoryError(
          err instanceof Error ? err.message : "Failed to load chat history."
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoadingMessages(false);
        }
      }
    },
    [matchId, roomJoined]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchMessages(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchMessages, roomRevision]);

  // 3. Send message handler
  const handleSendMessage = async () => {
    const draftSnapshot = draft;
    const trimmed = draftSnapshot.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) {
      setSendError("Message cannot exceed 2000 characters.");
      return;
    }
    if (!roomJoined || isSendingMessage) return;

    setIsSendingMessage(true);
    setSendError(null);

    try {
      const saved = await requestJson(
        `/api/study-groups/${matchId}/messages`,
        studyGroupMessageSchema,
        {
          method: "POST",
          getAccessToken: getRuntimeAccessToken,
          body: { content: trimmed },
        }
      );

      const savedMsg: MessageItem = {
        id: saved.id,
        senderId: saved.senderId,
        content: saved.content,
        createdAt: saved.createdAt,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === savedMsg.id)) return prev;
        const merged = [...prev, savedMsg];
        merged.sort((a, b) => {
          const timeDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });
        return merged;
      });

      // Clear draft snapshot only if not edited concurrently
      setDraft((curr) => (curr === draftSnapshot ? "" : curr));
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "Please try again.";
      setSendError(`Failed to send message: ${detail}`);
    } finally {
      setIsSendingMessage(false);
    }
  };

  // 4. Subscribe to study-group:updated
  useEffect(() => {
    if (!socket) return;

    const handleUpdatedEvent = (rawData: unknown) => {
      const parsed = studyGroupUpdatedEventSchema.safeParse(rawData);
      if (!parsed.success) return;
      const ev = parsed.data;
      if (ev.matchId !== matchId) return;

      setSchedulingEventCounter((c) => c + 1);
      setSchedulingState({
        status: ev.schedulingStatus,
        slot: ev.proposedSlot,
        meetingStatus: ev.meetingStatus,
        zoomLink: ev.zoomLink,
        student1Accepted: ev.student1Accepted,
        student2Accepted: ev.student2Accepted,
      });
      setScheduleError(null);
    };

    socket.on("study-group:updated", handleUpdatedEvent);
    return () => {
      socket.off("study-group:updated", handleUpdatedEvent);
    };
  }, [socket, matchId]);

  // 5. Propose schedule handler
  const handleProposeSchedule = async () => {
    if (!roomJoined || isSchedulingActionPending) return;

    const counterSnapshot = eventCounterRef.current;
    setIsSchedulingActionPending(true);
    setScheduleError(null);

    try {
      const res = await requestJson(
        `/api/study-groups/${matchId}/schedule`,
        proposeResponseSchema,
        {
          method: "POST",
          getAccessToken: getRuntimeAccessToken,
        }
      );

      if (res.schedulingStatus === "proposed" && !res.proposedSlot) {
        throw new Error("Server proposed a schedule without providing a time slot.");
      }

      if (counterSnapshot === eventCounterRef.current) {
        setSchedulingState((prev) => ({
          ...prev,
          status: res.schedulingStatus,
          slot: res.proposedSlot,
        }));
        // Reset local accepted slot if proposed slot changed
        setLocalAcceptedSlot(null);
      }
    } catch (err: unknown) {
      setScheduleError(
        err instanceof Error ? err.message : "Failed to find mutual study schedule."
      );
    } finally {
      setIsSchedulingActionPending(false);
    }
  };

  // 6. Accept schedule handler
  const handleAcceptSchedule = async (slotToAccept: TimeInterval) => {
    if (!roomJoined || isSchedulingActionPending) return;

    const counterSnapshot = eventCounterRef.current;
    setIsSchedulingActionPending(true);
    setScheduleError(null);

    try {
      const res = await requestJson(
        `/api/study-groups/${matchId}/schedule/accept`,
        acceptResponseSchema,
        {
          method: "POST",
          getAccessToken: getRuntimeAccessToken,
          body: {
            startsAt: slotToAccept.startsAt,
            endsAt: slotToAccept.endsAt,
          },
        }
      );

      setLocalAcceptedSlot(slotToAccept);

      if (counterSnapshot === eventCounterRef.current) {
        setSchedulingState((prev) => ({
          ...prev,
          status: res.schedulingStatus,
          zoomLink: res.zoomMeeting?.joinUrl ?? prev.zoomLink,
          meetingStatus: res.bothAccepted
            ? res.zoomMeeting
              ? "created"
              : prev.meetingStatus
            : prev.meetingStatus,
        }));
      }
    } catch (err: unknown) {
      setScheduleError(
        err instanceof Error ? err.message : "Failed to accept proposed schedule."
      );
    } finally {
      setIsSchedulingActionPending(false);
    }
  };

  const partnerLabel = peerName ?? "Study partner";
  const hasLocalAccepted =
    Boolean(localAcceptedSlot &&
    schedulingState.slot &&
    localAcceptedSlot.startsAt === schedulingState.slot.startsAt &&
    localAcceptedSlot.endsAt === schedulingState.slot.endsAt);

  const acceptedCount =
    (schedulingState.student1Accepted ? 1 : 0) +
    (schedulingState.student2Accepted ? 1 : 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="matched-peer-session">
      {/* LEFT COLUMN: Real-Time Private Chat */}
      <Card className="border-[#e6d8bd] bg-white shadow-xs flex flex-col h-[520px]">
        <CardHeader className="pb-3 border-b border-[#f2eadc]">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-[#2b2a2e]">
              Private Study Chat
            </CardTitle>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                roomJoined
                  ? "bg-[#dff1e5] text-[#1b5e3b] font-semibold"
                  : "bg-[#fbf2ef] text-[#8a2414]"
              }`}
              data-testid="chat-connection-status"
            >
              {roomJoined ? "Connected" : "Disconnected"}
            </span>
          </div>
          <p className="text-xs text-[#5f5b54]">
            Chatting with <span className="font-semibold text-[#2b2a2e]">{partnerLabel}</span>
          </p>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col justify-between p-4 overflow-hidden">
          {messageHistoryError && (
            <div className="mb-2">
              <FeatureErrorNotice
                message={messageHistoryError}
                onRetry={() => fetchMessages()}
              />
            </div>
          )}

          {/* Messages feed */}
          <div
            role="log"
            aria-live="polite"
            className="flex-1 overflow-y-auto space-y-3 pr-1 py-2 text-sm"
            data-testid="study-group-messages-log"
          >
            {isLoadingMessages && messages.length === 0 ? (
              <p className="text-xs text-[#5f5b54] italic">Loading message history...</p>
            ) : messages.length === 0 ? (
              <p className="text-xs text-[#5f5b54] italic">
                No messages yet. Say hello to your study partner!
              </p>
            ) : (
              messages.map((msg) => {
                const isYou = msg.senderId === studentId;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isYou ? "items-end" : "items-start"}`}
                  >
                    <span className="text-[11px] text-[#5f5b54] font-medium mb-0.5">
                      {isYou ? "You" : partnerLabel}
                    </span>
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                        isYou
                          ? "bg-[#ed793c] text-[#2b2a2e] font-medium"
                          : "bg-[#fbf5ec] border border-[#e6d8bd] text-[#2b2a2e]"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Composer */}
          <div className="pt-3 border-t border-[#f2eadc] space-y-2">
            {!roomJoined && (
              <p className="text-xs text-[#8a2414] font-medium" role="status">
                Real-time connection paused. Reconnecting to chat...
              </p>
            )}

            <div className="space-y-1">
              <label htmlFor="study-chat-input" className="sr-only">
                Message
              </label>
              <textarea
                id="study-chat-input"
                aria-label="Message"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={!roomJoined || isSendingMessage}
                placeholder={
                  roomJoined
                    ? `Message ${partnerLabel}...`
                    : "Connecting to study partner..."
                }
                className="w-full resize-none rounded-md border border-[#e6d8bd] p-2 text-sm text-[#2b2a2e] focus:outline-hidden focus:ring-2 focus:ring-[#ed793c]"
              />
            </div>

            <div className="flex items-center justify-between">
              {sendError ? (
                <p role="alert" className="text-xs text-[#8a2414]">
                  {sendError}
                </p>
              ) : (
                <span className="text-[11px] text-[#5f5b54]">
                  Press Enter to send, Shift+Enter for newline
                </span>
              )}

              <Button
                type="button"
                size="sm"
                onClick={handleSendMessage}
                disabled={!roomJoined || isSendingMessage || !draft.trim()}
                className="bg-[#ed793c] text-[#2b2a2e] hover:bg-[#db692b] font-medium"
              >
                {isSendingMessage ? "Sending..." : "Send message"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RIGHT COLUMN: Bilateral Scheduling & Zoom */}
      <Card className="border-[#e6d8bd] bg-white shadow-xs flex flex-col h-[520px]">
        <CardHeader className="pb-3 border-b border-[#f2eadc]">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-[#2b2a2e]">
              Meeting Scheduler
            </CardTitle>
            <span className="text-xs font-mono text-[#5f5b54] bg-[#fbf5ec] px-2 py-0.5 rounded border border-[#e6d8bd]">
              {timezone}
            </span>
          </div>
          <p className="text-xs text-[#5f5b54]">
            Compare availability and confirm a shared video study time.
          </p>
        </CardHeader>

        <CardContent className="flex-1 p-4 space-y-4 overflow-y-auto">
          {scheduleError && (
            <p role="alert" className="text-xs text-[#8a2414] font-medium p-2 bg-[#fbf2ef] rounded border border-[#e2a898]">
              {scheduleError}
            </p>
          )}

          {/* Proposal status & mutual slot */}
          {schedulingState.status === "no-overlap" && (
            <div className="p-4 rounded-lg bg-[#fbf2ef] border border-[#e2a898] text-[#8a2414] space-y-2">
              <p className="font-semibold text-sm">No Shared Time</p>
              <p className="text-xs">
                No shared time yet. Update availability and try again.
              </p>
            </div>
          )}

          {schedulingState.slot && (
            <div className="p-4 rounded-lg bg-[#fbf5ec] border border-[#e6d8bd] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#ed793c] uppercase tracking-wider">
                  Proposed Study Time
                </span>
                <span className="text-xs font-medium text-[#5f5b54]">
                  {acceptedCount} of 2 accepted
                </span>
              </div>
              <div className="text-sm font-semibold text-[#2b2a2e]">
                {formatSlotTime(schedulingState.slot.startsAt)} — {formatSlotTime(schedulingState.slot.endsAt)}
              </div>

              {/* Acceptance states */}
              {hasLocalAccepted && schedulingState.meetingStatus !== "created" && (
                <p className="text-xs text-[#2b7f55] font-medium" role="status">
                  ✓ You accepted. Waiting for your study partner to accept.
                </p>
              )}

              {!hasLocalAccepted && schedulingState.meetingStatus !== "created" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleAcceptSchedule(schedulingState.slot!)}
                  disabled={!roomJoined || isSchedulingActionPending}
                  className="bg-[#2b7f55] text-white hover:bg-[#226343]"
                >
                  {isSchedulingActionPending ? "Accepting..." : "Accept proposed time"}
                </Button>
              )}
            </div>
          )}

          {/* Meeting creation state */}
          {schedulingState.meetingStatus === "created" && (
            <div className="p-4 rounded-lg bg-[#dff1e5] border border-[#1b5e3b] text-[#1b5e3b] space-y-3">
              <div>
                <h5 className="font-bold text-sm">✨ Mutual Time Confirmed!</h5>
                <p className="text-xs mt-0.5">
                  Both study partners accepted. Join your scheduled Zoom session below:
                </p>
              </div>

              {schedulingState.zoomLink ? (
                isValidHttpsUrl(schedulingState.zoomLink) ? (
                  <a
                    href={schedulingState.zoomLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-[#2b7f55] text-white text-sm font-medium hover:bg-[#226343] transition-colors"
                  >
                    Join Zoom meeting ↗
                  </a>
                ) : (
                  <p role="alert" className="text-xs text-[#8a2414]">
                    Invalid meeting link provided by server.
                  </p>
                )
              ) : (
                <p className="text-xs italic">Meeting link will appear shortly.</p>
              )}
            </div>
          )}

          {schedulingState.meetingStatus === "unavailable" && (
            <div className="p-4 rounded-lg bg-[#fbf2ef] border border-[#e2a898] text-[#8a2414] space-y-1">
              <p className="font-semibold text-sm">Video Unavailable</p>
              <p className="text-xs">
                Video meeting service is currently unavailable. Chat remains active.
              </p>
            </div>
          )}

          {/* Action triggers */}
          <div className="pt-2 border-t border-[#f2eadc] flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleProposeSchedule}
              disabled={!roomJoined || isSchedulingActionPending}
              className="border-[#e6d8bd]"
            >
              {isSchedulingActionPending
                ? "Checking..."
                : schedulingState.slot
                ? "Recalculate mutual time"
                : "Find mutual time"}
            </Button>

            {hasLocalAccepted && schedulingState.slot && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAcceptSchedule(schedulingState.slot!)}
                disabled={!roomJoined || isSchedulingActionPending}
                className="border-[#e6d8bd]"
              >
                Refresh meeting status
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
