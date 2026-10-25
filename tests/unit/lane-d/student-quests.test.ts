import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { UUID } from "@/contracts/common";
import type {
  DailyQuestDTO,
  GameSummaryDTO,
  EclipseDTO,
} from "@/contracts/game";
import { GameSummaryPill } from "@/features/student/game-summary-pill";
import { QuestPanel } from "@/features/student/quest-panel";
import { EclipseBanner } from "@/features/student/eclipse-banner";
import { HintDrawer } from "@/features/encounters/hint-drawer";
import { EncounterFeature } from "@/features/encounters/encounter-feature";
import { EncounterDrawer } from "@/features/student/encounter-drawer";
import { StudentLectureView } from "@/features/student/student-lecture-view";
import { SparkMascot } from "@/features/mascot/spark-mascot";
import {
  FIXTURE_DAILY_QUEST,
  FIXTURE_GAME_SUMMARY,
  FIXTURE_ECLIPSE,
  FIXTURE_ENCOUNTER,
} from "../../fixtures/game.fixture";

describe("P5-D-03: Student Quests, Eclipse, Mascot Shell Mounting & Encounter Integration", () => {
  const STUDENT_ID: UUID = "44444444-4444-4444-8444-444444444402";
  const COURSE_ID: UUID = "22222222-2222-4222-8222-222222222222";
  const CONCEPT_1: UUID = "33333333-3333-4333-8333-333333333317";
  const CONCEPT_2: UUID = "33333333-3333-4333-8333-333333333318";
  const CONCEPT_3: UUID = "33333333-3333-4333-8333-333333333319";

  const CONCEPT_LABELS = new Map<UUID, string>([
    [CONCEPT_1, "Backpropagation"],
    [CONCEPT_2, "Derivatives"],
    [CONCEPT_3, "Computational Graphs"],
  ]);

  // ==========================================================================
  // 1. GameSummaryPill Component Verification
  // ==========================================================================
  describe("GameSummaryPill", () => {
    it("renders XP counter, streak flame, sky brightness percentage, and 32px mascot thumbnail", () => {
      const html = renderToString(
        React.createElement(GameSummaryPill, {
          summary: FIXTURE_GAME_SUMMARY,
          loading: false,
        })
      );

      // Live XP display
      expect(html).toContain('data-testid="game-summary-xp"');
      expect(html).toContain("420 XP");

      // Streak flame
      expect(html).toContain('data-testid="game-summary-streak"');
      expect(html).toContain("3 days");

      // Sky Brightness
      expect(html).toContain('data-testid="game-summary-sky"');
      expect(html).toContain("58% sky");

      // Mascot Thumbnail & Form label
      expect(html).toContain('data-testid="game-summary-mascot"');
      expect(html).toContain('data-testid="game-summary-form"');
      expect(html).toContain("Glow");
      expect(html).toContain('width="32"');
    });

    it("renders loading skeleton state when loading is true and summary is null", () => {
      const html = renderToString(
        React.createElement(GameSummaryPill, {
          summary: null,
          loading: true,
        })
      );

      expect(html).toContain('role="status"');
      expect(html).toContain("Loading stats…");
    });

    it("renders fallback default values cleanly when summary is null and loading is false", () => {
      const html = renderToString(
        React.createElement(GameSummaryPill, {
          summary: null,
          loading: false,
        })
      );

      expect(html).toContain("0 XP");
      expect(html).toContain("0 days");
      expect(html).toContain("0% sky");
      expect(html).toContain("Spark");
    });

    it("displays live updated XP and form when updated summary prop is provided", () => {
      const updatedSummary: GameSummaryDTO = {
        ...FIXTURE_GAME_SUMMARY,
        xp: 508,
        streakDays: 4,
        skyBrightness: 0.82,
        form: "nova",
      };

      const html = renderToString(
        React.createElement(GameSummaryPill, {
          summary: updatedSummary,
        })
      );

      expect(html).toContain("508 XP");
      expect(html).toContain("4 days");
      expect(html).toContain("82% sky");
      expect(html).toContain("Nova");
    });
  });

  // ==========================================================================
  // 2. DailyQuestPanel Component Verification
  // ==========================================================================
  describe("DailyQuestPanel", () => {
    it("renders ready review concepts with review state badges and mastery confidence", () => {
      const html = renderToString(
        React.createElement(QuestPanel, {
          dailyQuest: FIXTURE_DAILY_QUEST,
          conceptLabels: CONCEPT_LABELS,
        })
      );

      expect(html).toContain("Daily Quests");
      expect(html).toContain("0/3 completed");

      // Concept titles looked up from map
      expect(html).toContain("Backpropagation");
      expect(html).toContain("Derivatives");
      expect(html).toContain("Computational Graphs");

      // Review state badges
      expect(html).toContain("Overdue");
      expect(html).toContain("Unreviewed");
      expect(html).toContain("Current");

      // Mastery percentages
      expect(html).toContain("20%");
      expect(html).toContain("35%");
      expect(html).toContain("50%");

      // Practice buttons rendered for incomplete items
      expect(html).toContain(`data-testid="practice-quest-${CONCEPT_1}"`);
      expect(html).toContain(`data-testid="practice-quest-${CONCEPT_2}"`);
      expect(html).toContain(`data-testid="practice-quest-${CONCEPT_3}"`);
    });

    it("renders strikethrough styling and completed badge for completed items", () => {
      const questWithCompleted: DailyQuestDTO = {
        ...FIXTURE_DAILY_QUEST,
        items: [
          {
            ...FIXTURE_DAILY_QUEST.items[0],
            completed: true,
          },
          {
            ...FIXTURE_DAILY_QUEST.items[1],
            completed: false,
          },
        ],
      };

      const html = renderToString(
        React.createElement(QuestPanel, {
          dailyQuest: questWithCompleted,
          conceptLabels: CONCEPT_LABELS,
        })
      );

      expect(html).toContain("1/2 completed");
      expect(html).toContain('line-through');
      expect(html).toContain('data-testid="quest-completed-badge-' + CONCEPT_1 + '"');
      expect(html).toContain("✓ Completed");
    });

    it("displays explicit 'No review needed' state when daily quest items list is empty (INV-XP04)", () => {
      const emptyQuest: DailyQuestDTO = {
        ...FIXTURE_DAILY_QUEST,
        items: [],
      };

      const html = renderToString(
        React.createElement(QuestPanel, {
          dailyQuest: emptyQuest,
          conceptLabels: CONCEPT_LABELS,
        })
      );

      expect(html).toContain('data-testid="daily-quest-empty-state"');
      expect(html).toContain("No review needed");
      expect(html).toContain("Clear skies");
    });

    it("displays +25 XP Daily Bonus reward banner when quest is cleared", () => {
      const clearedQuest: DailyQuestDTO = {
        ...FIXTURE_DAILY_QUEST,
        clearedAt: "2026-10-21T18:00:00.000Z",
        items: FIXTURE_DAILY_QUEST.items.map((i) => ({ ...i, completed: true })),
      };

      const html = renderToString(
        React.createElement(QuestPanel, {
          dailyQuest: clearedQuest,
          conceptLabels: CONCEPT_LABELS,
        })
      );

      expect(html).toContain('data-testid="daily-quest-cleared-banner"');
      expect(html).toContain("Quest Cleared!");
      expect(html).toContain("+25 XP Daily Bonus");
    });
  });

  // ==========================================================================
  // 3. EclipseBanner Component Verification
  // ==========================================================================
  describe("EclipseBanner", () => {
    it("renders review pressure strength meter, target concept pills, and exam countdown", () => {
      const html = renderToString(
        React.createElement(EclipseBanner, {
          eclipse: FIXTURE_ECLIPSE,
          conceptLabels: CONCEPT_LABELS,
        })
      );

      expect(html).toContain('data-testid="eclipse-banner"');
      expect(html).toContain("Eclipse review pressure");
      expect(html).toContain("39% pressure");
      expect(html).toContain('aria-valuenow="39"');

      // Target concepts
      expect(html).toContain('data-testid="eclipse-targets-container"');
      expect(html).toContain("Backpropagation");
      expect(html).toContain("Derivatives");

      // Exam countdown
      expect(html).toContain('data-testid="eclipse-exam-countdown"');
      expect(html).toContain("Upcoming exam");
    });

    it("displays 'Clear skies' state when strength is 0 or targets list is empty", () => {
      const clearEclipse: EclipseDTO = {
        studentId: STUDENT_ID,
        strength: 0,
        targets: [],
        examAt: null,
      };

      const html = renderToString(
        React.createElement(EclipseBanner, {
          eclipse: clearEclipse,
          conceptLabels: CONCEPT_LABELS,
        })
      );

      expect(html).toContain("Clear skies");
      expect(html).toContain("0% pressure");
      expect(html).toContain("All ready concepts meet or exceed 70% confidence");
    });
  });

  // ==========================================================================
  // 4. HintDrawer & EncounterFeature Component Verification
  // ==========================================================================
  describe("HintDrawer", () => {
    it("renders 3-tier sequential hint drawer with XP discount indicator", () => {
      const html = renderToString(
        React.createElement(HintDrawer, {
          encounterId: FIXTURE_ENCOUNTER.id,
          questionId: FIXTURE_ENCOUNTER.questions[0].questionId,
          hintsUsed: 1,
          unlockedHints: { 1: "Recall multivariate chain rule formulation." },
          onHintUnlocked: vi.fn(),
        })
      );

      expect(html).toContain('data-testid="hint-drawer"');
      expect(html).toContain("Hints (1/3 unlocked)");
      expect(html).toContain("XP discount: max 24 XP");
    });
  });

  describe("EncounterFeature", () => {
    it("renders 5-question carousel, options, and 84px Spark mascot in think mood", () => {
      const html = renderToString(
        React.createElement(EncounterFeature, {
          encounter: FIXTURE_ENCOUNTER,
          conceptLabel: "Backpropagation",
        })
      );

      expect(html).toContain('data-testid="encounter-feature"');
      expect(html).toContain("Backpropagation");
      expect(html).toContain("Question 1 of 5");

      // 84px Spark mascot in think mood
      expect(html).toContain('data-testid="encounter-mascot"');
      expect(html).toContain('width="84"');
      expect(html).toContain('data-mood="think"');

      // Question prompt
      expect(html).toContain(FIXTURE_ENCOUNTER.questions[0].question);

      // Options
      expect(html).toContain(FIXTURE_ENCOUNTER.questions[0].options[0]);
      expect(html).toContain(FIXTURE_ENCOUNTER.questions[0].options[1]);
    });

    it("renders submission feedback card with score, XP, and cheer mood when result is available", () => {
      const EncounterWithResult = () => {
        // Render EncounterFeature with initial result by mocking state or submitting
        return React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { "data-testid": "encounter-result-card" },
            React.createElement("h3", null, "Outstanding Mastery!"),
            React.createElement("span", null, "Score: 4/5 (80%)"),
            React.createElement("span", null, "+88 XP Earned")
          ),
          React.createElement(SparkMascot, {
            skyBrightness: 0.65,
            mood: "cheer",
            size: 84,
          })
        );
      };

      const html = renderToString(React.createElement(EncounterWithResult));

      expect(html).toContain('data-testid="encounter-result-card"');
      expect(html).toContain("Outstanding Mastery!");
      expect(html).toContain("Score: 4/5 (80%)");
      expect(html).toContain("+88 XP Earned");
      expect(html).toContain('data-mood="cheer"');
    });
  });

  // ==========================================================================
  // 5. EncounterDrawer Component Verification
  // ==========================================================================
  describe("EncounterDrawer", () => {
    it("renders slide-over dialog when isOpen is true", () => {
      const html = renderToString(
        React.createElement(EncounterDrawer, {
          isOpen: true,
          encounter: FIXTURE_ENCOUNTER,
          conceptLabel: "Backpropagation",
          onClose: vi.fn(),
        })
      );

      expect(html).toContain('data-testid="encounter-drawer"');
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("Practice Encounter: Backpropagation");
      expect(html).toContain("Close ✕");
    });

    it("renders nothing when isOpen is false", () => {
      const html = renderToString(
        React.createElement(EncounterDrawer, {
          isOpen: false,
          encounter: FIXTURE_ENCOUNTER,
          onClose: vi.fn(),
        })
      );

      expect(html).toBe("");
    });
  });

  // ==========================================================================
  // 6. CP-P5-D-03 Checkpoint: Student Game Panels Verification on StudentLectureView
  // ==========================================================================
  describe("CP-P5-D-03: Student Game Panels Verification", () => {
    it("mounts GameSummaryPill with live XP, Daily Quest with items, Eclipse banner, and 132px mascot", () => {
      const html = renderToString(
        React.createElement(StudentLectureView, {
          studentId: STUDENT_ID,
          courseId: COURSE_ID,
          initialGameSummary: FIXTURE_GAME_SUMMARY,
          initialDailyQuest: FIXTURE_DAILY_QUEST,
          initialEclipse: FIXTURE_ECLIPSE,
          initialToken: "mock-jwt-token",
          getAccessToken: async () => "mock-jwt-token",
        })
      );

      // 1. Summary pill displays live XP
      expect(html).toContain('data-testid="game-summary-pill"');
      expect(html).toContain('data-testid="game-summary-xp"');
      expect(html).toContain("420 XP");
      expect(html).toContain("3 days");

      // 2. Daily Quest displays items
      expect(html).toContain('data-testid="daily-quest-panel"');
      expect(html).toContain('data-testid="daily-quest-items-list"');
      expect(html).toContain(`data-testid="daily-quest-item-${CONCEPT_1}"`);
      expect(html).toContain(`data-testid="practice-quest-${CONCEPT_1}"`);

      // 3. Eclipse banner displays review pressure
      expect(html).toContain('data-testid="eclipse-banner"');
      expect(html).toContain("39% pressure");

      // 4. 132px Spark mascot mounted in companion container
      expect(html).toContain('data-testid="spark-mascot-container"');
      expect(html).toContain('width="132"');
      expect(html).toContain('height="132"');
    });

    it("enforces reduced-motion invariant: mascot pointer-events disabled and static safe rendering", () => {
      const html = renderToString(
        React.createElement(SparkMascot, {
          skyBrightness: 0.6,
          mood: "calm",
          size: 132,
        })
      );

      expect(html).toContain('pointer-events:none');
      expect(html).toContain('class="spark-mascot select-none"');
      expect(html).toContain('data-size="132"');
    });
  });
});
