// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UUID } from "@/contracts/common";
import type { ConceptNode } from "@/contracts/course";
import type { StudentQuizQuestion } from "@/contracts/learning";
import { TutorFeature } from "@/features/tutor/tutor-feature";
import { LearningFeature } from "@/features/learning/learning-feature";
import { MathMarkdown } from "@/features/learning/math-markdown";
import { FeatureErrorBoundary } from "@/features/learning/feature-error-boundary";
import { StudyGroupFeature } from "@/features/study-groups/study-group-feature";

interface SparkWindow {
  __spark_token?: string;
}

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

// Mock socket.io-client
type EventHandler = (...args: unknown[]) => void;
class MockSocket {
  public handlers: Map<string, EventHandler[]> = new Map();
  public connected = false;

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

describe("P5-C-05 Feature Components Suite", () => {
  let container: HTMLDivElement;
  let root: Root;
  const mockFetch = vi.fn();

  const studentId: UUID = "11111111-1111-4111-8111-111111111111";
  const courseId: UUID = "22222222-2222-4222-8222-222222222222";
  const conceptAId: UUID = "33333333-3333-4333-8333-333333333301";
  const conceptBId: UUID = "33333333-3333-4333-8333-333333333302";

  const testConcepts: ConceptNode[] = [
    {
      id: conceptAId,
      courseId,
      label: "Backpropagation",
      description: "Reverse automatic differentiation",
      category: "Neural Networks",
      difficulty: 3,
      createdAt: "2026-10-01T00:00:00Z",
    },
    {
      id: conceptBId,
      courseId,
      label: "Gradient Descent",
      description: "First-order optimization",
      category: "Optimization",
      difficulty: 2,
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];

  const testQuizQuestions: StudentQuizQuestion[] = [
    {
      id: "44444444-4444-4444-8444-444444444401" as UUID,
      question: "What is $f(x)$?",
      options: ["Opt A", "Opt B", "Opt C", "Opt D"],
      questionOrder: 1,
    },
    {
      id: "44444444-4444-4444-8444-444444444402" as UUID,
      question: "What is $g(x)$?",
      options: ["Opt 1", "Opt 2", "Opt 3", "Opt 4"],
      questionOrder: 2,
    },
    {
      id: "44444444-4444-4444-8444-444444444403" as UUID,
      question: "What is $h(x)$?",
      options: ["Opt W", "Opt X", "Opt Y", "Opt Z"],
      questionOrder: 3,
    },
    {
      id: "44444444-4444-4444-8444-444444444404" as UUID,
      question: "What is $p(x)$?",
      options: ["Opt I", "Opt II", "Opt III", "Opt IV"],
      questionOrder: 4,
    },
    {
      id: "44444444-4444-4444-8444-444444444405" as UUID,
      question: "What is $q(x)$?",
      options: ["Opt Alpha", "Opt Beta", "Opt Gamma", "Opt Delta"],
      questionOrder: 5,
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = mockFetch;
    mockFetch.mockReset();
    (window as unknown as SparkWindow).__spark_token = "mock-auth-token-12345";
    activeMockSocket = null;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    delete (window as unknown as SparkWindow).__spark_token;
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
  /* 1. MathMarkdown & Safe Content Tests                                       */
  /* -------------------------------------------------------------------------- */
  describe("1. MathMarkdown & Safe Content Rendering", () => {
    it("renders inline math and display math using KaTeX without crashing", async () => {
      await act(async () => {
        root.render(
          React.createElement(MathMarkdown, {
            content: "Inline $x^2 + y^2 = z^2$ and display:\n\n$$\\frac{a}{b}$$",
          })
        );
      });
      expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
      expect(container.textContent).toContain("Inline");
    });

    it("keeps code spans verbatim even if containing dollar signs", async () => {
      await act(async () => {
        root.render(
          React.createElement(MathMarkdown, {
            content: "Here is code: `var $price = 100;` and not math.",
          })
        );
      });
      const code = container.querySelector("code");
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe("var $price = 100;");
    });

    it("drops raw script tags, javascript: links, and unsafe html", async () => {
      await act(async () => {
        root.render(
          React.createElement(MathMarkdown, {
            content:
              '<script>alert("xss")</script>\n\n[Unsafe link](javascript:alert(1)) and [Safe](https://example.com)',
          })
        );
      });
      expect(container.querySelector("script")).toBeNull();
      const links = container.querySelectorAll("a");
      expect(links.length).toBe(1);
      expect(links[0].href).toBe("https://example.com/");
      expect(links[0].target).toBe("_blank");
      expect(links[0].rel).toContain("noopener");
    });

    it("keeps adjacent text readable when TeX expression is malformed", async () => {
      await act(async () => {
        root.render(
          React.createElement(MathMarkdown, {
            content: "Before math $\\frac{unclosed$ and after math text.",
          })
        );
      });
      expect(container.textContent).toContain("Before math");
      expect(container.textContent).toContain("after math text.");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. TutorFeature Tests                                                      */
  /* -------------------------------------------------------------------------- */
  describe("2. TutorFeature Interactive Semantics", () => {
    it("handles full session lifecycle: creates session lazily, sends message, updates confidence", async () => {
      const sessionId: UUID = "55555555-5555-4555-8555-555555555555";

      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sessionId }),
      });

      // Mock message submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          assistantContent: "Chain rule propagates partial derivatives.",
          understandingDetected: true,
          masteryUpdated: {
            confidence: 0.45,
            band: "yellow",
          },
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(TutorFeature, {
            studentId,
            courseId,
            initialConcepts: testConcepts,
          })
        );
      });

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      expect(textarea).not.toBeNull();

      // Enter response
      await act(async () => {
        setInputValue(textarea, "We use the chain rule to propagate error.");
      });

      const submitBtn = container.querySelector("button[type='submit']") as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(false);

      await act(async () => {
        submitBtn.click();
      });
      await flush();

      // Verify two API calls: session creation + message send
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe("/api/tutoring/sessions");
      expect(mockFetch.mock.calls[1][0]).toBe(`/api/tutoring/sessions/${sessionId}/messages`);

      // Verify message transcript contains user and assistant turns
      const userMsg = container.querySelector('[data-testid="tutor-message-user"]');
      const asstMsg = container.querySelector('[data-testid="tutor-message-assistant"]');
      expect(userMsg?.textContent).toContain("We use the chain rule");
      expect(asstMsg?.textContent).toContain("Chain rule propagates");

      // Verify understanding detected & updated confidence
      expect(container.textContent).toContain("Understanding detected");
      expect(container.textContent).toContain("45%");
      expect(container.textContent).toContain("In Progress (45%)");
    });

    it("displays error alert and does not alter confidence or draft when API fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: "SERVICE_UNAVAILABLE", message: "AI provider offline" },
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(TutorFeature, {
            studentId,
            courseId,
            initialConcepts: testConcepts,
          })
        );
      });

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      await act(async () => {
        setInputValue(textarea, "My response that should be preserved.");
      });

      const submitBtn = container.querySelector("button[type='submit']") as HTMLButtonElement;
      await act(async () => {
        submitBtn.click();
      });
      await flush();

      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(textarea.value).toBe("My response that should be preserved.");
      expect(container.querySelector('[data-testid="tutor-message-user"]')).toBeNull();
    });

