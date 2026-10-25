// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ActorContext } from "@/contracts/common";
import type { EncounterDTO, EncounterResultDTO } from "@/contracts/game";
import { EncounterFeature } from "@/features/encounters/encounter-feature";
import {
  FIXTURE_ENCOUNTER,
  FIXTURE_GAME_SUMMARY,
  FIXTURE_ENCOUNTER_RESULT,
} from "../../fixtures/game.fixture";

import { setRuntimeSession } from "@/lib/client/session";

const mockFetch = vi.fn();

function makeGraphResponse(conceptId: string, confidence: number = 0.2) {
  return {
    nodes: [
      {
        id: conceptId,
        label: "Backpropagation",
        description: "Reverse automatic differentiation",
        category: "Neural Networks",
        difficulty: 3,
        importance: 0.5,
        confidence,
        band: "red",
      },
    ],
    edges: [],
  };
}

describe("P5-C-07 EncounterFeature Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = mockFetch;
    mockFetch.mockReset();
    setRuntimeSession({
      accessToken: "mock-token-p5c07",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
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

  function mockDefaultContext(confidence: number = 0.2) {
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/api/students/") && urlStr.includes("/game-summary")) {
        return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/api/courses/") && urlStr.includes("/graph")) {
        return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, confidence)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 1. Context, Session, KaTeX, and Navigation Tests                           */
  /* -------------------------------------------------------------------------- */
  describe("1. Context, Session, KaTeX, and Navigation", () => {
    it("loads real summary and graph, renders KaTeX and radio navigation, retains answers across Next/Previous", async () => {
      mockDefaultContext(0.2);

      const encounter: EncounterDTO = structuredClone(FIXTURE_ENCOUNTER);
      encounter.questions[0].question = "Calculate $\\frac{\\partial z}{\\partial x}$ with <script>alert(1)</script> values";
      encounter.questions[0].options[0] = "Value $e^{i\\pi} + 1 = 0$";

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter,
            conceptLabel: "Backpropagation",
          })
        );
      });

      // Context resolution
      await flush();
      await flush();

      expect(container.textContent).toContain("Backpropagation");
      expect(container.textContent).toContain("Question 1 of 5");
      // KaTeX rendered math
      expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(1);
      // Script tags stripped/dropped
      expect(container.querySelectorAll("script").length).toBe(0);

      // Select option 0 for question 1
      const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      expect(radios.length).toBe(4);
      await act(async () => {
        radios[0].click();
      });
      expect(radios[0].checked).toBe(true);

      // Navigate Next to Question 2
      const nextBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Next"
      );
      expect(nextBtn).toBeDefined();
      await act(async () => {
        nextBtn?.click();
      });
      await flush();

      expect(container.textContent).toContain("Question 2 of 5");

      // Navigate Previous back to Question 1
      const prevBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Previous"
      );
      expect(prevBtn).toBeDefined();
      await act(async () => {
        prevBtn?.click();
      });
      await flush();

      expect(container.textContent).toContain("Question 1 of 5");
      const radiosAgain = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      expect(radiosAgain[0].checked).toBe(true);
    });

    it("handles context failure with retry button and does not erase entered answers on retry", async () => {
      let failSummary = true;
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          if (failSummary) {
            return new Response(
              JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Game summary unavailable" } }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
          })
        );
      });
      await flush();
      await flush();

      expect(container.textContent).toContain("Retry loading context");
      // Radios may still be selectable
      const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      await act(async () => {
        radios[1].click();
      });
      expect(radios[1].checked).toBe(true);

      // Now click retry
      failSummary = false;
      const retryBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Retry")
      );
      expect(retryBtn).toBeDefined();
      await act(async () => {
        retryBtn?.click();
      });
      await flush();
      await flush();

      // Context now loaded, selection preserved
      expect(container.textContent).not.toContain("Retry loading context");
      const radiosAfter = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      expect(radiosAfter[1].checked).toBe(true);
    });

    it("displays error on mismatched student actor and disables mutations", async () => {
      mockDefaultContext(0.2);
      const actor: ActorContext = {
        userId: "99999999-9999-4999-8999-999999999999",
        authId: "99999999-9999-4999-8999-999999999999",
        email: "mismatched@test.local",
        name: "Mismatched Student",
        role: "student",
        enrolledCourses: [
          {
            studentId: "00000000-0000-4000-8000-000000000000",
            courseId: FIXTURE_GAME_SUMMARY.courseId,
          },
        ],
      };

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
            actor,
          })
        );
      });
      await flush();
      await flush();

      expect(container.textContent).toContain("Encounter context does not match this student.");
      const submitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      expect(submitBtn?.disabled).toBe(true);
    });

    it("renders abandoned state without quiz form", async () => {
      const abandoned: EncounterDTO = structuredClone(FIXTURE_ENCOUNTER) as EncounterDTO;
      abandoned.status = "abandoned";

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: abandoned,
          })
        );
      });
      await flush();

      expect(container.textContent).toContain("This encounter was abandoned.");
      expect(container.querySelectorAll('input[type="radio"]').length).toBe(0);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Sequential Truthful Hint Unlocking                                     */
  /* -------------------------------------------------------------------------- */
  describe("2. Sequential Truthful Hint Unlocking", () => {
    it("unlocks hints sequentially (1 -> 2 -> 3) and preserves separate caches across questions", async () => {
      const hintRequests: Array<{ questionId: string; level: number }> = [];
      mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/hints")) {
          const body = JSON.parse((init?.body as string) ?? "{}");
          hintRequests.push(body);
          return new Response(
            JSON.stringify({
              questionId: body.questionId,
              level: body.level,
              text: `Hint text for question ${body.questionId} level ${body.level} with $x^2$`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
          })
        );
      });
      await flush();
      await flush();

      // Open Hint Drawer
      const hintsDrawerBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Hints")
      );
      expect(hintsDrawerBtn).toBeDefined();
      await act(async () => {
        hintsDrawerBtn?.click();
      });
      await flush();

      // Request Level 1 hint
      const unlockLevel1Btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Unlock Level 1")
      );
      expect(unlockLevel1Btn).toBeDefined();
      await act(async () => {
        unlockLevel1Btn?.click();
      });
      await flush();
      await flush();

      expect(hintRequests).toEqual([
        { questionId: FIXTURE_ENCOUNTER.questions[0].questionId, level: 1 },
      ]);
      expect(container.textContent).toContain("Hint text for question");
      expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(1);

      // Now Level 2 should be available to unlock, Level 3 locked
      const unlockLevel2Btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Unlock Level 2")
      );
      expect(unlockLevel2Btn).toBeDefined();
      expect(unlockLevel2Btn?.disabled).toBe(false);

      // Navigate to question 2
      const nextBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Next"
      );
      await act(async () => {
        nextBtn?.click();
      });
      await flush();
      // Open hints drawer for question 2
      const hintsDrawerBtn2 = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Hints")
      );
      await act(async () => {
        hintsDrawerBtn2?.click();
      });
      await flush();

      // Question 2 should start with 0 hints unlocked
      expect(container.textContent).toContain("Unlock Level 1");
      expect(container.textContent).not.toContain("Unlock Level 2");

      // Navigate back to question 1
      const prevBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.trim() === "Previous"
      );
      await act(async () => {
        prevBtn?.click();
      });
      await flush();

      // Open hints drawer for question 1
      const hintsDrawerBtn1 = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Hints")
      );
      await act(async () => {
        hintsDrawerBtn1?.click();
      });
      await flush();

      // Question 1 should still show cached level 1 hint
      expect(container.textContent).toContain("Hint text for question");
      expect(container.textContent).toContain("Unlock Level 2");
    });

    it("starts with restored hintsUsed=2 unlocked and tier 3 next; uncached text exposes 'View released hint'", async () => {
      const encounter: EncounterDTO = structuredClone(FIXTURE_ENCOUNTER) as EncounterDTO;
      encounter.questions[0].hintsUsed = 2;

      let hintRequestCount = 0;
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/hints")) {
          hintRequestCount++;
          return new Response(
            JSON.stringify({
              questionId: encounter.questions[0].questionId,
              level: 1,
              text: "Restored hint level 1 text",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter,
          })
        );
      });
      await flush();
      await flush();
      // Open Hint Drawer
      const hintsDrawerBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Hints")
      );
      await act(async () => {
        hintsDrawerBtn?.click();
      });
      await flush();

      // Drawer shows tier 1 and tier 2 released; tier 3 is next to unlock
      expect(container.textContent).toContain("Unlock Level 3");
      const viewReleasedBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("View released hint")
      );
      expect(viewReleasedBtn).toBeDefined();

      await act(async () => {
        viewReleasedBtn?.click();
      });
      await flush();
      await flush();

      expect(hintRequestCount).toBe(1);
      expect(container.textContent).toContain("Restored hint level 1 text");
      // Still tier 3 next
      expect(container.textContent).toContain("Unlock Level 3");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. Truthful Hint Error Handling (No Invented Hints)                        */
  /* -------------------------------------------------------------------------- */
  describe("3. Truthful Hint Error Handling", () => {
    it("renders alert on 503 error, does NOT invent hint, and allows retry", async () => {
      let failHint = true;
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/hints")) {
          if (failHint) {
            return new Response(
              JSON.stringify({
                error: {
                  code: "SERVICE_UNAVAILABLE",
                  message: "Hint service unavailable.",
                  requestId: "req-hint-503",
                },
              }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(
            JSON.stringify({
              questionId: FIXTURE_ENCOUNTER.questions[0].questionId,
              level: 1,
              text: "Real hint text from server.",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
          })
        );
      });
      await flush();
      await flush();
      // Open Hint Drawer
      const hintsDrawerBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Hints")
      );
      await act(async () => {
        hintsDrawerBtn?.click();
      });
      await flush();

      const unlockBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Unlock Level 1")
      );
      await act(async () => {
        unlockBtn?.click();
      });
      await flush();
      await flush();

      // Error alert displayed
      expect(container.textContent).toContain("Hint service unavailable.");
      // No fallback hint text rendered!
      expect(container.textContent).not.toContain("Recall the fundamental concept");
      expect(container.textContent).not.toContain("Consider the relationship between variables");

      // Retry unlocks real hint
      failHint = false;
      const retryUnlockBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Unlock Level 1")
      );
      await act(async () => {
        retryUnlockBtn?.click();
      });
      await flush();
      await flush();

      expect(container.textContent).toContain("Real hint text from server.");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Concurrency & Mutation Locking                                          */
  /* -------------------------------------------------------------------------- */
  describe("4. Concurrency & Mutation Locking", () => {
    it("locks controls during in-flight hint and submit, preventing double-activation", async () => {
      const { promise: hintPromise, resolve: resolveHint } = Promise.withResolvers<Response>();
      let hintCallCount = 0;

      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/hints")) {
          hintCallCount++;
          return hintPromise;
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
          })
        );
      });
      await flush();
      await flush();
      // Open Hint Drawer
      const hintsDrawerBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Hints")
      );
      await act(async () => {
        hintsDrawerBtn?.click();
      });
      await flush();

      const unlockBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Unlock Level 1")
      );
      expect(unlockBtn).toBeDefined();

      // Trigger hint request
      await act(async () => {
        unlockBtn?.click();
        unlockBtn?.click(); // Double click
      });

      expect(hintCallCount).toBe(1);

      // Submit and Next/Previous navigation disabled while hint pending
      const submitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      expect(submitBtn?.disabled).toBe(true);

      // Resolve hint
      await act(async () => {
        resolveHint(
          new Response(
            JSON.stringify({
              questionId: FIXTURE_ENCOUNTER.questions[0].questionId,
              level: 1,
              text: "Resolved hint text",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });
      await flush();
      await flush();

      expect(container.textContent).toContain("Resolved hint text");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Server Reward Transition, Mascot Mood & Confidence Delta                */
  /* -------------------------------------------------------------------------- */
  describe("5. Server Reward Transition, Mascot Mood & Confidence Delta", () => {
    it("submits 5 answers, displays honest confidence change (+0.150), server XP, cheer mood, and calls onCompleted", async () => {
      let submitPayload: unknown = null;
      mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          // Opening baseline confidence: 0.20
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/submit")) {
          submitPayload = JSON.parse((init?.body as string) ?? "{}");
          const res: EncounterResultDTO = structuredClone(FIXTURE_ENCOUNTER_RESULT);
          res.score = 0.8;
          res.newConfidence = 0.35;
          res.xpAwarded = 88;
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      });

      const onCompleted = vi.fn();
      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
            onCompleted,
          })
        );
      });
      await flush();
      await flush();

      // Answer all 5 questions
      for (let i = 0; i < 5; i++) {
        const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        await act(async () => {
          radios[0].click();
        });
        if (i < 4) {
          const nextBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.textContent?.trim() === "Next"
          );
          await act(async () => {
            nextBtn?.click();
          });
          await flush();
        }
      }

      // Submit
      const submitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      expect(submitBtn?.disabled).toBe(false);

      await act(async () => {
        submitBtn?.click();
      });
      await flush();
      await flush();

      // Check submit payload
      expect(submitPayload).toEqual({
        answers: FIXTURE_ENCOUNTER.questions.map((q) => ({
          questionId: q.questionId,
          selectedOption: 0,
        })),
      });

      // Reward card assertions
      expect(container.textContent).toContain("88 XP");
      expect(container.textContent).toContain("Confidence change since opening");
      expect(container.textContent).toContain("+0.150"); // 0.35 - 0.20
      expect(container.textContent).toContain("4 / 5"); // correctCount

      // Mascot mood cheer
      const mascot = container.querySelector('[data-testid="encounter-mascot"]');
      expect(mascot?.getAttribute("data-mood")).toBe("cheer");

      expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    it("displays honest delta (+0.050) when opening 0.95 and result 1.00", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          // Opening baseline confidence: 0.95
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.95)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/submit")) {
          const res: EncounterResultDTO = structuredClone(FIXTURE_ENCOUNTER_RESULT);
          res.score = 1.0;
          res.newConfidence = 1.0;
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
          })
        );
      });
      await flush();
      await flush();

      for (let i = 0; i < 5; i++) {
        const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        await act(async () => {
          radios[1].click();
        });
        if (i < 4) {
          const nextBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.textContent?.trim() === "Next"
          );
          await act(async () => {
            nextBtn?.click();
          });
          await flush();
        }
      }

      const submitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      await act(async () => {
        submitBtn?.click();
      });
      await flush();
      await flush();

      expect(container.textContent).toContain("+0.050");
    });

    it("displays oops mood and 0 XP when low score and 0 XP awarded", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.3)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/submit")) {
          const res: EncounterResultDTO = structuredClone(FIXTURE_ENCOUNTER_RESULT);
          res.score = 0.2;
          res.correctCount = 1;
          res.xpAwarded = 0;
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      });

      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
          })
        );
      });
      await flush();
      await flush();

      for (let i = 0; i < 5; i++) {
        const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        await act(async () => {
          radios[0].click();
        });
        if (i < 4) {
          const nextBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.textContent?.trim() === "Next"
          );
          await act(async () => {
            nextBtn?.click();
          });
          await flush();
        }
      }

      const submitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      await act(async () => {
        submitBtn?.click();
      });
      await flush();
      await flush();

      const mascot = container.querySelector('[data-testid="encounter-mascot"]');
      expect(mascot?.getAttribute("data-mood")).toBe("oops");
      expect(container.textContent).toContain("0 XP");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. Submit Failure & Restoration Handling                                   */
  /* -------------------------------------------------------------------------- */
  describe("6. Submit Failure & Restoration Handling", () => {
    it("handles 503 submit failure without erasing answers or inventing rewards, allows successful retry", async () => {
      let failSubmit = true;
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/game-summary")) {
          return new Response(JSON.stringify(structuredClone(FIXTURE_GAME_SUMMARY)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/graph")) {
          return new Response(JSON.stringify(makeGraphResponse(FIXTURE_ENCOUNTER.conceptId, 0.2)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (urlStr.includes("/submit")) {
          if (failSubmit) {
            return new Response(
              JSON.stringify({
                error: {
                  code: "SERVICE_UNAVAILABLE",
                  message: "Scoring service unavailable",
                  requestId: "req-submit-503",
                },
              }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(JSON.stringify(structuredClone(FIXTURE_ENCOUNTER_RESULT)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 404 });
      });

      const onCompleted = vi.fn();
      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: structuredClone(FIXTURE_ENCOUNTER),
            onCompleted,
          })
        );
      });
      await flush();
      await flush();

      for (let i = 0; i < 5; i++) {
        const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        await act(async () => {
          radios[2].click();
        });
        if (i < 4) {
          const nextBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.textContent?.trim() === "Next"
          );
          await act(async () => {
            nextBtn?.click();
          });
          await flush();
        }
      }

      const submitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      await act(async () => {
        submitBtn?.click();
      });
      await flush();
      await flush();

      // Submit failed: alert shown, no onCompleted call, answers kept
      expect(container.textContent).toContain("Scoring service unavailable");
      expect(onCompleted).not.toHaveBeenCalled();

      // Retry
      failSubmit = false;
      const retrySubmitBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Submit")
      );
      await act(async () => {
        retrySubmitBtn?.click();
      });
      await flush();
      await flush();

      expect(container.textContent).not.toContain("Scoring service unavailable");
      expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    it("restores completed encounter from server without restarting quiz or calling onCompleted", async () => {
      const completedEncounter: EncounterDTO = structuredClone(FIXTURE_ENCOUNTER) as EncounterDTO;
      completedEncounter.status = "completed";

      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes(`/api/encounters/${completedEncounter.id}`)) {
          return new Response(
            JSON.stringify({
              encounter: completedEncounter,
              result: structuredClone(FIXTURE_ENCOUNTER_RESULT),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(null, { status: 404 });
      });

      const onCompleted = vi.fn();
      await act(async () => {
        root.render(
          React.createElement(EncounterFeature, {
            encounter: completedEncounter,
            onCompleted,
          })
        );
      });
      await flush();
      await flush();

      expect(container.textContent).toContain("Confidence change unavailable for restored encounter.");
      expect(container.textContent).toContain("4 / 5");
      expect(onCompleted).not.toHaveBeenCalled();
    });
  });
});
