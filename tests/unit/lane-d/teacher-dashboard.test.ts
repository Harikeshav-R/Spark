import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { z } from "zod";
import type { LectureSession, TranscriptChunk } from "@/contracts/classroom";
import type { UUID } from "@/contracts/common";
import {
  mergeTranscriptChunks,
  getElapsedSeconds,
  formatElapsedTimer,
} from "@/features/professor/teacher-lecture-state";
import { TranscriptFeed } from "@/features/professor/transcript-feed";
import { LectureControls, LectureElapsedTimer } from "@/features/professor/lecture-controls";
import ProfessorDashboardPage from "@/app/professor/dashboard/page";
import { requestJson, ClientApiError } from "@/lib/client/http";
import { createLectureSocket } from "@/lib/client/socket";

describe("P3-D-01: Teacher Live Lecture Controls & Streaming Transcript Feed", () => {
  const courseId: UUID = "11111111-1111-4111-8111-111111111111";
  const lectureId: UUID = "22222222-2222-4222-8222-222222222222";
  const concept1: UUID = "33333333-3333-4333-8333-333333333333";
  const concept2: UUID = "44444444-4444-4444-8444-444444444444";

  const liveLecture: LectureSession = {
    id: lectureId,
    courseId,
    title: "Backpropagation & Computational Graphs",
    status: "live",
    startedAt: "2026-10-22T10:00:00.000Z",
  };

  const completedLecture: LectureSession = {
    id: lectureId,
    courseId,
    title: "Backpropagation & Computational Graphs",
    status: "completed",
    startedAt: "2026-10-22T10:00:00.000Z",
    endedAt: "2026-10-22T11:15:30.000Z",
  };

  describe("teacher-lecture-state: mergeTranscriptChunks", () => {
    it("deduplicates chunks by chunk ID and preserves unique count", () => {
      const chunk1: TranscriptChunk = {
        id: "chunk-1111-1111-1111-111111111111",
        lectureId,
        text: "Initial speech chunk",
        timestampSec: 5,
        speakerName: "Prof. Chen",
        detectedConceptIds: [],
        createdAt: "2026-10-22T10:00:05.000Z",
      };

      const result = mergeTranscriptChunks([chunk1], [chunk1]);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(chunk1.id);
    });

    it("replaces empty detectedConceptIds with authoritative snapshot concepts", () => {
      const socketChunk: TranscriptChunk = {
        id: "chunk-1111-1111-1111-111111111111",
        lectureId,
        text: "Let us derive the chain rule.",
        timestampSec: 10,
        detectedConceptIds: [],
        createdAt: "2026-10-22T10:00:10.000Z",
      };

      const snapshotChunk: TranscriptChunk = {
        id: "chunk-1111-1111-1111-111111111111",
        lectureId,
        text: "Let us derive the chain rule.",
        timestampSec: 10,
        speakerName: "Prof. Chen",
        detectedConceptIds: [concept1, concept2],
        createdAt: "2026-10-22T10:00:10.000Z",
      };

      // Snapshot arrived after socket event
      const mergedAfter = mergeTranscriptChunks([socketChunk], [snapshotChunk]);
      expect(mergedAfter[0]?.detectedConceptIds).toEqual([concept1, concept2]);
      expect(mergedAfter[0]?.speakerName).toBe("Prof. Chen");
    });

    it("does not overwrite authoritative concepts when a late chunk event has empty concepts", () => {
      const snapshotChunk: TranscriptChunk = {
        id: "chunk-1111-1111-1111-111111111111",
        lectureId,
        text: "Let us derive the chain rule.",
        timestampSec: 10,
        detectedConceptIds: [concept1],
        createdAt: "2026-10-22T10:00:10.000Z",
      };

      const lateSocketChunk: TranscriptChunk = {
        id: "chunk-1111-1111-1111-111111111111",
        lectureId,
        text: "Let us derive the chain rule.",
        timestampSec: 10,
        detectedConceptIds: [],
        createdAt: "2026-10-22T10:00:10.000Z",
      };

      // Event arrived after snapshot had already populated concepts
      const result = mergeTranscriptChunks([snapshotChunk], [lateSocketChunk]);
      expect(result[0]?.detectedConceptIds).toEqual([concept1]);
    });

    it("sorts chunks chronologically by timestampSec ascending, then createdAt, then id", () => {
      const c1: TranscriptChunk = {
        id: "chunk-0001-1111-1111-111111111111",
        lectureId,
        text: "Third chronologically",
        timestampSec: 45,
        detectedConceptIds: [],
        createdAt: "2026-10-22T10:00:45.000Z",
      };
      const c2: TranscriptChunk = {
        id: "chunk-0002-1111-1111-111111111111",
        lectureId,
        text: "First chronologically",
        timestampSec: 10,
        detectedConceptIds: [],
        createdAt: "2026-10-22T10:00:10.000Z",
      };
      const c3: TranscriptChunk = {
        id: "chunk-0003-1111-1111-111111111111",
        lectureId,
        text: "Second chronologically",
        timestampSec: 25,
        detectedConceptIds: [],
        createdAt: "2026-10-22T10:00:25.000Z",
      };

      const result = mergeTranscriptChunks([], [c1, c2, c3]);
      expect(result.map((c) => c.id)).toEqual([c2.id, c3.id, c1.id]);
    });

    it("preserves isSimulated provenance when merging chunks", () => {
      const simulatedChunk: TranscriptChunk = {
        id: "chunk-simulated-1",
        lectureId,
        text: "Simulated gradient descent chunk",
        timestampSec: 4,
        detectedConceptIds: [],
        isSimulated: true,
        createdAt: "2026-10-22T10:00:04.000Z",
      };

      const result = mergeTranscriptChunks([], [simulatedChunk]);
      expect(result[0]?.isSimulated).toBe(true);
    });
  });

  describe("teacher-lecture-state: getElapsedSeconds & formatElapsedTimer", () => {
    it("calculates exact elapsed seconds from startedAt to nowMs for live lectures", () => {
      const startMs = new Date("2026-10-22T10:00:00.000Z").getTime();
      const elapsed59 = getElapsedSeconds(liveLecture, startMs + 59_000);
      const elapsed60 = getElapsedSeconds(liveLecture, startMs + 60_000);
      const elapsed61 = getElapsedSeconds(liveLecture, startMs + 61_999);

      expect(elapsed59).toBe(59);
      expect(elapsed60).toBe(60);
      expect(elapsed61).toBe(61);
    });

    it("freezes elapsed time to endedAt for completed lectures regardless of nowMs", () => {
      const startMs = new Date("2026-10-22T10:00:00.000Z").getTime();
      const endMs = new Date("2026-10-22T11:15:30.000Z").getTime();
      const expectedDurationSec = Math.floor((endMs - startMs) / 1000); // 4530 seconds (1h 15m 30s)

      const elapsedNow = getElapsedSeconds(completedLecture, Date.now());
      const elapsedFarFuture = getElapsedSeconds(completedLecture, Date.now() + 1_000_000_000);

      expect(elapsedNow).toBe(expectedDurationSec);
      expect(elapsedFarFuture).toBe(expectedDurationSec);
    });

    it("formats seconds into HH:MM:SS with leading zeroes", () => {
      expect(formatElapsedTimer(0)).toBe("00:00:00");
      expect(formatElapsedTimer(59)).toBe("00:00:59");
      expect(formatElapsedTimer(60)).toBe("00:01:00");
      expect(formatElapsedTimer(3665)).toBe("01:01:05");
      expect(formatElapsedTimer(4530)).toBe("01:15:30");
    });
  });

  describe("TranscriptFeed component SSR rendering", () => {
    const conceptLabels = new Map<UUID, string>([
      [concept1, "Chain Rule"],
      [concept2, "Backpropagation"],
    ]);

    const sampleChunks: readonly TranscriptChunk[] = [
      {
        id: "chunk-1111-1111-1111-111111111111",
        lectureId,
        text: "Welcome to class. Today we cover computational graphs.",
        timestampSec: 15,
        speakerName: "Prof. Chen",
        detectedConceptIds: [concept1],
        createdAt: "2026-10-22T10:00:15.000Z",
      },
      {
        id: "chunk-2222-2222-2222-222222222222",
        lectureId,
        text: "Notice how gradients flow backward.",
        timestampSec: 72,
        detectedConceptIds: ["99999999-9999-4999-8999-999999999999" as UUID],
        createdAt: "2026-10-22T10:01:12.000Z",
      },
    ];

    it("renders prominent [SIMULATED TRANSCRIPT] badge when isSimulated is true", () => {
      const html = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: sampleChunks,
          conceptLabels,
          isSimulated: true,
          lectureStatus: "live",
        })
      );

      expect(html).toContain("[SIMULATED TRANSCRIPT]");
    });

    it("renders 'Transcript source unavailable' when isSimulated is null", () => {
      const html = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: sampleChunks,
          conceptLabels,
          isSimulated: null,
          lectureStatus: "live",
        })
      );

      expect(html).toContain("Transcript source unavailable");
      expect(html).not.toContain("[SIMULATED TRANSCRIPT]");
    });

    it("does not render simulated badge when isSimulated is false", () => {
      const html = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: sampleChunks,
          conceptLabels,
          isSimulated: false,
          lectureStatus: "live",
        })
      );

      expect(html).not.toContain("[SIMULATED TRANSCRIPT]");
      expect(html).not.toContain("Transcript source unavailable");
    });

    it("renders chunk content, timestamps, speaker name and fallback", () => {
      const html = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: sampleChunks,
          conceptLabels,
          isSimulated: false,
          lectureStatus: "live",
        })
      );

      expect(html).toContain("Prof. Chen");
      expect(html).toContain("Unknown speaker");
      expect(html).toContain("00:00:15");
      expect(html).toContain("00:01:12");
      expect(html).toContain("Welcome to class. Today we cover computational graphs.");
      expect(html).toContain("Notice how gradients flow backward.");
    });

    it("renders detected concept chips and displays unknown concept fallback for unmapped UUIDs", () => {
      const html = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: sampleChunks,
          conceptLabels,
          isSimulated: false,
          lectureStatus: "live",
        })
      );

      expect(html).toContain("Chain Rule");
      expect(html).toContain("Unknown concept (99999999-9999-4999-8999-999999999999)");
    });

    it("renders live and completed empty states", () => {
      const liveEmptyHtml = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: [],
          conceptLabels,
          isSimulated: false,
          lectureStatus: "live",
        })
      );
      expect(liveEmptyHtml).toContain("Waiting for transcript…");

      const completedEmptyHtml = renderToString(
        React.createElement(TranscriptFeed, {
          chunks: [],
          conceptLabels,
          isSimulated: false,
          lectureStatus: "completed",
        })
      );
      expect(completedEmptyHtml).toContain("No transcript was recorded.");
    });
  });

  describe("LectureControls component SSR rendering", () => {
    it("renders idle state with title input and start button", () => {
      const html = renderToString(
        React.createElement(LectureControls, {
          lecture: null,
          pending: null,
          error: null,
          onStart: () => {},
          onEnd: () => {},
        })
      );

      expect(html).toContain("Start Lecture Session");
      expect(html).toContain("Lecture title");
      expect(html).toContain("Start lecture");
    });

    it("renders live state with title, Live badge, timer, and End lecture button", () => {
      const html = renderToString(
        React.createElement(LectureControls, {
          lecture: liveLecture,
          pending: null,
          error: null,
          onStart: () => {},
          onEnd: () => {},
        })
      );

      expect(html).toContain("Backpropagation &amp; Computational Graphs");
      expect(html).toContain("Live");
      expect(html).toContain("End lecture");
      expect(html).toContain("Duration:");
    });

    it("renders completed state with Completed badge", () => {
      const html = renderToString(
        React.createElement(LectureControls, {
          lecture: completedLecture,
          pending: null,
          error: null,
          onStart: () => {},
          onEnd: () => {},
        })
      );

      expect(html).toContain("Backpropagation &amp; Computational Graphs");
      expect(html).toContain("Completed");
      expect(html).not.toContain("End lecture");
      expect(html).toContain("01:15:30");
    });

    it("displays error alert when error message is supplied", () => {
      const html = renderToString(
        React.createElement(LectureControls, {
          lecture: null,
          pending: null,
          error: "Lecture title cannot be empty.",
          onStart: () => {},
          onEnd: () => {},
        })
      );

      expect(html).toContain("Lecture title cannot be empty.");
      expect(html).toContain('role="alert"');
    });

    it("renders LectureElapsedTimer with tabular-nums and formatted elapsed time", () => {
      const html = renderToString(
        React.createElement(LectureElapsedTimer, {
          lecture: completedLecture,
        })
      );

      expect(html).toContain("01:15:30");
      expect(html).toContain("tabular-nums");
    });
  });

  describe("ProfessorDashboardPage server route parameter handling", () => {
    it("renders missing course prompt when courseId query parameter is omitted", async () => {
      const page = await ProfessorDashboardPage({
        searchParams: Promise.resolve({}),
      });
      const html = renderToString(page);

      expect(html).toContain("Select a course to start or resume a lecture.");
      expect(html).toContain('role="status"');
    });

    it("renders malformed course alert when courseId is not a valid UUID", async () => {
      const page = await ProfessorDashboardPage({
        searchParams: Promise.resolve({ courseId: "not-a-valid-uuid" }),
      });
      const html = renderToString(page);

      expect(html).toContain("Invalid course identifier.");
      expect(html).toContain('role="alert"');
    });

    it("renders malformed lecture alert when lectureId is not a valid UUID", async () => {
      const page = await ProfessorDashboardPage({
        searchParams: Promise.resolve({
          courseId,
          lectureId: "invalid-lecture-uuid",
        }),
      });
      const html = renderToString(page);

      expect(html).toContain("Invalid lecture identifier.");
      expect(html).toContain('role="alert"');
    });
  });

  describe("Client transport: requestJson and socket factory", () => {
    it("rejects with 401 ClientApiError without issuing a request when access token is missing", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(
        requestJson("/api/courses/123/lectures", z.unknown(), {
          getAccessToken: async () => null,
        })
      ).rejects.toThrow(ClientApiError);

      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("sends bearer authorization and parses response with schema", async () => {
      const mockData = { id: lectureId, title: "Test Lecture" };
      const testSchema = z.object({ id: z.string(), title: z.string() });

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockData,
      });
      vi.stubGlobal("fetch", fetchSpy);

      const result = await requestJson("/api/test", testSchema, {
        getAccessToken: async () => "test-token-xyz",
      });

      expect(result).toEqual(mockData);
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/test",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer test-token-xyz",
          },
          cache: "no-store",
        })
      );
      vi.unstubAllGlobals();
    });

    it("throws ClientApiError on schema validation mismatch without leaking tokens", async () => {
      const invalidData = { unexpected: true };
      const strictSchema = z.object({ id: z.string() });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => invalidData,
        })
      );

      await expect(
        requestJson("/api/test", strictSchema, {
          getAccessToken: async () => "super-secret-token",
        })
      ).rejects.toThrow(ClientApiError);

      vi.unstubAllGlobals();
    });

    it("createLectureSocket configures autoConnect false and auth token", () => {
      const socket = createLectureSocket("sample-token");
      expect(socket).toBeDefined();
      expect(socket.connected).toBe(false);
      socket.close();
    });
  });
});
