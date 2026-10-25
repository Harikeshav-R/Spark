// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import type { TimeInterval } from "@/contracts/classroom";
import StudentStudyGroupPage from "@/app/student/[studentId]/study-group/page";
import { StudyGroupWorkspace } from "@/features/student/study-group-workspace";
import { StudyGroupAvailability } from "@/features/student/study-group-availability";
import { MatchedPeerSession } from "@/features/student/matched-peer-session";
import { StudyGroupFeature } from "@/features/study-groups/study-group-feature";
import { setRuntimeSession } from "@/lib/client/session";
import type { LectureSocket } from "@/lib/client/socket";
const mockNotFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
}));

type EventHandler = (...args: unknown[]) => void;

class MockSocket {
  public handlers: Map<string, EventHandler[]> = new Map();
  public connected = false;
  public emittedEvents: { event: string; args: unknown[] }[] = [];

  public on(event: string, handler: EventHandler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  public off(event: string, handler: EventHandler): this {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      list.filter((h) => h !== handler)
    );
    return this;
  }

  public connect(): this {
    this.connected = true;
    this.trigger("connect");
    return this;
  }

  public disconnect(): this {
    this.connected = false;
    this.trigger("disconnect");
    return this;
  }

  public emit(event: string, ...args: unknown[]): this {
    this.emittedEvents.push({ event, args });
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      lastArg({ success: true });
    }
    return this;
  }

  public trigger(event: string, ...args: unknown[]): void {
    const list = this.handlers.get(event) ?? [];
    for (const h of list) {
      h(...args);
    }
  }
}