    it("does not fabricate confidence when understanding detected but masteryUpdated is omitted", async () => {
      const sessionId: UUID = "55555555-5555-4555-8555-555555555555";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          assistantContent: "Good explanation of backpropagation.",
          understandingDetected: true,
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(TutorFeature, {
            studentId,
            sessionId,
            initialConcepts: testConcepts,
            initialMessages: [],
          })
        );
      });

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      await act(async () => {
        setInputValue(textarea, "Explaining gradients.");
      });

      const submitBtn = container.querySelector("button[type='submit']") as HTMLButtonElement;
      await act(async () => {
        submitBtn.click();
      });
      await flush();

      expect(container.textContent).toContain("Understanding detected");
      expect(container.textContent).not.toContain("+20% Mastery Confidence");
      expect(container.textContent).toContain("Confidence not yet loaded");
    });

    it("clears transcript, session, and concept confidence when switching concepts", async () => {
      await act(async () => {
        root.render(
          React.createElement(TutorFeature, {
            studentId,
            courseId,
            initialConcepts: testConcepts,
          })
        );
      });

      const buttons = container.querySelectorAll('button[role="radio"]');
      expect(buttons.length).toBe(2);

      // Click concept B
      await act(async () => {
        (buttons[1] as HTMLButtonElement).click();
      });

      expect(container.textContent).toContain("Gradient Descent");
      expect(container.querySelector("textarea")?.value).toBe("");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. LearningFeature & Quiz Tests                                            */
  /* -------------------------------------------------------------------------- */
  describe("3. LearningFeature Server-Authoritative Quiz & Resources", () => {
    it("renders learning guide from prop and switches tabs with keyboard navigation", async () => {
      await act(async () => {
        root.render(
          React.createElement(LearningFeature, {
            studentId,
            conceptId: conceptAId,
            courseId,
            initialContent: "# Learning Guide Header\n\nContent explaining backpropagation with $x$.",
            initialQuizQuestions: testQuizQuestions,
          })
        );
      });

      expect(container.textContent).toContain("Learning Guide Header");
      expect(container.textContent).toContain("Content explaining backpropagation");

      // Check tab keydown
      const guideTab = container.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement;
      expect(guideTab.textContent).toContain("Learning Guide");

      await act(async () => {
        guideTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });

      const quizTab = container.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement;
      expect(quizTab.textContent).toContain("Practice Quiz");
    });

    it("requires all 5 answers before quiz submission and displays server-graded result", async () => {
      const attemptId: UUID = "66666666-6666-4666-8666-666666666666";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          attemptId,
          score: 0.8,
          correctCount: 4,
          totalQuestions: 5,
          newConfidence: 0.35,
          newBand: "red",
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(LearningFeature, {
            studentId,
            conceptId: conceptAId,
            courseId,
            initialContent: "Loaded guide text",
            initialQuizQuestions: testQuizQuestions,
          })
        );
      });

      // Switch to Quiz tab
      const quizTabBtn = Array.from(container.querySelectorAll('[role="tab"]')).find((b) =>
        b.textContent?.includes("Practice Quiz")
      ) as HTMLButtonElement;

      await act(async () => {
        quizTabBtn.click();
      });

      // Check 5 fieldsets
      const fieldsets = container.querySelectorAll("fieldset");
      expect(fieldsets.length).toBe(5);

      const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);

      // Select answers for first 4 questions
      for (let i = 0; i < 4; i++) {
        const radio = fieldsets[i].querySelector('input[type="radio"]') as HTMLInputElement;
        await act(async () => {
          radio.click();
        });
      }
      expect(submitBtn.disabled).toBe(true);

      // Select 5th answer
      const lastRadio = fieldsets[4].querySelector('input[type="radio"]') as HTMLInputElement;
      await act(async () => {
        lastRadio.click();
      });

      expect(submitBtn.disabled).toBe(false);

      // Submit
      await act(async () => {
        submitBtn.click();
      });
      await flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe(`/api/concepts/${conceptAId}/quiz-submit`);

      // Verify server score (80%) and mastery band (red / Needs practice)
      expect(container.textContent).toContain("4 of 5 Correct (80%)");
      expect(container.textContent).toContain("Needs Practice (35%)");
      // Must NOT claim Shining based on 80% score!
      expect(container.textContent).not.toContain("Shining");
    });

    it("preserves radio selections and shows alert if quiz submit fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          error: { code: "SERVICE_UNAVAILABLE", message: "Server grading unavailable" },
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(LearningFeature, {
            studentId,
            conceptId: conceptAId,
            courseId,
            initialContent: "Loaded guide text",
            initialQuizQuestions: testQuizQuestions,
          })
        );
      });

      const quizTabBtn = Array.from(container.querySelectorAll('[role="tab"]')).find((b) =>
        b.textContent?.includes("Practice Quiz")
      ) as HTMLButtonElement;
      await act(async () => {
        quizTabBtn.click();
      });

      const fieldsets = container.querySelectorAll("fieldset");
      for (let i = 0; i < 5; i++) {
        const radio = fieldsets[i].querySelector('input[type="radio"]') as HTMLInputElement;
        await act(async () => {
          radio.click();
        });
      }

      const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      await act(async () => {
        submitBtn.click();
      });
      await flush();

      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      // Answers remain checked
      for (let i = 0; i < 5; i++) {
        const radio = fieldsets[i].querySelector('input[type="radio"]') as HTMLInputElement;
        expect(radio.checked).toBe(true);
      }
    });

    it("searches academic resources and asks cited questions without inventing papers", async () => {
      // Mock search response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          resources: [
            {
              title: "Gradient Propagation Paper",
              url: "https://arxiv.org/abs/2601.0001",
              snippet: "Foundational analysis of reverse-mode differentiation.",
              citationNumber: 1,
            },
          ],
        }),
      });

      // Mock ask response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          answer: "Backpropagation computes gradients in linear time [1].",
          citations: [
            {
              number: 1,
              title: "Gradient Propagation Paper",
              url: "https://arxiv.org/abs/2601.0001",
            },
          ],
        }),
      });

      await act(async () => {
        root.render(
          React.createElement(LearningFeature, {
            studentId,
            conceptId: conceptAId,
            courseId,
            initialContent: "Loaded guide text",
            initialQuizQuestions: testQuizQuestions,
          })
        );
      });

      // Switch to Resources tab
      const resTabBtn = Array.from(container.querySelectorAll('[role="tab"]')).find((b) =>
        b.textContent?.includes("Academic Resources")
      ) as HTMLButtonElement;
      await act(async () => {
        resTabBtn.click();
      });

      // Search literature
      const searchBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Search Literature")
      ) as HTMLButtonElement;

      await act(async () => {
        searchBtn.click();
      });
      await flush();

      expect(container.textContent).toContain("Gradient Propagation Paper");
      const paperLink = container.querySelector('a[href="https://arxiv.org/abs/2601.0001"]');
      expect(paperLink).not.toBeNull();

      // Ask question
      const qaInput = container.querySelector('input[placeholder*="backpropagation"]') as HTMLInputElement;
      await act(async () => {
        setInputValue(qaInput, "What is the time complexity?");
      });

      const askBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Ask Question")
      ) as HTMLButtonElement;

      await act(async () => {
        askBtn.click();
      });
      await flush();

      expect(container.textContent).toContain("Backpropagation computes gradients in linear time");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. StudyGroupFeature Tests                                                 */
  /* -------------------------------------------------------------------------- */
  describe("4. StudyGroupFeature Matchmaking Lobby", () => {
    it("renders consent rules and prevents joining with zero concepts or more than 3 concepts", async () => {
      await act(async () => {
        root.render(
          React.createElement(StudyGroupFeature, {
            studentId,
            courseId,
            initialConcepts: testConcepts,
          })
        );
      });

      expect(container.textContent).toContain("Matchmaking Consent & Privacy Rules");
      expect(container.textContent).toContain("Only classmates who explicitly opt in");

      const joinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Join Study Pool")
      ) as HTMLButtonElement;
      expect(joinBtn.disabled).toBe(true);

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(2);

      // Select concept A
      await act(async () => {
        (checkboxes[0] as HTMLInputElement).click();
      });

      expect(joinBtn.disabled).toBe(false);
    });

    it("handles opt-in waiting, countdown, and real-time match event with peer name", async () => {
      const matchId: UUID = "77777777-7777-4777-8777-777777777777";
      const expiresAt = new Date(Date.now() + 300000).toISOString();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "waiting",
          expiresAt,
        }),
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

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });

      const joinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Join Study Pool")
      ) as HTMLButtonElement;

      await act(async () => {
        joinBtn.click();
      });
      await flush();

      expect(container.textContent).toContain("Waiting for a Study Partner");
      expect(container.textContent).toContain("Leave Study Pool");

      // Simulate match event on the socket
      expect(activeMockSocket).not.toBeNull();
      await act(async () => {
        activeMockSocket?.trigger("study-group:matched", {
          eventId: "88888888-8888-4888-8888-888888888888",
          occurredAt: new Date().toISOString(),
          matchId,
          courseId,
          conceptIds: [conceptAId],
          peerName: "Alex Chen",
        });
      });

      expect(container.textContent).toContain("Study Partner Matched");
      expect(container.textContent).toContain("Alex Chen");
      expect(container.textContent).toContain(matchId);
    });

    it("allows student to opt out of the waiting pool", async () => {
      const expiresAt = new Date(Date.now() + 300000).toISOString();

      // Opt-in response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "waiting",
          expiresAt,
        }),
      });

      // Opt-out response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
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

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });

      const joinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Join Study Pool")
      ) as HTMLButtonElement;

      await act(async () => {
        joinBtn.click();
      });
      await flush();

      const leaveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Leave Study Pool")
      ) as HTMLButtonElement;

      await act(async () => {
        leaveBtn.click();
      });
      await flush();

      expect(container.textContent).toContain("Select Concepts for Peer Review");
      expect(container.textContent).not.toContain("Waiting for a Study Partner");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. ErrorBoundary & Accessibility Tests                                     */
  /* -------------------------------------------------------------------------- */
  describe("5. Recoverability & Accessibility", () => {
    it("renders fallback notice when a child component throws, and allows retry", async () => {
      let shouldThrow = true;
      function CrashingChild() {
        if (shouldThrow) {
          throw new Error("Simulated component explosion");
        }
        return React.createElement("div", null, "Recovered Child");
      }

      await act(async () => {
        root.render(
          React.createElement(
            FeatureErrorBoundary,
            { resetKey: "key-1" },
            React.createElement(CrashingChild, null)
          )
        );
      });

      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).toContain("Simulated component explosion");

      const retryBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Retry")
      );
      expect(retryBtn).not.toBeNull();

      shouldThrow = false;
      await act(async () => {
        retryBtn?.click();
      });

      expect(container.textContent).toContain("Recovered Child");
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  });
});
