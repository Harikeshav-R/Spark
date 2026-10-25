import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import {
  SupabaseTestHarness,
  type TestContext,
} from "../integration/lane-a/supabase-harness.js";

function waitForConnect(socket: ClientSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.once("connect", () => resolve());
  socket.once("connect_error", (err) => reject(err));
  return promise;
}

function emitWithAck<T = { success: boolean; error?: string }>(
  socket: ClientSocket,
  event: string,
  payload: unknown
): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.emit(event, payload, (res: T) => resolve(res));
  return promise;
}

test.describe("P4-D-01: Teacher Formative Polls & Class Mastery Heatmap E2E", () => {
  let harness: SupabaseTestHarness;
  let context: TestContext;
  const activeSockets: ClientSocket[] = [];

  test.afterEach(async () => {
    for (const s of activeSockets) {
      if (s.connected) s.disconnect();
    }
    activeSockets.length = 0;

    if (context && harness) {
      await harness.cleanup(context);
    }
  });

  test("Teacher can generate, edit, activate, monitor responses in real-time, and close polls", async ({
    page,
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

    const { data: student1SignIn } = await harness.anonClient.auth.signInWithPassword({
      email: student1User.email,
      password: "TestPassword123!",
    });
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

    const { data: student2SignIn } = await harness.anonClient.auth.signInWithPassword({
      email: student2User.email,
      password: "TestPassword123!",
    });
    const student2Token = student2SignIn.session!.access_token;

    // 3. Inject actual JWT into teacher browser session
    await page.addInitScript((token: string) => {
      (window as unknown as Record<string, unknown>)["__spark_token"] = token;
    }, teacherToken);

    // 4. Open Teacher Dashboard for this course
    await page.goto(`/professor/dashboard?courseId=${courseId}`);

    // Assert dashboard loaded and sign in prompt does not appear
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Course mastery" })).toBeVisible();

    // 5. Start a live lecture
    const lectureTitleInput = page.getByLabel("Lecture title");
    await lectureTitleInput.fill("Convex Optimization & Descent");
    await page.getByRole("button", { name: "Start lecture" }).click();

    // Verify live session started
    await expect(page.getByText("Live Session")).toBeVisible();
    await expect(page.getByRole("button", { name: "End lecture" })).toBeVisible();

    // Extract lectureId from current URL
    await page.waitForURL((url) => url.searchParams.has("lectureId"));
    const currentUrl = new URL(page.url());
    const lectureId = currentUrl.searchParams.get("lectureId")!;
    expect(lectureId).toBeTruthy();

    // 6. Select a concept and generate a draft poll
    const conceptSelect = page.getByLabel("Topic Concept");
    await conceptSelect.selectOption(concept1);

    const generateBtn = page.getByRole("button", { name: "Generate poll" });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();
    // 7. Verify Draft Poll section appears with Question and Rubric fields
    await expect(page.getByText("Draft Poll")).toBeVisible();
    const questionInput = page.getByLabel("Question");
    const rubricInput = page.getByLabel("Expected answer / rubric");
    await expect(questionInput).toBeVisible();
    await expect(rubricInput).toBeVisible();
    await expect(page.getByText("Teacher only")).toBeVisible();

    // 8. Edit question and rubric, then Save Draft
    const updatedQuestion = "How does the learning rate affect gradient descent convergence?";
    const updatedRubric = "Large learning rates oscillate and diverge; small learning rates converge too slowly.";

    await questionInput.fill(updatedQuestion);
    await rubricInput.fill(updatedRubric);

    const saveDraftBtn = page.getByRole("button", { name: "Save draft" });
    await expect(saveDraftBtn).toBeEnabled();
    await saveDraftBtn.click();

    // 9. Reload page and assert saved draft persisted
    await page.reload();
    await expect(page.getByText("Draft Poll")).toBeVisible();
    await expect(page.getByLabel("Question")).toHaveValue(updatedQuestion);
    await expect(page.getByLabel("Expected answer / rubric")).toHaveValue(updatedRubric);

    // 10. Activate poll
    const activateBtn = page.getByRole("button", { name: "Activate poll" });
    await activateBtn.click();

    // Assert Active Poll section is visible
    await expect(page.getByText("Current Active Poll")).toBeVisible();
    await expect(page.getByText("0 responses received")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close poll" })).toBeVisible();

    // Find poll ID via API
    const pollsSnapshotRes = await fetch(`${baseURL}/api/lectures/${lectureId}/polls`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    const pollsSnapshot = (await pollsSnapshotRes.json()) as { active: { poll: { id: string } } };
    const pollId = pollsSnapshot.active.poll.id;

    // 11. Connect both student sockets and join lecture
    const student1Socket = ioc(baseURL!, {
      auth: { token: student1Token },
      transports: ["websocket"],
    });
    activeSockets.push(student1Socket);
    await waitForConnect(student1Socket);
    await emitWithAck(student1Socket, "lecture:join", { lectureId });
    const student2Socket = ioc(baseURL!, {
      auth: { token: student2Token },
      transports: ["websocket"],
    });
    activeSockets.push(student2Socket);
    await waitForConnect(student2Socket);
    await emitWithAck(student2Socket, "lecture:join", { lectureId });

    // 12. Submit response for Student 1
    const ans1 = "Large steps overshoot the minimum and diverge.";
    const resp1 = await fetch(`${baseURL}/api/polls/${pollId}/respond`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${student1Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answer: ans1 }),
    });
    expect(resp1.status).toBe(200);

    // Verify teacher page counter updates to "1 response received" without reload
    await expect(page.getByText("1 response received")).toBeVisible();

    // 13. Submit response for Student 2
    const ans2 = "The learning rate has no effect on the trajectory.";
    const resp2 = await fetch(`${baseURL}/api/polls/${pollId}/respond`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${student2Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answer: ans2 }),
    });
    expect(resp2.status).toBe(200);

    // Verify counter updates to "2 responses received" without reload
    await expect(page.getByText("2 responses received")).toBeVisible();

    // 14. Verify Heatmap reflects evaluations (50% red, 50% green for 2 students)
    await expect(page.getByText("Needs practice: 1 (50.0%)")).toBeVisible();
    await expect(page.getByText("Mastered: 1 (50.0%)")).toBeVisible();

    // 15. Duplicate submission by Student 1: count remains 2
    const dupResp = await fetch(`${baseURL}/api/polls/${pollId}/respond`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${student1Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answer: ans1 }),
    });
    expect(dupResp.status).toBe(200);
    await expect(page.getByText("2 responses received")).toBeVisible();

    // 16. Teacher closes poll
    const closeBtn = page.getByRole("button", { name: "Close poll" });
    await closeBtn.click();

    // Active poll section disappears, closed poll summary appears
    await expect(page.getByText("Current Active Poll")).not.toBeVisible();
    await expect(page.getByText("Previous Poll")).toBeVisible();
    await expect(page.getByText("Closed")).toBeVisible();
  });

  test("Zero enrollment course displays empty heatmap status and generation failure alerts gracefully", async ({
    page,
  }) => {
    test.skip(process.env.RUN_LOCAL_SUPABASE !== "1", "Requires RUN_LOCAL_SUPABASE=1");

    harness = new SupabaseTestHarness();
    context = { users: [], teacherIds: [], courseIds: [] };

    // Course with 1 concept, 0 students
    const courseCtx = await harness.createTestCourse(context, { conceptCount: 1 });
    const courseId = courseCtx.courseId;

    const teacherUser = context.users.find((u: { authId: string }) => u.authId === courseCtx.teacherAuthId)!;
    const { data: teacherSignIn } = await harness.anonClient.auth.signInWithPassword({
      email: teacherUser.email,
      password: "TestPassword123!",
    });
    const teacherToken = teacherSignIn.session!.access_token;

    await page.addInitScript((token: string) => {
      (window as unknown as Record<string, unknown>)["__spark_token"] = token;
    }, teacherToken);

    await page.goto(`/professor/dashboard?courseId=${courseId}`);

    // Assert zero students message
    await expect(page.getByText("No enrolled students yet.")).toBeVisible();

    // Start lecture
    const lectureTitleInput = page.getByLabel("Lecture title");
    await lectureTitleInput.fill("Zero Enrollment Lecture");
    await page.getByRole("button", { name: "Start lecture" }).click();
    await expect(page.getByText("Live Session")).toBeVisible();

    // Attempt generation without detected concepts when "Use recently detected concept" is chosen
    const generateBtn = page.getByRole("button", { name: "Generate poll" });
    await generateBtn.click();

    // Verify inline error alert appears
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Select a concept or wait for lecture concept detection.")).toBeVisible();
  });
});