let activeMockSocket: MockSocket | null = null;
vi.mock("socket.io-client", () => ({
  io: () => {
    activeMockSocket = new MockSocket();
    return activeMockSocket;
  },
}));

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    el instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
describe("P6-D-01: Peer Study Group Route & Components", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mockFetch = vi.fn();

  const studentId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "22222222-2222-4222-8222-222222222222";
  const foreignCourseId: UUID = "33333333-3333-4333-8333-333333333333";
  const matchId: UUID = "44444444-4444-4444-8444-444444444444";
  const foreignMatchId: UUID = "55555555-5555-4555-8555-555555555555";
  const peerId: UUID = "66666666-6666-4666-8666-666666666666";
  const concept1Id: UUID = "c1111111-1111-4111-8111-111111111111";

  const testConcepts: ConceptNode[] = [
    {
      id: concept1Id,
      courseId,
      label: "Backpropagation",
      description: "Gradient computation algorithm",
      category: "optimization",
      difficulty: 3,
      createdAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = mockFetch;
    mockFetch.mockReset();
    mockNotFound.mockClear();
    setRuntimeSession({
      accessToken: "mock-auth-token-p6-d-01",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    activeMockSocket = null;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Server Route Parameter Validation & Breadcrumbs                        */
  /* -------------------------------------------------------------------------- */
  describe("1. Server Route Parameter Validation", () => {
    it("calls notFound() when studentId is malformed", async () => {
      await expect(
        StudentStudyGroupPage({
          params: Promise.resolve({ studentId: "malformed-id" }),
          searchParams: Promise.resolve({ courseId }),
        })
      ).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it("renders course-selection guidance without collaboration children when courseId is missing", async () => {
      const page = await StudentStudyGroupPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({}),
      });

      const html = renderToString(page);
      expect(html).toContain("Peer study group");
      expect(html).toContain("Select a Course");
      expect(html).toContain(`/student/${studentId}`);
      expect(html).not.toContain("Study Availability");
      expect(html).not.toContain("study-group-feature");
    });

    it("renders invalid course parameter alert when courseId is malformed", async () => {
      const page = await StudentStudyGroupPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({ courseId: "not-a-valid-uuid" }),
      });

      const html = renderToString(page);
      expect(html).toContain("Invalid Course Parameter");
      expect(html).toContain("The course identifier provided is invalid or malformed.");
      expect(html).not.toContain("Study Availability");
    });

    it("renders invalid course parameter alert when courseId is repeated array", async () => {
      const page = await StudentStudyGroupPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({ courseId: [courseId, foreignCourseId] }),
      });

      const html = renderToString(page);
      expect(html).toContain("Invalid Course Parameter");
      expect(html).not.toContain("Study Availability");
    });

    it("renders AppShell and mounts workspace when valid studentId and courseId provided", async () => {
      const page = await StudentStudyGroupPage({
        params: Promise.resolve({ studentId }),
        searchParams: Promise.resolve({ courseId }),
      });

      const html = renderToString(page);
      expect(html).toContain("Peer study group");
      expect(html).toContain("Home");
      expect(html).toContain("Student workspace");
      expect(html).toContain(`/student/${studentId}?courseId=${courseId}`);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Workspace Authorization & Enrollment Boundary                          */
  /* -------------------------------------------------------------------------- */
  describe("2. Workspace Authorization & Enrollment Boundary", () => {
    it("renders SignInPrompt when /api/auth/me returns 401 unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: "UNAUTHORIZED", message: "Session expired" },
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(StudyGroupWorkspace, { studentId, courseId })
        );
      });

      expect(container.querySelector('[data-testid="study-group-unauthorized"]')).not.toBeNull();
      expect(container.textContent).toContain("Sign in");
    });

    it("renders Access Forbidden alert when student is not enrolled in the course", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          role: "student",
          enrollments: [
            { studentId, courseId: foreignCourseId },
          ],
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(StudyGroupWorkspace, { studentId, courseId })
        );
      });

      expect(container.querySelector('[data-testid="study-group-forbidden"]')).not.toBeNull();
      expect(container.textContent).toContain("Access Forbidden");
      expect(container.textContent).toContain("You do not have an active student enrollment");
    });

    it("renders Access Forbidden alert when role is teacher", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          role: "teacher",
          enrollments: [{ studentId, courseId }],
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(StudyGroupWorkspace, { studentId, courseId })
        );
      });

      expect(container.querySelector('[data-testid="study-group-forbidden"]')).not.toBeNull();
    });

    it("mounts availability and study group feature when student is authorized and enrolled", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/api/auth/me")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              role: "student",
              enrollments: [{ studentId, courseId }],
            }),
          };
        }
        if (urlStr.includes("/availability")) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          };
        }
        if (urlStr.includes("/graph")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ nodes: testConcepts, edges: [] }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      });

      await act(async () => {
        root.render(
          React.createElement(StudyGroupWorkspace, { studentId, courseId })
        );
      });

      expect(container.querySelector('[data-testid="study-group-workspace-content"]')).not.toBeNull();
      expect(container.textContent).toContain("Study Availability");
      expect(container.textContent).toContain("Peer Study Group Lobby");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. StudyGroupAvailability Boundary Rules                                 */
  /* -------------------------------------------------------------------------- */
  describe("3. StudyGroupAvailability Boundary Rules", () => {
    it("rejects saving an availability interval under 30 minutes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await act(async () => {
        root.render(React.createElement(StudyGroupAvailability, { courseId }));
      });

      // Initially one blank slot
      const fromInput = container.querySelector<HTMLInputElement>('input[aria-label="Available from"]');
      const untilInput = container.querySelector<HTMLInputElement>('input[aria-label="Available until"]');
      expect(fromInput).not.toBeNull();
      expect(untilInput).not.toBeNull();

      // Set 29-minute interval: 14:00 to 14:29
      await act(async () => {
        if (fromInput) {
          setInputValue(fromInput, "2026-11-01T14:00");
        }
        if (untilInput) {
          setInputValue(untilInput, "2026-11-01T14:29");
        }
      });

      const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Save Availability")
      );
      expect(saveBtn).toBeDefined();

      await act(async () => {
        saveBtn?.click();
      });

      // Verification: rejects with duration error and did NOT call PUT
      expect(container.textContent).toContain("at least 30 minutes");
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only initial GET
    });

    it("converts local 30-minute interval to UTC ISO and saves successfully", async () => {
      const savedInterval: TimeInterval = {
        startsAt: "2026-11-01T14:00:00.000Z",
        endsAt: "2026-11-01T15:00:00.000Z",
      };

      mockFetch.mockImplementation(async (_url: string | URL | Request, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          };
        }
        if (method === "PUT") {
          return {
            ok: true,
            status: 200,
            json: async () => [savedInterval],
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      });

      await act(async () => {
        root.render(React.createElement(StudyGroupAvailability, { courseId }));
      });

      const fromInput = container.querySelector<HTMLInputElement>('input[aria-label="Available from"]');
      const untilInput = container.querySelector<HTMLInputElement>('input[aria-label="Available until"]');

      await act(async () => {
        if (fromInput) {
          setInputValue(fromInput, "2026-11-01T14:00");
        }
        if (untilInput) {
          setInputValue(untilInput, "2026-11-01T15:00");
        }
      });

      const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Save Availability")
      );

      await act(async () => {
        saveBtn?.click();
      });

      expect(container.textContent).toContain("Availability saved successfully.");
      expect(mockFetch).toHaveBeenCalledTimes(2); // Initial GET + PUT
    });

    it("blocks saving when initial load fails to prevent clearing unknown intervals", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Database error" }),
      });

      await act(async () => {
        root.render(React.createElement(StudyGroupAvailability, { courseId }));
      });

      expect(container.textContent).toContain("Failed to load study group availability");
      const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Save Availability")
      );
      // Save button is disabled on load error
      expect(saveBtn?.disabled).toBe(true);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. MatchedPeerSession Chat Invariants                                     */
  /* -------------------------------------------------------------------------- */
  describe("4. MatchedPeerSession Chat Invariants", () => {
    it("deduplicates socket message events and history fetches without dropping messages", async () => {
      const msg1 = {
        id: "11111111-1111-4111-8111-111111111101",
        senderId: peerId,
        content: "Hello from peer!",
        createdAt: "2026-11-01T14:01:00.000Z",
      };

      const msg2 = {
        id: "11111111-1111-4111-8111-111111111102",
        senderId: studentId,
        content: "Glad to connect!",
        createdAt: "2026-11-01T14:02:00.000Z",
      };

      // Mock messages history returning msg1
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes(`/api/study-groups/${matchId}/messages`)) {
          return {
            ok: true,
            status: 200,
            json: async () => [msg1],
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const socketDouble = new MockSocket();
      socketDouble.connect();

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: socketDouble as unknown as LectureSocket,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      // msg1 from history rendered
      expect(container.textContent).toContain("Hello from peer!");

      // Socket receives live event msg2
      await act(async () => {
        socketDouble.trigger("study-group:message", {
          eventId: "e1111111-1111-4111-8111-111111111111",
          occurredAt: msg2.createdAt,
          messageId: msg2.id,
          matchId,
          senderId: msg2.senderId,
          content: msg2.content,
        });
      });

      expect(container.textContent).toContain("Glad to connect!");

      // Socket receives duplicate msg1 event - must not duplicate
      await act(async () => {
        socketDouble.trigger("study-group:message", {
          eventId: "e2222222-2222-4222-8222-222222222222",
          occurredAt: msg1.createdAt,
          messageId: msg1.id,
          matchId,
          senderId: msg1.senderId,
          content: msg1.content,
        });
      });

      const allPeerMessages = Array.from(container.querySelectorAll("div")).filter((d) =>
        d.textContent === "Hello from peer!"
      );
      expect(allPeerMessages.length).toBe(1);
    });

    it("renders HTML-like text content safely without raw HTML injection", async () => {
      const maliciousContent = '<script>alert("xss")</script><b>Bold Text</b>';
      mockFetch.mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "11111111-1111-4111-8111-111111111103",
            senderId: peerId,
            content: maliciousContent,
            createdAt: "2026-11-01T14:03:00.000Z",
          },
        ],
      }));

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: null,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      // Must be rendered as literal text, not HTML elements
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("b")).toBeNull();
      expect(container.textContent).toContain(maliciousContent);
    });

    it("retains draft on send failure without dropping user edits", async () => {
      mockFetch.mockImplementation(async (_url: string | URL | Request, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (method === "POST") {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "Database offline" }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: null,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      expect(textarea).not.toBeNull();

      await act(async () => {
        if (textarea) {
          setInputValue(textarea, "Draft to send");
        }
      });

      const sendBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Send message")
      );

      await act(async () => {
        sendBtn?.click();
      });

      // Verification: draft retained and error displayed
      expect(textarea?.value).toBe("Draft to send");
      expect(container.textContent).toContain("Failed to send message");
    });

    it("discards message events from other match IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const socketDouble = new MockSocket();
      socketDouble.connect();

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: socketDouble as unknown as LectureSocket,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      await act(async () => {
        socketDouble.trigger("study-group:message", {
          eventId: "e9999999-9999-4999-8999-999999999999",
          occurredAt: "2026-11-01T14:10:00.000Z",
          messageId: "99999999-9999-4999-8999-999999999999",
          matchId: foreignMatchId,
          senderId: peerId,
          content: "Foreign match message",
        });
      });

      expect(container.textContent).not.toContain("Foreign match message");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Bilateral Scheduling & Zoom Security Invariants                        */
  /* -------------------------------------------------------------------------- */
  describe("5. Bilateral Scheduling & Zoom Security Invariants", () => {
    it("handles no-overlap proposal gracefully while chat stays active", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (urlStr.includes("/schedule")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              schedulingStatus: "no-overlap",
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: null,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      const findTimeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Find mutual time")
      );
      expect(findTimeBtn).toBeDefined();

      await act(async () => {
        findTimeBtn?.click();
      });

      expect(container.textContent).toContain("No shared time yet. Update availability and try again.");
      // Chat composer is still available
      expect(container.querySelector('textarea[aria-label="Message"]')).not.toBeNull();
    });

    it("displays waiting status after one acceptance and shows HTTPS Zoom join link only when created", async () => {
      const slot: TimeInterval = {
        startsAt: "2026-11-01T15:00:00.000Z",
        endsAt: "2026-11-01T16:00:00.000Z",
      };

      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (urlStr.includes("/schedule/accept")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              schedulingStatus: "accepted",
              bothAccepted: false,
            }),
          };
        }
        if (urlStr.includes("/schedule")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              schedulingStatus: "proposed",
              proposedSlot: slot,
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const socketDouble = new MockSocket();
      socketDouble.connect();

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: socketDouble as unknown as LectureSocket,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      // Find mutual time
      const findTimeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Find mutual time")
      );
      await act(async () => {
        findTimeBtn?.click();
      });

      expect(container.textContent).toContain("Proposed Study Time");

      // Click Accept proposed time
      const acceptBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Accept proposed time")
      );
      expect(acceptBtn).toBeDefined();

      await act(async () => {
        acceptBtn?.click();
      });

      // Shows waiting for partner, no Zoom link yet
      expect(container.textContent).toContain("Waiting for your study partner to accept.");
      expect(container.querySelector("a")).toBeNull();

      // Second partner accepts via realtime event: created meeting with valid HTTPS URL
      await act(async () => {
        socketDouble.trigger("study-group:updated", {
          eventId: "e3333333-3333-4333-8333-333333333333",
          occurredAt: new Date().toISOString(),
          matchId,
          schedulingStatus: "accepted",
          proposedSlot: slot,
          student1Accepted: true,
          student2Accepted: true,
          meetingStatus: "created",
          zoomLink: "https://zoom.us/j/1234567890",
        });
      });

      // Zoom join link is visible
      const zoomLink = container.querySelector<HTMLAnchorElement>('a[href="https://zoom.us/j/1234567890"]');
      expect(zoomLink).not.toBeNull();
      expect(zoomLink?.target).toBe("_blank");
      expect(zoomLink?.rel).toContain("noopener");
      expect(zoomLink?.textContent).toContain("Join Zoom meeting");
    });

    it("rejects unsafe non-HTTPS meeting links and warns user", async () => {
      const socketDouble = new MockSocket();
      socketDouble.connect();

      mockFetch.mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => [],
      }));

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: socketDouble as unknown as LectureSocket,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      // Receive event with javascript: scheme
      await act(async () => {
        socketDouble.trigger("study-group:updated", {
          eventId: "e4444444-4444-4444-8444-444444444444",
          occurredAt: new Date().toISOString(),
          matchId,
          schedulingStatus: "accepted",
          student1Accepted: true,
          student2Accepted: true,
          meetingStatus: "created",
          zoomLink: "javascript:alert(1)",
        });
      });

      // No anchor with javascript: scheme
      expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(container.textContent).toContain("Invalid meeting link provided by server.");
    });

    it("displays honest unavailable notice when video meeting service is unavailable", async () => {
      const socketDouble = new MockSocket();
      socketDouble.connect();

      mockFetch.mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => [],
      }));

      await act(async () => {
        root.render(
          React.createElement(MatchedPeerSession, {
            matchId,
            peerName: "Alice",
            socket: socketDouble as unknown as LectureSocket,
            roomJoined: true,
            roomRevision: 1,
            studentId,
            courseId,
          })
        );
      });

      await act(async () => {
        socketDouble.trigger("study-group:updated", {
          eventId: "e5555555-5555-4555-8555-555555555555",
          occurredAt: new Date().toISOString(),
          matchId,
          schedulingStatus: "accepted",
          student1Accepted: true,
          student2Accepted: true,
          meetingStatus: "unavailable",
        });
      });

      expect(container.textContent).toContain("Video meeting service is currently unavailable. Chat remains active.");
      // Chat composer is still available
      expect(container.querySelector('textarea[aria-label="Message"]')).not.toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. Integration: StudyGroupFeature with Matched Composition & Party Quests */
  /* -------------------------------------------------------------------------- */
  describe("6. Integration: StudyGroupFeature Composition with Party Quests", () => {
    it("renders matched session slot alongside existing PartyQuestPanel", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/study-groups/opt-in")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "matched",
              matchId,
              expiresAt: new Date(Date.now() + 300000).toISOString(),
              peerName: "Alice",
              courseId,
              conceptIds: [concept1Id],
            }),
          };
        }
        if (urlStr.includes("/party-quests")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              quests: [
                {
                  partyQuestId: "pq111111-1111-4111-8111-111111111111",
                  conceptIds: [concept1Id],
                  student1Id: studentId,
                  student2Id: peerId,
                  student1Completed: true,
                  student2Completed: false,
                  courseId,
                  completedAt: null,
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
          };
        }
        if (urlStr.includes("/messages")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      await act(async () => {
        root.render(
          React.createElement(StudyGroupFeature, {
            studentId,
            courseId,
            initialConcepts: testConcepts,
            renderMatchedSession: (ctx) =>
              React.createElement(MatchedPeerSession, {
                ...ctx,
                studentId,
                courseId,
              }),
          })
        );
      });

      // Select concept and opt in
      const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      await act(async () => {
        checkbox?.click();
      });

      const joinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Join Study Pool")
      );
      await act(async () => {
        joinBtn?.click();
      });

      // Assert that matched session AND PartyQuestPanel are rendered together
      expect(container.querySelector('[data-testid="matched-peer-session"]')).not.toBeNull();
      expect(container.textContent).toContain("Private Study Chat");
      expect(container.textContent).toContain("Party Quests");
      expect(container.textContent).toContain("Meeting Scheduler");
    });
  });
});
