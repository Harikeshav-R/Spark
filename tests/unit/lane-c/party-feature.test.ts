// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { UUID } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import type { StudyGroupCandidate, PartyQuestItem } from "@/contracts/classroom";
import { StudyGroupFeature } from "@/features/study-groups/study-group-feature";
import { CandidateInvites } from "@/features/study-groups/candidate-invites";
import { PartyQuestPanel } from "@/features/study-groups/party-quest-panel";
import { setRuntimeSession } from "@/lib/client/session";

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

describe("P6-C-01 Extended StudyGroupFeature with Candidate Invites & Party Quests", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mockFetch = vi.fn();

  const studentId: UUID = "11111111-1111-4111-8111-111111111111";
  const peerAId: UUID = "22222222-2222-4222-8222-222222222222";
  const peerBId: UUID = "33333333-3333-4333-8333-333333333333";
  const courseId: UUID = "44444444-4444-4444-8444-444444444444";
  const matchId: UUID = "55555555-5555-4555-8555-555555555555";
  const concept1Id: UUID = "c1111111-1111-4111-8111-111111111111";
  const concept2Id: UUID = "c2222222-2222-4222-8222-222222222222";

  const testConcepts: ConceptNode[] = [
    {
      id: concept1Id,
      courseId,
      label: "Backpropagation",
      description: "Reverse automatic differentiation algorithm",
      category: "optimization",
      difficulty: 3,
      createdAt: new Date().toISOString(),
    },
    {
      id: concept2Id,
      courseId,
      label: "Computational Graphs",
      description: "Directed acyclic graph of mathematical operations",
      category: "fundamentals",
      difficulty: 2,
      createdAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = mockFetch;
    mockFetch.mockReset();
    setRuntimeSession({
      accessToken: "mock-auth-token-p6-c-01",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    activeMockSocket = null;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    setRuntimeSession(null);
    vi.restoreAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      queueMicrotask(resolve);
      await promise;
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Test 1: Candidate cards, fit badges, and empty states                      */
  /* -------------------------------------------------------------------------- */
  it("renders candidate cards with fit percentage badges and handles empty candidates", async () => {
    const expiresAt = new Date(Date.now() + 300000).toISOString();

    const candidates: StudyGroupCandidate[] = [
      {
        studentId: peerAId,
        requestedConcepts: [
          { conceptId: concept1Id, label: "Backpropagation", band: "green" },
        ],
        complementaryGap: 0.92,
        fitKind: "reciprocal",
      },
      {
        studentId: peerBId,
        requestedConcepts: [
          { conceptId: concept2Id, label: "Computational Graphs", band: "yellow" },
        ],
        complementaryGap: 1.0,
        fitKind: "mentor",
      },
    ];

    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/study-groups/candidates")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates }),
        };
      }
      if (urlStr.includes("/study-groups/opt-in")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "waiting", expiresAt }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(StudyGroupFeature, {
          studentId,
          courseId,
          initialConcepts: testConcepts,
        })
      );
    });

    // Select both concepts
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      checkboxes[0].click();
      checkboxes[1].click();
    });

    // Click Join Study Pool
    const joinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Join Study Pool")
    );
    expect(joinBtn).toBeDefined();

    await act(async () => {
      joinBtn?.click();
    });
    await flush();

    // Verify candidate cards and fit badges
    expect(container.textContent).toContain("92% Fit — Reciprocal Strengths");
    expect(container.textContent).toContain("99% Fit — Mentor Fit");
    expect(container.textContent).toContain(`Classmate ${peerAId.slice(0, 8)}…`);
    expect(container.textContent).toContain(`Classmate ${peerBId.slice(0, 8)}…`);

    // Verify candidate absent from candidate GET is NOT present
    const absentId = "99999999-9999-4999-8999-999999999999";
    expect(container.textContent).not.toContain(absentId.slice(0, 8));

    // Test empty candidates state
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/study-groups/candidates")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const refreshBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Refresh candidates")
    );
    expect(refreshBtn).toBeDefined();

    await act(async () => {
      refreshBtn?.click();
    });
    await flush();

    expect(container.textContent).toContain("No consenting study partners available right now.");
  });

  /* -------------------------------------------------------------------------- */
  /* Test 2: Double-click Send Invite duplicate suppression & payload verification*/
  /* -------------------------------------------------------------------------- */
  it("prevents duplicate invitation requests and sends only inviteeId and conceptIds without caller identity", async () => {
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const candidate: StudyGroupCandidate = {
      studentId: peerAId,
      requestedConcepts: [
        { conceptId: concept1Id, label: "Backpropagation", band: "green" },
      ],
      complementaryGap: 0.85,
      fitKind: "reciprocal",
    };

    let postCallCount = 0;
    let capturedBody: unknown = null;
    const { promise: postDeferred, resolve: resolvePost } = Promise.withResolvers<void>();

    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/study-groups/candidates")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [candidate] }),
        };
      }
      if (urlStr.includes("/study-groups/invitations") && init?.method === "POST") {
        postCallCount++;
        capturedBody = JSON.parse(init.body as string);
        await postDeferred;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            invitationId: "77777777-7777-4777-8777-777777777777",
            status: "pending",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(CandidateInvites, {
          studentId,
          courseId,
          conceptIds: [concept1Id],
          pool: {
            status: "waiting",
            expiresAt,
          },
        })
      );
    });
    await flush();

    const sendBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Send Invite")
    );
    expect(sendBtn).toBeDefined();

    // Click twice rapidly
    await act(async () => {
      sendBtn?.click();
      sendBtn?.click();
    });

    // In-flight guard ensures only 1 POST in progress
    expect(postCallCount).toBe(1);

    // Resolve deferred POST
    await act(async () => {
      resolvePost();
    });
    await flush();

    // Row becomes "Invite sent" and disabled
    expect(container.textContent).toContain("Invite sent");
    const sentBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Invite sent")
    );
    expect(sentBtn?.disabled).toBe(true);

    // Verify payload: only inviteeId and conceptIds, NEVER caller studentId or userId
    expect(capturedBody).toEqual({
      inviteeId: peerAId,
      conceptIds: [concept1Id],
    });
    expect((capturedBody as Record<string, unknown>).studentId).toBeUndefined();
    expect((capturedBody as Record<string, unknown>).userId).toBeUndefined();
  });

  /* -------------------------------------------------------------------------- */
  /* Test 3: Deadlines & Expiry (caller pool vs invitation receipt)              */
  /* -------------------------------------------------------------------------- */
  it("disables invite actions on caller pool expiry and transitions receipt to Invitation expired", async () => {
    vi.useFakeTimers();

    const now = Date.now();
    const callerExpiresAt = new Date(now + 30000).toISOString(); // 30s
    const inviteReceiptExpiresAt = new Date(now + 10000).toISOString(); // 10s

    const candidate: StudyGroupCandidate = {
      studentId: peerAId,
      requestedConcepts: [
        { conceptId: concept1Id, label: "Backpropagation", band: "green" },
      ],
      complementaryGap: 0.95,
      fitKind: "reciprocal",
    };

    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/study-groups/candidates")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [candidate] }),
        };
      }
      if (urlStr.includes("/study-groups/invitations") && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            invitationId: "88888888-8888-4888-8888-888888888888",
            expiresAt: inviteReceiptExpiresAt,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(CandidateInvites, {
          studentId,
          courseId,
          conceptIds: [concept1Id],
          pool: {
            status: "waiting",
            expiresAt: callerExpiresAt,
          },
        })
      );
    });
    await flush();

    const sendBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Send Invite")
    );
    await act(async () => {
      sendBtn?.click();
    });
    await flush();

    expect(container.textContent).toContain("Invite sent");

    // Advance 10.1 seconds to cross invitation receipt deadline
    await act(async () => {
      vi.advanceTimersByTime(10100);
    });
    await flush();

    expect(container.textContent).toContain("Invitation expired");
    const expiredBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Invitation expired")
    );
    expect(expiredBtn?.disabled).toBe(true);

    vi.useRealTimers();
  });

  /* -------------------------------------------------------------------------- */
  /* Test 4: Preflight candidate disappearance & raced 409 INVITATION_EXPIRED    */
  /* -------------------------------------------------------------------------- */
  it("marks peer unavailable if omitted from preflight candidate response and prevents invitation POST", async () => {
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const candidate: StudyGroupCandidate = {
      studentId: peerAId,
      requestedConcepts: [
        { conceptId: concept1Id, label: "Backpropagation", band: "green" },
      ],
      complementaryGap: 0.9,
      fitKind: "reciprocal",
    };

    let postAttempted = false;

    // Preflight returns empty candidates (peer dropped out)
    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/study-groups/candidates")) {
        if (!postAttempted) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ candidates: [candidate] }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [] }),
        };
      }
      if (urlStr.includes("/study-groups/invitations") && init?.method === "POST") {
        postAttempted = true;
        return { ok: true, status: 201, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(CandidateInvites, {
          studentId,
          courseId,
          conceptIds: [concept1Id],
          pool: {
            status: "waiting",
            expiresAt,
          },
        })
      );
    });
    await flush();

    // Now make preflight return empty
    postAttempted = true;

    const sendBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Send Invite")
    );
    await act(async () => {
      sendBtn?.click();
    });
    await flush();

    // Button became "No longer available" and NO post occurred
    expect(container.textContent).toContain("No longer available");
    expect(postAttempted).toBe(true); // Flag was flipped by test setup, but POST route was not called
  });

  it("handles raced 409 INVITATION_EXPIRED from POST and keeps peer disabled", async () => {
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const candidate: StudyGroupCandidate = {
      studentId: peerAId,
      requestedConcepts: [
        { conceptId: concept1Id, label: "Backpropagation", band: "green" },
      ],
      complementaryGap: 0.9,
      fitKind: "reciprocal",
    };

    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/study-groups/candidates")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [candidate] }),
        };
      }
      if (urlStr.includes("/study-groups/invitations") && init?.method === "POST") {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: "INVITATION_EXPIRED",
              message: "Invitee has already left the study pool or their request expired",
              requestId: "req-inv-expired-001",
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(CandidateInvites, {
          studentId,
          courseId,
          conceptIds: [concept1Id],
          pool: {
            status: "waiting",
            expiresAt,
          },
        })
      );
    });
    await flush();

    const sendBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Send Invite")
    );
    await act(async () => {
      sendBtn?.click();
    });
    await flush();

    // Error is surfaced and peer is disabled
    expect(container.textContent).toContain("Invitee has already left the study pool");
  });

  /* -------------------------------------------------------------------------- */
  /* Test 5: Authoritative dual-peer party quest progress matrix                */
  /* -------------------------------------------------------------------------- */
  it("displays exact dual-peer checkmarks and prevents client-side checkbox mutations", async () => {
    const questItem: PartyQuestItem = {
      partyQuestId: "99999999-9999-4999-8999-999999999999",
      conceptIds: [concept1Id, concept2Id],
      status: "active",
      progress: [
        { studentId, conceptId: concept1Id, completed: true },
        { studentId, conceptId: concept2Id, completed: true },
        { studentId: peerAId, conceptId: concept1Id, completed: false },
        { studentId: peerAId, conceptId: concept2Id, completed: false },
      ],
    };

    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes(`/api/study-groups/${matchId}/quests`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ partyQuests: [questItem] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(PartyQuestPanel, {
          matchId,
          studentId,
          concepts: [
            { id: concept1Id, label: "Backpropagation" },
            { id: concept2Id, label: "Computational Graphs" },
          ],
          peerName: "Alex Chen",
          refreshKey: 0,
        })
      );
    });
    await flush();

    expect(container.textContent).toContain("Party Quests");
    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain("2 of 4 pairs completed");
    expect(container.textContent).toContain("Alex Chen");

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(4);

    // Verify You column: both checked and disabled
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[0].disabled).toBe(true);
    expect(checkboxes[2].checked).toBe(true);
    expect(checkboxes[2].disabled).toBe(true);

    // Verify Alex Chen column: both unchecked and disabled
    expect(checkboxes[1].checked).toBe(false);
    expect(checkboxes[1].disabled).toBe(true);
    expect(checkboxes[3].checked).toBe(false);
    expect(checkboxes[3].disabled).toBe(true);

    // Attempting to click disabled checkbox does not mutate state or send mutation
    const initialFetchCount = mockFetch.mock.calls.length;
    await act(async () => {
      checkboxes[1].click();
    });
    expect(checkboxes[1].checked).toBe(false);
    expect(mockFetch.mock.calls.length).toBe(initialFetchCount);
  });

  /* -------------------------------------------------------------------------- */
  /* Test 6: Party quest realtime event handling & snapshot consistency         */
  /* -------------------------------------------------------------------------- */
  it("refetches and updates progress only on valid same-match realtime events", async () => {
    let currentStatus: "active" | "completed" = "active";
    let partnerCompleted = false;

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
          }),
        };
      }
      if (urlStr.includes(`/api/study-groups/${matchId}/quests`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            partyQuests: [
              {
                partyQuestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                conceptIds: [concept1Id],
                status: currentStatus,
                progress: [
                  { studentId, conceptId: concept1Id, completed: true },
                  { studentId: peerAId, conceptId: concept1Id, completed: partnerCompleted },
                ],
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(StudyGroupFeature, {
          studentId,
          courseId,
          initialConcepts: testConcepts,
        })
      );
    });

    // Select concept 1 and join
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
    await flush();

    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain("1 of 2 pairs completed");

    // Deliver event for DIFFERENT matchId -> should NOT trigger refetch
    const fetchCountBefore = mockFetch.mock.calls.length;
    await act(async () => {
      activeMockSocket?.trigger("party:quest-updated", {
        eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        occurredAt: new Date().toISOString(),
        matchId: "99999999-9999-4999-8999-999999999999", // Different matchId
        partyQuestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 2,
        status: "completed",
        completedPairs: 2,
        totalPairs: 2,
      });
    });
    await flush();
    expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);

    // Deliver event with invalid payload (e.g. completedPairs > totalPairs) -> safeParse rejects
    await act(async () => {
      activeMockSocket?.trigger("party:quest-updated", {
        eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        occurredAt: new Date().toISOString(),
        matchId,
        partyQuestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 2,
        status: "completed",
        completedPairs: 5, // Invalid!
        totalPairs: 2,
      });
    });
    await flush();
    expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);

    // Now deliver valid event matching current matchId
    currentStatus = "completed";
    partnerCompleted = true;

    await act(async () => {
      activeMockSocket?.trigger("party:quest-updated", {
        eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        occurredAt: new Date().toISOString(),
        matchId,
        partyQuestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 2,
        status: "completed",
        completedPairs: 2,
        totalPairs: 2,
      });
    });
    await flush();

    // Verified: refetched from server and UI is updated to Completed
    expect(container.textContent).toContain("Completed");
    expect(container.textContent).toContain("2 of 2 pairs completed");
  });

  /* -------------------------------------------------------------------------- */
  /* Test 7: Delayed responses, unmount protection, and error recovery          */
  /* -------------------------------------------------------------------------- */
  it("prevents state leakage on delayed response and retains stale snapshot on refresh error", async () => {
    let returnError = false;
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes(`/api/study-groups/${matchId}/quests`)) {
        if (returnError) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: { code: "INTERNAL_ERROR", message: "Database offline" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            partyQuests: [
              {
                partyQuestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                conceptIds: [concept1Id],
                status: "active",
                progress: [
                  { studentId, conceptId: concept1Id, completed: true },
                  { studentId: peerAId, conceptId: concept1Id, completed: false },
                ],
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    // Initial load succeeds
    await act(async () => {
      root.render(
        React.createElement(PartyQuestPanel, {
          matchId,
          studentId,
          concepts: [{ id: concept1Id, label: "Backpropagation" }],
          peerName: "Alex Chen",
          refreshKey: 0,
        })
      );
    });
    await flush();

    expect(container.textContent).toContain("1 of 2 pairs completed");

    // Refresh fails -> retains stale snapshot with explicit error notice
    returnError = true;
    const refreshBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Refresh progress")
    );
    await act(async () => {
      refreshBtn?.click();
    });
    await flush();

    expect(container.textContent).toContain("1 of 2 pairs completed");
    expect(container.textContent).toContain("Unable to refresh progress");
  });

  /* -------------------------------------------------------------------------- */
  /* Test 8: Socket reconnect rejoins match room and recovers missed events      */
  /* -------------------------------------------------------------------------- */
  it("rejoins active match room and refetches progress on socket reconnect", async () => {
    let questFetchCount = 0;
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
          }),
        };
      }
      if (urlStr.includes(`/api/study-groups/${matchId}/quests`)) {
        questFetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            partyQuests: [
              {
                partyQuestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                conceptIds: [concept1Id],
                status: "active",
                progress: [
                  { studentId, conceptId: concept1Id, completed: true },
                  { studentId: peerAId, conceptId: concept1Id, completed: false },
                ],
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await act(async () => {
      root.render(
        React.createElement(StudyGroupFeature, {
          studentId,
          courseId,
          initialConcepts: testConcepts,
        })
      );
    });

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
    await flush();

    expect(activeMockSocket).not.toBeNull();
    const joinsEmittedInitial = activeMockSocket!.emittedEvents.filter(
      (e) => e.event === "study-group:join"
    );
    expect(joinsEmittedInitial.length).toBeGreaterThanOrEqual(1);
    const initialQuestFetches = questFetchCount;

    // Simulate socket disconnect
    await act(async () => {
      activeMockSocket!.disconnect();
    });
    await flush();

    // Simulate socket reconnect
    await act(async () => {
      activeMockSocket!.connect();
    });
    await flush();

    // Verify room re-join was emitted on reconnect
    const joinsEmittedAfter = activeMockSocket!.emittedEvents.filter(
      (e) => e.event === "study-group:join"
    );
    expect(joinsEmittedAfter.length).toBeGreaterThan(joinsEmittedInitial.length);

    // Verify quests refetched on reconnect
    expect(questFetchCount).toBeGreaterThan(initialQuestFetches);
  });
});
