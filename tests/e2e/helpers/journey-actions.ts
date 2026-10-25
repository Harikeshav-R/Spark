import type { Page, Response as PlaywrightResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { SupabaseTestHarness } from "../../integration/lane-a/supabase-harness";
import type { JourneyFixture } from "./journey-fixture";
export interface SignInResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: "teacher" | "student";
  };
  session: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  };
}

/**
 * Sign in a user through the landing page form (/), submitting credentials
 * and capturing the authoritative /api/auth/login response.
 */
export async function signIn(
  page: Page,
  account: { email: string; password?: string }
): Promise<SignInResult> {
  const password = account.password || "DemoPass123!";

  await page.goto("/");
  await page.waitForSelector("#auth-email", { state: "visible" });

  const loginResponsePromise = page.waitForResponse(
    (res: PlaywrightResponse) =>
      res.url().includes("/api/auth/login") &&
      res.request().method() === "POST"
  );

  await page.fill("#auth-email", account.email);
  await page.fill("#auth-password", password);
  await page.click('button:has-text("Sign in")');

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBe(true);

  const rawJson: unknown = await loginResponse.json();
  if (
    !rawJson ||
    typeof rawJson !== "object" ||
    !("user" in rawJson) ||
    !("session" in rawJson)
  ) {
    throw new Error(
      `Invalid login response payload: ${JSON.stringify(rawJson)}`
    );
  }

  const user = (rawJson as { user: SignInResult["user"] }).user;
  const session = (rawJson as { session: SignInResult["session"] }).session;

  // Register session across all pages and navigations within this context
  await page.context().addInitScript((s) => {
    const fn = (
      window as unknown as {
        __spark_set_session?: (sess: unknown) => void;
      }
    ).__spark_set_session;
    if (fn) fn(s);
  }, session);

  // Wait for SignInForm to complete its post-login navigation
  await page
    .waitForURL((url) => url.pathname !== "/", { timeout: 15_000 })
    .catch(() => {});

  return { user, session };
}
/**
 * Generates an 11-page PDF buffer containing extractable syllabus text
 * to test pagination limits and truncation disclosure.
 */
export async function create11PageSyllabusPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < 11; i++) {
    const page = doc.addPage([600, 800]);
    page.drawText(
      `CS229 Machine Learning Syllabus - Section ${i + 1}\nPrerequisite Graph & Concept Breakdown\nTopic: Backpropagation and Computational Graphs`,
      {
        x: 50,
        y: 700,
        font,
        size: 14,
      }
    );
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/**
 * Starts a lecture through the professor dashboard UI and captures the real lecture response.
 */
export async function startLecture(
  journey: JourneyFixture,
  title: string
): Promise<{ lectureId: string; title: string }> {
  const page = journey.harness.teacher.page;
  await page.goto(`/professor/dashboard?courseId=${journey.courseId}`);
  await page.waitForSelector("#lecture-title-input", { state: "visible" });

  const startResponsePromise = page.waitForResponse(
    (res: PlaywrightResponse) =>
      res.url().includes(`/api/courses/${journey.courseId}/lectures`) &&
      res.request().method() === "POST"
  );

  await page.fill("#lecture-title-input", title);
  await page.click('button:has-text("Start lecture")');

  const startResponse = await startResponsePromise;
  expect(startResponse.ok()).toBe(true);

  const data: unknown = await startResponse.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    typeof data.id !== "string"
  ) {
    throw new Error(
      `Invalid start lecture response payload: ${JSON.stringify(data)}`
    );
  }

  const lecture = data as { id: string; title?: string };
  return { lectureId: lecture.id, title: lecture.title || title };
}

/**
 * Ingests a transcript chunk via teacher-authenticated HTTP API.
 */
export async function ingestTranscript(
  journey: JourneyFixture,
  lectureId: string,
  text: string,
  timestampSec: number
): Promise<{ chunkId: string; detectedConceptIds: string[] }> {
  const res = await fetch(
    `${journey.baseURL}/api/lectures/${lectureId}/transcript`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${journey.teacher.session.accessToken}`,
      },
      body: JSON.stringify({
        text,
        timestampSec,
        speakerName: "Prof. Chen",
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Ingest transcript failed: HTTP ${res.status} ${errText}`
    );
  }

  const data: unknown = await res.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("chunkId" in data) ||
    typeof data.chunkId !== "string"
  ) {
    throw new Error(
      `Invalid ingest transcript response: ${JSON.stringify(data)}`
    );
  }

  const chunkId = data.chunkId;
  const detectedConceptIds =
    "detectedConceptIds" in data && Array.isArray(data.detectedConceptIds)
      ? (data.detectedConceptIds as string[])
      : [];

  return { chunkId, detectedConceptIds };
}

/**
 * Resolves the exact displayed option index for the correct answer
 * of each question in an encounter using Node-only persisted database keys.
 */
export async function getEncounterCorrectOptions(
  supabase: SupabaseTestHarness,
  encounterId: string
): Promise<number[]> {
  const { data: enc, error: encErr } = await supabase.serviceClient
    .from("encounters")
    .select("option_permutations, question_ids")
    .eq("id", encounterId)
    .single();

  if (encErr || !enc) {
    throw new Error(
      `Failed to load encounter for answer resolution: ${encErr?.message}`
    );
  }

  const questionIds = enc.question_ids as string[];
  const { data: questions, error: qErr } = await supabase.serviceClient
    .from("concept_quiz_questions")
    .select("id, correct_answer")
    .in("id", questionIds);

  if (qErr || !questions) {
    throw new Error(
      `Failed to load questions for answer resolution: ${qErr?.message}`
    );
  }

  const perms = enc.option_permutations as
    | Record<string, number[]>
    | number[][];
  return questionIds.map((qId: string, i: number) => {
    const q = questions.find((row) => row.id === qId);
    if (!q) throw new Error(`Missing question ${qId}`);
    const perm = Array.isArray(perms)
      ? perms[i]
      : perms[String(i + 1)] || perms[String(i)];
    if (!perm) return q.correct_answer;
    return perm.indexOf(q.correct_answer);
  });
}
