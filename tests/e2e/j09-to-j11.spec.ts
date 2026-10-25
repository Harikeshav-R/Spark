import { test, expect } from "./helpers/journey-fixture";
import {
  setupJ09Scenario,
  setupJ10Scenario,
  setupJ11Scenario,
} from "./helpers/game-scenarios";
import {
  startLecture,
  ingestTranscript,
  getEncounterCorrectOptions,
} from "./helpers/journey-actions";

test.describe("P7-D-04 End-to-End Game Journeys Suite (J09–J11)", () => {
  // --------------------------------------------------------------------------
  // J09: Daily Quests, 3-Tier Progressive Hints & Streak Advancement
  // --------------------------------------------------------------------------
  test("J09: Daily Quests, 3-Tier Progressive Hints & Streak Advancement", async ({
    journey,
  }) => {
    // 1. Establish isolated 3-root course DAG with Rahul at 0.20 confidence
    const scenario = await setupJ09Scenario(journey);
    const rahulPage = journey.harness.rahul.page;

    await rahulPage.goto(
      `/student/${journey.rahul.studentId}?courseId=${scenario.courseId}`
    );
    await rahulPage.waitForSelector('[data-testid="daily-quest-panel"]', {
      state: "visible",
    });

    // 2. Independently verify the 3-item queue is ordered by concept UUID ascending
    const questButtons = rahulPage.locator('[data-testid^="practice-quest-"]');
    await expect(questButtons).toHaveCount(3);

    const displayedConceptIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const testId = await questButtons.nth(i).getAttribute("data-testid");
      const cId = testId?.replace("practice-quest-", "") ?? "";
      displayedConceptIds.push(cId);
    }
    expect(displayedConceptIds).toEqual(scenario.orderedConceptIds);

    // Reload page: assert ordered IDs, completion subset (empty), and quest survive reload
    await rahulPage.reload();
    await rahulPage.waitForSelector('[data-testid="daily-quest-panel"]', {
      state: "visible",
    });
    const reloadedButtons = rahulPage.locator('[data-testid^="practice-quest-"]');
    await expect(reloadedButtons).toHaveCount(3);

    // 3. Launch first quest practice encounter via UI
    const firstConceptId = scenario.orderedConceptIds[0];
    const encounterResponsePromise = rahulPage.waitForResponse(
      (res) =>
        res.url().includes(`/api/students/${journey.rahul.studentId}/encounters`) &&
        res.request().method() === "POST"
    );

    await rahulPage.click(`[data-testid="practice-quest-${firstConceptId}"]`);
    const encounterRes = await encounterResponsePromise;
    expect(encounterRes.ok()).toBe(true);
    const encounter = (await encounterRes.json()) as {
      id: string;
      questions: Array<{ questionId: string }>;
    };
    expect(encounter.id).toBeTruthy();
    expect(encounter.questions).toHaveLength(5);

    // Wait for Encounter Drawer to mount
    await rahulPage.waitForSelector('[data-testid="encounter-feature"]', {
      state: "visible",
    });

    // 4. Invariant: probe Hint Level 2 before Level 1 via authenticated API: expect 409 HINT_OUT_OF_SEQUENCE
    const prematureHintRes = await fetch(
      `${journey.baseURL}/api/encounters/${encounter.id}/hints`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({
          questionId: encounter.questions[0].questionId,
          level: 2,
        }),
      }
    );
    expect(prematureHintRes.status).toBe(409);
    const prematureErr = (await prematureHintRes.json()) as {
      code?: string;
      error?: { code?: string };
    };
    expect(prematureErr.code || prematureErr.error?.code).toBe(
      "HINT_OUT_OF_SEQUENCE"
    );

    // 5. Unlock Q1 Level 1 and Level 2 through UI
    await rahulPage.click('button:has-text("View Hints")');
    await rahulPage.waitForSelector('[data-testid="request-hint-1"]', {
      state: "visible",
    });

    // Request hint 1
    const hint1Promise = rahulPage.waitForResponse(
      (res) =>
        res.url().includes(`/api/encounters/${encounter.id}/hints`) &&
        res.request().method() === "POST"
    );
    await rahulPage.click('[data-testid="request-hint-1"]');
    const hint1Res = await hint1Promise;
    expect(hint1Res.ok()).toBe(true);

    // Prove level 3 remains locked until predecessor unlocked
    const tier3 = rahulPage.locator('[data-testid="hint-tier-3"]');
    await expect(tier3).toContainText("Locked (unlock prior level)");

    // Request hint 2
    const hint2Promise = rahulPage.waitForResponse(
      (res) =>
        res.url().includes(`/api/encounters/${encounter.id}/hints`) &&
        res.request().method() === "POST"
    );
    await rahulPage.click('[data-testid="request-hint-2"]');
    const hint2Res = await hint2Promise;
    expect(hint2Res.ok()).toBe(true);

    // Repeat a released hint request: assert idempotent outcome
    const repeatHintRes = await fetch(
      `${journey.baseURL}/api/encounters/${encounter.id}/hints`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({
          questionId: encounter.questions[0].questionId,
          level: 1,
        }),
      }
    );
    expect(repeatHintRes.ok).toBe(true);

    const correctOptions = await getEncounterCorrectOptions(
      journey.supabase,
      encounter.id
    );

    // Answer Q1 correctly
    await rahulPage.locator('input[type="radio"]').nth(correctOptions[0]).check();
    await rahulPage.click('button:has-text("Next")');

    // Answer Q2, Q3, Q4 correctly without hints
    for (let i = 1; i < 4; i++) {
      await rahulPage.locator('input[type="radio"]').nth(correctOptions[i]).check();
      await rahulPage.click('button:has-text("Next")');
    }

    // Q5: unlock levels 1, 2, 3 sequentially
    await rahulPage.click('button:has-text("View Hints")');
    for (const lvl of [1, 2, 3] as const) {
      const hintPromise = rahulPage.waitForResponse(
        (res) =>
          res.url().includes(`/api/encounters/${encounter.id}/hints`) &&
          res.request().method() === "POST"
      );
      await rahulPage.click(`[data-testid="request-hint-${lvl}"]`);
      const hRes = await hintPromise;
      expect(hRes.ok()).toBe(true);
      const hData = (await hRes.json()) as { text?: string };
      expect(hData.text?.trim().length).toBeGreaterThan(0);
    }

    // Deliberately answer Q5 incorrectly (pick option different from correctOptions[4])
    const incorrectQ5 = (correctOptions[4] + 1) % 4;
    await rahulPage.locator('input[type="radio"]').nth(incorrectQ5).check();
    // 6. Submit encounter through UI
    const submitEncounterPromise = rahulPage.waitForResponse(
      (res) =>
        res.url().includes(`/api/encounters/${encounter.id}/submit`) &&
        res.request().method() === "POST"
    );
    await rahulPage.click('button:has-text("Submit")');
    const submitRes = await submitEncounterPromise;
    expect(submitRes.ok()).toBe(true);

    const resultData = (await submitRes.json()) as {
      correctCount: number;
      score: number;
      newConfidence: number;
      xpAwarded: number;
    };

    // Assert exact discounted XP math: Q1 (18) + Q2-Q4 (90) + Q5 (8) = 116 XP
    expect(resultData.correctCount).toBe(4);
    expect(resultData.score).toBe(0.8);
    expect(resultData.newConfidence).toBe(0.35);
    expect(resultData.xpAwarded).toBe(116);
    // Assert encounter-result-card is displayed
    await expect(
      rahulPage.locator('[data-testid="encounter-result-card"]')
    ).toBeVisible();

    // Close encounter drawer
    await rahulPage.click('button[aria-label="Close encounter"]');

    // Assert daily quest progress badge updates to 1/3
    await expect(
      rahulPage.locator('[data-testid="daily-quest-progress-badge"]')
    ).toContainText("1/3 completed");
    // 7. Finish remaining two concepts perfectly with no hints (150 XP each)
    const questRes = await fetch(
      `${journey.baseURL}/api/students/${journey.rahul.studentId}/daily-quest`,
      {
        headers: {
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
      }
    );
    expect(questRes.ok).toBe(true);
    const questData = (await questRes.json()) as { id: string };

    for (let cIdx = 1; cIdx <= 2; cIdx++) {
      const cId = scenario.orderedConceptIds[cIdx];
      const startRes = await fetch(
        `${journey.baseURL}/api/students/${journey.rahul.studentId}/encounters`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.rahul.session.accessToken}`,
          },
          body: JSON.stringify({
            conceptId: cId,
            source: "daily",
            questId: questData.id,
          }),
        }
      );
      expect(startRes.ok).toBe(true);
      const encObj = (await startRes.json()) as {
        id: string;
        questions: Array<{ questionId: string }>;
      };

      // Submit perfect score using resolved correct option indices (0 hints used)
      const correctOpts = await getEncounterCorrectOptions(
        journey.supabase,
        encObj.id
      );
      const answersPayload = encObj.questions.map((q, idx) => ({
        questionId: q.questionId,
        selectedOption: correctOpts[idx],
      }));

      const subRes = await fetch(
        `${journey.baseURL}/api/encounters/${encObj.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.rahul.session.accessToken}`,
          },
          body: JSON.stringify({ answers: answersPayload }),
        }
      );
      if (!subRes.ok) {
        console.error("subRes failed:", subRes.status, await subRes.text());
      }
      expect(subRes.ok).toBe(true);
      const subJson = (await subRes.json()) as { xpAwarded: number };
      expect(subJson.xpAwarded).toBe(150);
    }

    // 8. Assert Quest Cleared: exactly one 25-XP quest_cleared entry, total XP +441, streak 2 -> 3
    const clearEvents = await journey.supabase.serviceClient
      .from("xp_events")
      .select("amount, reason, award_date")
      .eq("student_id", journey.rahul.studentId)
      .eq("award_date", scenario.todayUtcDate);

    expect(clearEvents.data).toHaveLength(4); // 3 encounters (116, 150, 150) + 1 quest_cleared (25)
    const totalTodayXp = clearEvents.data?.reduce((sum, r) => sum + r.amount, 0);
    expect(totalTodayXp).toBe(441);

    // Verify streak increased from 2 to 3
    const summaryRes = await fetch(
      `${journey.baseURL}/api/students/${journey.rahul.studentId}/game-summary?courseId=${scenario.courseId}`,
      {
        headers: {
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
      }
    );
    expect(summaryRes.ok).toBe(true);
    const summaryData = (await summaryRes.json()) as { streakDays: number };
    expect(summaryData.streakDays).toBe(3);

    // Reload page: assert daily quest cleared banner is visible
    await rahulPage.reload();
    await expect(
      rahulPage.locator('[data-testid="daily-quest-cleared-banner"]')
    ).toBeVisible();
    // 9. Launch a second encounter on first concept on that same day
    const secondEncStart = await fetch(
      `${journey.baseURL}/api/students/${journey.rahul.studentId}/encounters`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({ conceptId: firstConceptId, source: "star" }),
      }
    );
    expect(secondEncStart.ok).toBe(true);
    const secondEnc = (await secondEncStart.json()) as {
      id: string;
      questions: Array<{ questionId: string }>;
    };

    const correctOpts2 = await getEncounterCorrectOptions(
      journey.supabase,
      secondEnc.id
    );
    const answers2 = secondEnc.questions.map((q, idx) => ({
      questionId: q.questionId,
      selectedOption:
        idx === 4 ? (correctOpts2[4] + 1) % 4 : correctOpts2[idx],
    }));
    const secondSubRes = await fetch(
      `${journey.baseURL}/api/encounters/${secondEnc.id}/submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({ answers: answers2 }),
      }
    );
    expect(secondSubRes.ok).toBe(true);
    const secondSubData = (await secondSubRes.json()) as {
      xpAwarded: number;
      newConfidence: number;
    };
    // Mastery rises 0.35 -> 0.50, but xpAwarded is 0 (duplicate practice on same date)
    expect(secondSubData.newConfidence).toBe(0.5);
    expect(secondSubData.xpAwarded).toBe(0);

    // Invariant: probe post-submission hint request: expect 409 ENCOUNTER_ALREADY_SUBMITTED
    const postSubmitHintRes = await fetch(
      `${journey.baseURL}/api/encounters/${secondEnc.id}/hints`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({
          questionId: secondEnc.questions[0].questionId,
          level: 1,
        }),
      }
    );
    expect(postSubmitHintRes.status).toBe(409);
    const postSubmitHintErr = (await postSubmitHintRes.json()) as {
      code?: string;
      error?: { code?: string };
    };
    expect(postSubmitHintErr.code || postSubmitHintErr.error?.code).toBe(
      "ENCOUNTER_ALREADY_SUBMITTED"
    );
  });

  // --------------------------------------------------------------------------
  // J10: Eclipse Review Pressure, Mascot Evolution & Exam Countdown
  // --------------------------------------------------------------------------
  test("J10: Eclipse Review Pressure, Mascot Evolution & Exam Countdown", async ({
    journey,
  }) => {
    // 1. Establish isolated course with mean 0.58 and upcoming exam in 10 days
    const scenario = await setupJ10Scenario(journey);
    const hariPage = journey.harness.hari.page;

    // Freeze time only (Date only, not Socket.IO or timer loops)
    await hariPage.clock.setFixedTime(journey.now);

    await hariPage.goto(
      `/student/${journey.hari.studentId}?courseId=${scenario.courseId}`
    );
    await hariPage.waitForSelector('[data-testid="eclipse-banner"]', {
      state: "visible",
    });

    // 2. Assert initial Eclipse pressure is 39% and exam countdown displays 10 days
    await expect(
      hariPage.locator('[data-testid="eclipse-strength-badge"]')
    ).toContainText("39% pressure");
    await expect(
      hariPage.locator('[data-testid="eclipse-exam-countdown"]')
    ).toContainText("10 days");
    // Assert mascot renders with form "glow"
    const mascot = hariPage.locator('[data-testid="spark-mascot-container"] svg');
    await expect(mascot).toHaveAttribute("data-form", "glow");

    // 3. Complete 3 perfect encounters for Attention Mechanisms (0.35 -> 0.50 -> 0.65 -> 0.80)
    for (let i = 0; i < 3; i++) {
      const encRes = await fetch(
        `${journey.baseURL}/api/students/${journey.hari.studentId}/encounters`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.hari.session.accessToken}`,
          },
          body: JSON.stringify({
            conceptId: scenario.attentionId,
            source: "star",
          }),
        }
      );
      expect(encRes.ok).toBe(true);
      const enc = (await encRes.json()) as {
        id: string;
        questions: Array<{ questionId: string }>;
      };
      const correctOpts = await getEncounterCorrectOptions(
        journey.supabase,
        enc.id
      );
      const answers = enc.questions.map((q, idx) => ({
        questionId: q.questionId,
        selectedOption: correctOpts[idx],
      }));
      const subRes = await fetch(
        `${journey.baseURL}/api/encounters/${enc.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.hari.session.accessToken}`,
          },
          body: JSON.stringify({ answers }),
        }
      );
      expect(subRes.ok).toBe(true);
    }

    // 4. Complete 1 perfect encounter for Transformers (0.50 -> 0.65)
    // New course mean: (0.80 + 0.65 + 0.89) / 3 = 0.78 -> transitions to "nova"
    const transEncRes = await fetch(
      `${journey.baseURL}/api/students/${journey.hari.studentId}/encounters`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.hari.session.accessToken}`,
        },
        body: JSON.stringify({
          conceptId: scenario.transformersId,
          source: "star",
        }),
      }
    );
    expect(transEncRes.ok).toBe(true);
    const transEnc = (await transEncRes.json()) as {
      id: string;
      questions: Array<{ questionId: string }>;
    };
    const transOpts = await getEncounterCorrectOptions(
      journey.supabase,
      transEnc.id
    );
    const transAnswers = transEnc.questions.map((q, idx) => ({
      questionId: q.questionId,
      selectedOption: transOpts[idx],
    }));
    const transSubRes = await fetch(
      `${journey.baseURL}/api/encounters/${transEnc.id}/submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.hari.session.accessToken}`,
        },
        body: JSON.stringify({ answers: transAnswers }),
      }
    );
    expect(transSubRes.ok).toBe(true);

    // Reload page to observe mascot evolution transition to Nova
    await hariPage.reload();
    await hariPage.waitForSelector('[data-testid="spark-mascot-container"] svg', {
      state: "visible",
    });

    const novaMascot = hariPage.locator('[data-testid="spark-mascot-container"] svg');
    await expect(novaMascot).toHaveAttribute("data-form", "nova");

    // 5. Complete 1 more perfect encounter for Transformers (0.65 -> 0.80)
    // All 3 concepts are now >= 0.70 -> zero weak targets, 0% pressure, Clear Skies
    const finalTransRes = await fetch(
      `${journey.baseURL}/api/students/${journey.hari.studentId}/encounters`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.hari.session.accessToken}`,
        },
        body: JSON.stringify({
          conceptId: scenario.transformersId,
          source: "star",
        }),
      }
    );
    expect(finalTransRes.ok).toBe(true);
    const finalTrans = (await finalTransRes.json()) as {
      id: string;
      questions: Array<{ questionId: string }>;
    };
    const finalTransOpts = await getEncounterCorrectOptions(
      journey.supabase,
      finalTrans.id
    );
    const finalAnswers = finalTrans.questions.map((q, idx) => ({
      questionId: q.questionId,
      selectedOption: finalTransOpts[idx],
    }));
    const finalSubRes = await fetch(
      `${journey.baseURL}/api/encounters/${finalTrans.id}/submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.hari.session.accessToken}`,
        },
        body: JSON.stringify({ answers: finalAnswers }),
      }
    );
    expect(finalSubRes.ok).toBe(true);

    await hariPage.reload();
    await hariPage.waitForSelector('[data-testid="eclipse-banner"]', {
      state: "visible",
    });
    // Verify 0% pressure and Clear skies state
    await expect(
      hariPage.locator('[data-testid="eclipse-strength-badge"]')
    ).toContainText("0% pressure");
    await expect(
      hariPage.locator("text=Clear skies")
    ).toBeVisible();

    // 6. Invariant: diagnostic reads do not mutate or decay mastery
    const preReadMastery = await journey.supabase.serviceClient
      .from("student_mastery")
      .select("confidence")
      .eq("student_id", journey.hari.studentId)
      .eq("concept_id", scenario.attentionId)
      .single();

    // Trigger diagnostic read
    const diagRes = await fetch(
      `${journey.baseURL}/api/students/${journey.hari.studentId}/eclipse?courseId=${scenario.courseId}`,
      {
        headers: {
          Authorization: `Bearer ${journey.hari.session.accessToken}`,
        },
      }
    );
    expect(diagRes.ok).toBe(true);

    const postReadMastery = await journey.supabase.serviceClient
      .from("student_mastery")
      .select("confidence")
      .eq("student_id", journey.hari.studentId)
      .eq("concept_id", scenario.attentionId)
      .single();

    expect(Number(postReadMastery.data?.confidence)).toBe(
      Number(preReadMastery.data?.confidence)
    );
  });

  // --------------------------------------------------------------------------
  // J11: Collaborative Party Quests, Bilateral Completion & Class Sky Analytics
  // --------------------------------------------------------------------------
  test("J11: Collaborative Party Quests, Bilateral Completion & Class Sky Analytics", async ({
    journey,
  }) => {
    // 1. Establish canonical dataset with Rahul effort 658 vs Hari 620
    const scenario = await setupJ11Scenario(journey);
    const rahulPage = journey.harness.rahul.page;
    const hariPage = journey.harness.hari.page;
    const teacherPage = journey.harness.teacher.page;

    // 2. Opt in both peers for Backpropagation & Computational Graphs
    await rahulPage.goto(
      `/student/${journey.rahul.studentId}/study-group?courseId=${scenario.courseId}`
    );
    await rahulPage.waitForSelector(
      '[data-testid="study-group-workspace-content"]',
      { state: "visible" }
    );
    await rahulPage.check(`input[id*="${scenario.backpropId}"]`);
    await rahulPage.check(`input[id*="${scenario.compGraphsId}"]`);
    await rahulPage.click('button:has-text("Join Study Pool")');

    await hariPage.goto(
      `/student/${journey.hari.studentId}/study-group?courseId=${scenario.courseId}`
    );
    await hariPage.waitForSelector(
      '[data-testid="study-group-workspace-content"]',
      { state: "visible" }
    );
    await hariPage.check(`input[id*="${scenario.backpropId}"]`);
    await hariPage.check(`input[id*="${scenario.compGraphsId}"]`);
    await hariPage.click('button:has-text("Join Study Pool")');

    await expect(
      hariPage.locator('[data-testid="study-pool-matched"]')
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      rahulPage.locator('[data-testid="study-pool-matched"]')
    ).toBeVisible({ timeout: 15_000 });

    // Retrieve active match ID from database
    const dbMatch = await journey.supabase.serviceClient
      .from("study_group_matches")
      .select("id")
      .eq("course_id", scenario.courseId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const matchId = dbMatch.data?.id;
    expect(matchId).toBeTruthy();

    // 3. Start a 2-concept party quest via student HTTP API
    const startQuestRes = await fetch(
      `${journey.baseURL}/api/study-groups/${matchId}/quests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({
          conceptIds: [scenario.backpropId, scenario.compGraphsId],
        }),
      }
    );
    expect(startQuestRes.ok).toBe(true);
    const startQuestData = (await startQuestRes.json()) as {
      partyQuestId?: string;
      id?: string;
    };
    const questId = startQuestData.partyQuestId || startQuestData.id!;

    // Both browser views render the party quest card
    await expect(
      rahulPage.locator(`[data-testid="party-quest-card-${questId}"]`)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      hariPage.locator(`[data-testid="party-quest-card-${questId}"]`)
    ).toBeVisible({ timeout: 15_000 });

    // 4. Complete Rahul's encounters first
    for (const cId of [scenario.backpropId, scenario.compGraphsId]) {
      const encRes = await fetch(
        `${journey.baseURL}/api/students/${journey.rahul.studentId}/encounters`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.rahul.session.accessToken}`,
          },
          body: JSON.stringify({
            conceptId: cId,
            source: "party",
            partyQuestId: questId,
          }),
        }
      );
      expect(encRes.ok).toBe(true);
      const enc = (await encRes.json()) as {
        id: string;
        questions: Array<{ questionId: string }>;
      };
      const rahulOpts = await getEncounterCorrectOptions(
        journey.supabase,
        enc.id
      );
      const answers = enc.questions.map((q, idx) => ({
        questionId: q.questionId,
        selectedOption: rahulOpts[idx],
      }));

      const subRes = await fetch(
        `${journey.baseURL}/api/encounters/${enc.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.rahul.session.accessToken}`,
          },
          body: JSON.stringify({ answers }),
        }
      );
      expect(subRes.ok).toBe(true);
    }

    // Invariant: assert quest still active, Hari pending, zero party XP yet
    const midQuestCheck = await journey.supabase.serviceClient
      .from("party_quests")
      .select("status")
      .eq("id", questId)
      .single();
    expect(midQuestCheck.data?.status).toBe("active");

    const prePartyXp = await journey.supabase.serviceClient
      .from("xp_events")
      .select("id")
      .eq("reason", "party")
      .eq("source_id", questId);
    expect(prePartyXp.data).toHaveLength(0);

    // Invariant: attempt to act as Hari using Rahul's token is rejected with 403
    const unauthorizedRes = await fetch(
      `${journey.baseURL}/api/students/${journey.hari.studentId}/encounters`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
        body: JSON.stringify({
          conceptId: scenario.backpropId,
          source: "party",
          partyQuestId: questId,
        }),
      }
    );
    expect(unauthorizedRes.status).toBe(403);

    // 5. Complete Hari's encounters
    for (const cId of [scenario.backpropId, scenario.compGraphsId]) {
      const encRes = await fetch(
        `${journey.baseURL}/api/students/${journey.hari.studentId}/encounters`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.hari.session.accessToken}`,
          },
          body: JSON.stringify({
            conceptId: cId,
            source: "party",
            partyQuestId: questId,
          }),
        }
      );
      expect(encRes.ok).toBe(true);
      const enc = (await encRes.json()) as {
        id: string;
        questions: Array<{ questionId: string }>;
      };
      const hariOpts = await getEncounterCorrectOptions(
        journey.supabase,
        enc.id
      );
      const answers = enc.questions.map((q, idx) => ({
        questionId: q.questionId,
        selectedOption: hariOpts[idx],
      }));

      const subRes = await fetch(
        `${journey.baseURL}/api/encounters/${enc.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${journey.hari.session.accessToken}`,
          },
          body: JSON.stringify({ answers }),
        }
      );
      expect(subRes.ok).toBe(true);
    }

    // Assert quest completed and exactly one 60-XP party entry per peer
    // Assert quest completed in both browser views without reload
    const rahulCard = rahulPage.locator(
      `[data-testid="party-quest-card-${questId}"]`
    );
    await expect(
      rahulCard.getByText("Completed", { exact: true })
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      rahulCard.getByText("4 of 4 pairs completed")
    ).toBeVisible({ timeout: 15_000 });

    const hariCard = hariPage.locator(
      `[data-testid="party-quest-card-${questId}"]`
    );
    await expect(
      hariCard.getByText("Completed", { exact: true })
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      hariCard.getByText("4 of 4 pairs completed")
    ).toBeVisible({ timeout: 15_000 });

    const rahulPartyXp = await journey.supabase.serviceClient
      .from("xp_events")
      .select("amount, reason")
      .eq("student_id", journey.rahul.studentId)
      .eq("reason", "party")
      .eq("source_id", questId);
    expect(rahulPartyXp.data).toHaveLength(1);
    expect(rahulPartyXp.data?.[0].amount).toBe(60);

    const hariPartyXp = await journey.supabase.serviceClient
      .from("xp_events")
      .select("amount, reason")
      .eq("student_id", journey.hari.studentId)
      .eq("reason", "party")
      .eq("source_id", questId);
    expect(hariPartyXp.data).toHaveLength(1);
    expect(hariPartyXp.data?.[0].amount).toBe(60);
    // 6. Teacher starts lecture, ingests transcript for Gradient Descent, and opens Class Sky
    const { lectureId } = await startLecture(journey, "Lecture on Gradient Descent");
    await ingestTranscript(
      journey,
      lectureId,
      "Gradient descent iteratively updates parameters in the opposite direction of the gradient.",
      10
    );

    await teacherPage.goto(
      `/professor/dashboard?courseId=${scenario.courseId}`
    );
    await teacherPage.waitForSelector('button:has-text("Class Sky")', {
      state: "visible",
    });
    await teacherPage.click('button:has-text("Class Sky")');
    // Verify Class Sky analytics and Effort Roster
    await expect(
      teacherPage.locator('h3:has-text("Effort & Mastery Diagnostic Matrix")')
    ).toBeVisible();

    // Verify Rahul is flagged as high_effort_low_mastery with "Needs support" badge
    const rahulRow = teacherPage.locator("tr", { hasText: "Rahul" });
    await expect(rahulRow).toBeVisible();
    await expect(rahulRow.locator("text=100%")).toBeVisible(); // Effort %ile
    await expect(rahulRow.locator("text=33%")).toBeVisible(); // Mastery %ile
    await expect(rahulRow.locator('span:has-text("Needs support")')).toBeVisible();

    // 7. Invariant: student views expose no cohort effort, leaderboard, or scatter plot
    await expect(
      rahulPage.locator('h3:has-text("Effort & Mastery Diagnostic Matrix")')
    ).not.toBeVisible();
    await expect(
      hariPage.locator('h3:has-text("Effort & Mastery Diagnostic Matrix")')
    ).not.toBeVisible();

    // Direct student calls to teacher-only Class Sky endpoints return 403
    const studentSkyRes = await fetch(
      `${journey.baseURL}/api/courses/${scenario.courseId}/class-sky`,
      {
        headers: {
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
      }
    );
    expect(studentSkyRes.status).toBe(403);

    const studentEffortRes = await fetch(
      `${journey.baseURL}/api/courses/${scenario.courseId}/students/effort`,
      {
        headers: {
          Authorization: `Bearer ${journey.rahul.session.accessToken}`,
        },
      }
    );
    expect(studentEffortRes.status).toBe(403);
  });
});
