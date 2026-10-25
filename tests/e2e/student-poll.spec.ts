import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../integration/lane-a/supabase-harness.js";

test.describe("P4-D-02: Student Active Poll Modal & Evaluation Card E2E", () => {
  let harness: SupabaseTestHarness;
  let context: TestContext;

  test.afterEach(async () => {
    if (context && harness) {
      await harness.cleanup(context);
    }
  });

  test("Students receive active poll in real-time, submit answers, and receive private evaluation with mastery update", async ({
    browser,
    baseURL,
  }) => {
    test.skip(process.env.RUN_LOCAL_SUPABASE !== "1", "Requires RUN_LOCAL_SUPABASE=1");

    harness = new SupabaseTestHarness();
    context = { users: [], teacherIds: [], courseIds: [] };

    // 1. Create Course with 2 concepts
    const courseCtx = await harness.createTestCourse(context, { conceptCount: 2 });
    const courseId = courseCtx.courseId;
    const concept1 = courseCtx.conceptIds[0]!;
    const concept2 = courseCtx.conceptIds[1]!;

    const teacherUser = context.users.find((u) => u.authId === courseCtx.teacherAuthId)!;
    const { data: teacherSignIn, error: teacherSignInErr } =
      await harness.anonClient.auth.signInWithPassword({
        email: teacherUser.email,
        password: "TestPassword123!",
      });
    expect(teacherSignInErr).toBeNull();
    const teacherToken = teacherSignIn.session!.access_token;

    // 2. Create Student 1 and Student 2 enrolled in course
    const student1User = await harness.createTestUser(context, "student");
    const student1Id = randomUUID();
    await harness.serviceClient.from("students").insert({
      id: student1Id,
      auth_id: student1User.authId,
      course_id: courseId,
      name: student1User.name,
      email: student1User.email,
    });
    await harness.serviceClient.from("student_mastery").insert([
      { id: randomUUID(), student_id: student1Id, concept_id: concept1, confidence: 0.0, attempts: 0, version: 1 },
      { id: randomUUID(), student_id: student1Id, concept_id: concept2, confidence: 0.0, attempts: 0, version: 1 },
    ]);

    const { data: student1SignIn, error: student1SignInErr } =
      await harness.anonClient.auth.signInWithPassword({
        email: student1User.email,
        password: "TestPassword123!",
      });
    expect(student1SignInErr).toBeNull();
    const student1Token = student1SignIn.session!.access_token;

    const student2User = await harness.createTestUser(context, "student");
    const student2Id = randomUUID();
    await harness.serviceClient.from("students").insert({
      id: student2Id,
      auth_id: student2User.authId,
      course_id: courseId,
      name: student2User.name,
      email: student2User.email,
    });
    await harness.serviceClient.from("student_mastery").insert([
      { id: randomUUID(), student_id: student2Id, concept_id: concept1, confidence: 0.0, attempts: 0, version: 1 },
      { id: randomUUID(), student_id: student2Id, concept_id: concept2, confidence: 0.0, attempts: 0, version: 1 },
    ]);

    const { data: student2SignIn, error: student2SignInErr } =
      await harness.anonClient.auth.signInWithPassword({
        email: student2User.email,
        password: "TestPassword123!",
      });
    expect(student2SignInErr).toBeNull();
    const student2Token = student2SignIn.session!.access_token;

    // 3. Start a live lecture as Teacher
    const lectureRes = await fetch(`${baseURL}/api/courses/${courseId}/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({
        title: "Optimization & Gradients Lecture",
      }),
    });
    expect(lectureRes.status).toBe(201);
    const lectureData = (await lectureRes.json()) as { id: string };
    const lectureId = lectureData.id;

    // 4. Open Student 1 and Student 2 browser contexts
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.addInitScript((token: string) => {
      (window as unknown as Record<string, unknown>)["__spark_token"] = token;
    }, student1Token);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.addInitScript((token: string) => {
      (window as unknown as Record<string, unknown>)["__spark_token"] = token;
    }, student2Token);

    await page1.goto(`/student/${student1Id}?courseId=${courseId}&lectureId=${lectureId}`);
    await page2.goto(`/student/${student2Id}?courseId=${courseId}&lectureId=${lectureId}`);

    // Wait for both live feeds to connect
    await expect(page1.getByText("Live feed connected")).toBeVisible({ timeout: 15_000 });
    await expect(page2.getByText("Live feed connected")).toBeVisible({ timeout: 15_000 });

    // 5. Teacher generates and activates a poll
    const genPollRes = await fetch(`${baseURL}/api/lectures/${lectureId}/poll/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ conceptId: concept1 }),
    });
    expect(genPollRes.status).toBe(201);
    const genPollData = (await genPollRes.json()) as { id: string };
    const pollId = genPollData.id;

    const activateRes = await fetch(`${baseURL}/api/polls/${pollId}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(activateRes.status).toBe(200);

    // 6. Assert both student dialogs appear in real-time without page reload
    await expect(page1.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await expect(page1.getByRole("heading", { name: "Lecture poll" })).toBeVisible();
    await expect(page1.getByRole("textbox", { name: "Your answer" })).toBeVisible();

    await expect(page2.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await expect(page2.getByRole("heading", { name: "Lecture poll" })).toBeVisible();

    // Verify rubric / expectedAnswer is NEVER leaked to students
    const page1Html = await page1.content();
    expect(page1Html).not.toContain("expectedAnswer");
    expect(page1Html).not.toContain("rubric");

    // 7. Student 1 submits correct answer
    const textarea1 = page1.getByRole("textbox", { name: "Your answer" });
    await textarea1.fill("Large steps overshoot the minimum and diverge.");
    const submitBtn1 = page1.getByRole("button", { name: "Submit answer" });
    await submitBtn1.click();

    // Assert evaluation card renders with Correct badge, feedback, and 85% mastery
    await expect(page1.getByText("Correct", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page1.getByText("Private to you")).toBeVisible();
    await expect(page1.getByRole("button", { name: "Continue lecture" })).toBeVisible();

    // 8. Student 2 submits incorrect answer
    const textarea2 = page2.getByRole("textbox", { name: "Your answer" });
    await textarea2.fill("The learning rate has no effect on the trajectory.");
    const submitBtn2 = page2.getByRole("button", { name: "Submit answer" });
    await submitBtn2.click();

    // Assert evaluation card renders with Incorrect badge and 20% mastery
    await expect(page2.getByText("Incorrect", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page2.getByText("Private to you")).toBeVisible();
    await expect(page2.getByRole("button", { name: "Continue lecture" })).toBeVisible();

    // Verify privacy: Student 1 has not received Student 2's evaluation or answer
    const s1Content = await page1.content();
    expect(s1Content).not.toContain("The learning rate has no effect");
    expect(s1Content).not.toContain("Incorrect");

    // 9. Close modal on Student 1 via Continue lecture
    await page1.getByRole("button", { name: "Continue lecture" }).click();
    await expect(page1.getByRole("dialog")).not.toBeVisible();

    // Verify persistent evaluation card is visible outside modal in the compact section
    await expect(page1.getByText("Correct", { exact: true })).toBeVisible();

    // Verify rail companion returned to lecture mood (calm without active concepts) while evaluation card retains cheer
    await expect(page1.locator('[data-testid="spark-mascot-container"] svg')).toHaveAttribute("data-mood", "calm");
    await expect(page1.locator('svg[data-mood="cheer"]')).toBeVisible();
    // 10. Teacher closes poll
    const closeRes = await fetch(`${baseURL}/api/polls/${pollId}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(closeRes.status).toBe(200);

    // Assert Student 2 modal closes cleanly on poll:closed and persistent evaluation card is visible
    await expect(page2.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });
    await expect(page2.getByText("Incorrect", { exact: true })).toBeVisible();

    // Verify rail companion on Student 2 returned to lecture mood while evaluation card retains oops
    await expect(page2.locator('[data-testid="spark-mascot-container"] svg')).toHaveAttribute("data-mood", "calm");
    await expect(page2.locator('svg[data-mood="oops"]')).toBeVisible();
    await context2.close();
  });
  test("Dismiss draft, reopen, focus containment, closure during in-flight evaluation, and reconnect", async ({
    browser,
    baseURL,
  }) => {
    test.skip(process.env.RUN_LOCAL_SUPABASE !== "1", "Requires RUN_LOCAL_SUPABASE=1");

    harness = new SupabaseTestHarness();
    context = { users: [], teacherIds: [], courseIds: [] };

    const courseCtx = await harness.createTestCourse(context, { conceptCount: 2 });
    const courseId = courseCtx.courseId;
    const concept1 = courseCtx.conceptIds[0]!;

    const teacherUser = context.users.find((u) => u.authId === courseCtx.teacherAuthId)!;
    const { data: teacherSignIn } = await harness.anonClient.auth.signInWithPassword({
      email: teacherUser.email,
      password: "TestPassword123!",
    });
    const teacherToken = teacherSignIn.session!.access_token;

    const studentUser = await harness.createTestUser(context, "student");
    const studentId = randomUUID();
    await harness.serviceClient.from("students").insert({
      id: studentId,
      auth_id: studentUser.authId,
      course_id: courseId,
      name: studentUser.name,
      email: studentUser.email,
    });
    await harness.serviceClient.from("student_mastery").insert([
      { id: randomUUID(), student_id: studentId, concept_id: concept1, confidence: 0.0, attempts: 0, version: 1 },
    ]);

    const { data: studentSignIn } = await harness.anonClient.auth.signInWithPassword({
      email: studentUser.email,
      password: "TestPassword123!",
    });
    const studentToken = studentSignIn.session!.access_token;

    // Start live lecture
    const lectureRes = await fetch(`${baseURL}/api/courses/${courseId}/lectures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({
        title: "Advanced Optimization Techniques",
      }),
    });
    const lectureData = (await lectureRes.json()) as { id: string };
    const lectureId = lectureData.id;

    // Open student page
    const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const studentPage = await studentContext.newPage();
    await studentPage.addInitScript((token: string) => {
      (window as unknown as Record<string, unknown>)["__spark_token"] = token;
    }, studentToken);

    await studentPage.goto(`/student/${studentId}?courseId=${courseId}&lectureId=${lectureId}`);
    await expect(studentPage.getByText("Live feed connected")).toBeVisible({ timeout: 15_000 });

    // Generate and activate poll
    const genPollRes = await fetch(`${baseURL}/api/lectures/${lectureId}/poll/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ conceptId: concept1 }),
    });
    const genPollData = (await genPollRes.json()) as { id: string };
    const pollId = genPollData.id;

    await fetch(`${baseURL}/api/polls/${pollId}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    // 1. Verify modal appears and focus is on textarea
    await expect(studentPage.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    const textarea = studentPage.getByRole("textbox", { name: "Your answer" });
    await expect(textarea).toBeFocused();

    // 2. Draft an answer, then dismiss via Close button
    await textarea.fill("Draft answer: learning rate controls step scale.");
    await studentPage.getByLabel("Close").click();
    await expect(studentPage.getByRole("dialog")).not.toBeVisible();

    // 3. Verify compact 'Answer poll' bar is visible, click it, verify drafted answer restored
    const answerPollBtn = studentPage.getByRole("button", { name: "Answer poll" });
    await expect(answerPollBtn).toBeVisible();
    await answerPollBtn.click();
    await expect(studentPage.getByRole("dialog")).toBeVisible();
    await expect(studentPage.getByRole("textbox", { name: "Your answer" })).toHaveValue(
      "Draft answer: learning rate controls step scale."
    );

    // 4. Test Escape key dismissal
    await studentPage.keyboard.press("Escape");
    await expect(studentPage.getByRole("dialog")).not.toBeVisible();

    // Reopen modal for submission
    await answerPollBtn.click();
    await expect(studentPage.getByRole("dialog")).toBeVisible();

    // 5. Test in-flight closure: hold HTTP respond response using Playwright route
    const { promise: responseGate, resolve: releaseResponse } = Promise.withResolvers<void>();

    await studentPage.route(`**/api/polls/${pollId}/respond`, async (route) => {
      const response = await route.fetch();
      await responseGate;
      await route.fulfill({ response });
    });

    // Click submit
    await studentPage.getByRole("button", { name: "Submit answer" }).click();
    await expect(studentPage.getByText("Evaluating…")).toBeVisible();

    // While response is held in-flight, teacher closes poll
    await fetch(`${baseURL}/api/polls/${pollId}/close`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    // Assert dialog closed immediately on poll:closed without waiting for response
    await expect(studentPage.getByRole("dialog")).not.toBeVisible({ timeout: 5000 });

    // Release the response gate
    releaseResponse();

    // Verify private evaluation card appears outside dialog with result
    await expect(studentPage.getByText("Private to you")).toBeVisible({ timeout: 10_000 });

    // 6. Test reconnect with a second active poll and idempotent same-answer submission
    const genPoll2Res = await fetch(`${baseURL}/api/lectures/${lectureId}/poll/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teacherToken}`,
      },
      body: JSON.stringify({ conceptId: concept1 }),
    });
    const genPoll2Data = (await genPoll2Res.json()) as { id: string };
    const poll2Id = genPoll2Data.id;

    await fetch(`${baseURL}/api/polls/${poll2Id}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    // Reload student page while poll 2 is active
    await studentPage.reload();
    await expect(studentPage.getByText("Live feed connected")).toBeVisible({ timeout: 15_000 });

    // Assert active poll modal automatically recovers on reload
    await expect(studentPage.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await expect(studentPage.getByRole("heading", { name: "Lecture poll" })).toBeVisible();

    // Submit an answer
    const textarea2 = studentPage.getByRole("textbox", { name: "Your answer" });
    await textarea2.fill("Gradient descent adjusts parameters proportional to the negative gradient.");
    await studentPage.getByRole("button", { name: "Submit answer" }).click();
    await expect(studentPage.getByRole("button", { name: "Continue lecture" })).toBeVisible({ timeout: 10_000 });

    // Resubmitting same answer returns stored evaluation (200) without extra attempt
    const idempotentRes = await fetch(`${baseURL}/api/polls/${poll2Id}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ answer: "Gradient descent adjusts parameters proportional to the negative gradient." }),
    });
    expect(idempotentRes.status).toBe(200);

    await studentContext.close();
  });
});
