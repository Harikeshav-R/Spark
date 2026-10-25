import { randomUUID } from "node:crypto";
import type { JourneyFixture } from "./journey-fixture";
import { signIn } from "./journey-actions";

export interface J09ScenarioResult {
  courseId: string;
  conceptIds: string[];
  orderedConceptIds: string[];
  conceptLabelsById: Map<string, string>;
  todayUtcDate: string;
}

export interface J10ScenarioResult {
  courseId: string;
  attentionId: string;
  transformersId: string;
  vectorsId: string;
  conceptIdsByLabel: Map<string, string>;
}

export interface J11ScenarioResult {
  courseId: string;
  backpropId: string;
  compGraphsId: string;
  vectorsId: string;
}

/**
 * Sets up an isolated 3-root course DAG for J09:
 * Backpropagation, Derivatives, Computational Graphs.
 * Enrolls Rahul with 0.20 confidence on each concept.
 * Seeds completed daily quests only on UTC D-2 and D-1 (streak 2).
 * Seeds no D quest and no practice XP on D.
 */
export async function setupJ09Scenario(
  journey: JourneyFixture
): Promise<J09ScenarioResult> {
  const supabase = journey.supabase;
  const now = journey.now;
  const d = now.toISOString().slice(0, 10);
  const dMinus1 = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const dMinus2 = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);

  // 1. Create teacher & course
  const testContext = { users: [], teacherIds: [], courseIds: [] };
  const teacherUser = await supabase.createTestUser(testContext, "teacher", {
    name: "Prof. Chen",
  });
  journey.trackAuthUserId(teacherUser.authId);

  const teacherId = randomUUID();
  await supabase.serviceClient.from("teachers").insert({
    id: teacherId,
    auth_id: teacherUser.authId,
    name: teacherUser.name,
    email: teacherUser.email,
  });
  journey.trackTeacherId(teacherId);

  const courseId = randomUUID();
  const joinCode = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  await supabase.serviceClient.from("courses").insert({
    id: courseId,
    teacher_id: teacherId,
    name: "CS229 J09 Quests",
    description: "Daily Quests and Hint Progression",
    join_code: joinCode,
  });
  journey.trackCourseId(courseId);
  journey.courseId = courseId;
  journey.joinCode = joinCode;

  // 2. Create exactly 3 root concepts (no edges)
  const conceptLabels = ["Backpropagation", "Derivatives", "Computational Graphs"];
  const conceptIds: string[] = [];
  const conceptLabelsById = new Map<string, string>();

  for (const label of conceptLabels) {
    const cId = randomUUID();
    conceptIds.push(cId);
    conceptLabelsById.set(cId, label);
    journey.conceptIdsByLabel.set(label, cId);

    await supabase.serviceClient.from("concept_nodes").insert({
      id: cId,
      course_id: courseId,
      label,
      description: `Core concept definition for ${label}`,
      category: "Foundations",
      difficulty: 3,
      created_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
    });
  }

  // 3. Create and enroll Rahul
  const rahulUser = await supabase.createTestUser(testContext, "student", {
    name: "Rahul",
  });
  journey.trackAuthUserId(rahulUser.authId);

  const rahulStudentId = randomUUID();
  await supabase.serviceClient.from("students").insert({
    id: rahulStudentId,
    auth_id: rahulUser.authId,
    course_id: courseId,
    name: rahulUser.name,
    email: rahulUser.email,
    created_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
  });
  journey.trackStudentId(rahulStudentId);
  journey.rahul.studentId = rahulStudentId;

  // Insert initial mastery: confidence 0.20 on each of the 3 concepts
  for (const cId of conceptIds) {
    await supabase.serviceClient.from("student_mastery").insert({
      id: randomUUID(),
      student_id: rahulStudentId,
      concept_id: cId,
      confidence: 0.2,
      attempts: 0,
      version: 1,
      last_updated: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
    });
  }

  // 4. Seed completed daily quests on D-2 and D-1 with 25-XP clear events
  const questD2Id = randomUUID();
  await supabase.serviceClient.from("daily_quests").insert({
    id: questD2Id,
    student_id: rahulStudentId,
    quest_date: dMinus2,
    concept_ids: conceptIds,
    completed_ids: conceptIds,
    cleared_at: `${dMinus2}T12:00:00.000Z`,
    version: 4,
    created_at: `${dMinus2}T08:00:00.000Z`,
    updated_at: `${dMinus2}T12:00:00.000Z`,
  });

  await supabase.serviceClient.from("xp_events").insert({
    student_id: rahulStudentId,
    amount: 25,
    reason: "quest_cleared",
    source_id: questD2Id,
    award_date: dMinus2,
    created_at: `${dMinus2}T12:00:00.000Z`,
  });

  const questD1Id = randomUUID();
  await supabase.serviceClient.from("daily_quests").insert({
    id: questD1Id,
    student_id: rahulStudentId,
    quest_date: dMinus1,
    concept_ids: conceptIds,
    completed_ids: conceptIds,
    cleared_at: `${dMinus1}T12:00:00.000Z`,
    version: 4,
    created_at: `${dMinus1}T08:00:00.000Z`,
    updated_at: `${dMinus1}T12:00:00.000Z`,
  });

  await supabase.serviceClient.from("xp_events").insert({
    student_id: rahulStudentId,
    amount: 25,
    reason: "quest_cleared",
    source_id: questD1Id,
    award_date: dMinus1,
    created_at: `${dMinus1}T12:00:00.000Z`,
  });

  // Predicted order: concept UUID ascending
  const orderedConceptIds = [...conceptIds].sort();

  // Sign in Rahul
  const rahulLogin = await signIn(journey.harness.rahul.page, {
    email: rahulUser.email,
    password: "TestPassword123!",
  });
  journey.rahul = {
    user: rahulLogin.user,
    session: rahulLogin.session,
    studentId: rahulStudentId,
    password: "TestPassword123!",
  };

  return {
    courseId,
    conceptIds,
    orderedConceptIds,
    conceptLabelsById,
    todayUtcDate: d,
  };
}

/**
 * Sets up an isolated 3-root course DAG for J10:
 * Attention Mechanisms (.35), Transformers (.50), Vectors (.89) for Hari.
 * Whole course mean: exactly 0.58.
 * Upcoming exam in 10 days.
 */
export async function setupJ10Scenario(
  journey: JourneyFixture
): Promise<J10ScenarioResult> {
  const supabase = journey.supabase;
  const now = journey.now;
  const examAt = new Date(now.getTime() + 10 * 86_400_000).toISOString();

  const testContext = { users: [], teacherIds: [], courseIds: [] };
  const teacherUser = await supabase.createTestUser(testContext, "teacher", {
    name: "Prof. Chen",
  });
  journey.trackAuthUserId(teacherUser.authId);

  const teacherId = randomUUID();
  await supabase.serviceClient.from("teachers").insert({
    id: teacherId,
    auth_id: teacherUser.authId,
    name: teacherUser.name,
    email: teacherUser.email,
  });
  journey.trackTeacherId(teacherId);

  const courseId = randomUUID();
  const joinCode = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  await supabase.serviceClient.from("courses").insert({
    id: courseId,
    teacher_id: teacherId,
    name: "CS229 J10 Eclipse",
    description: "Eclipse Pressure and Mascot Evolution",
    join_code: joinCode,
    exam_at: examAt,
  });
  journey.trackCourseId(courseId);
  journey.courseId = courseId;
  journey.joinCode = joinCode;

  const conceptData = [
    { label: "Attention Mechanisms", confidence: 0.35 },
    { label: "Transformers", confidence: 0.5 },
    { label: "Vectors", confidence: 0.89 },
  ];

  const conceptIdsByLabel = new Map<string, string>();
  let attentionId = "";
  let transformersId = "";
  let vectorsId = "";

  for (const c of conceptData) {
    const cId = randomUUID();
    conceptIdsByLabel.set(c.label, cId);
    journey.conceptIdsByLabel.set(c.label, cId);

    if (c.label === "Attention Mechanisms") attentionId = cId;
    if (c.label === "Transformers") transformersId = cId;
    if (c.label === "Vectors") vectorsId = cId;

    await supabase.serviceClient.from("concept_nodes").insert({
      id: cId,
      course_id: courseId,
      label: c.label,
      description: `Core concept description for ${c.label}`,
      category: "Architectures",
      difficulty: 4,
      created_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
    });
  }

  // Create and enroll Hari
  const hariUser = await supabase.createTestUser(testContext, "student", {
    name: "Hari",
  });
  journey.trackAuthUserId(hariUser.authId);

  const hariStudentId = randomUUID();
  await supabase.serviceClient.from("students").insert({
    id: hariStudentId,
    auth_id: hariUser.authId,
    course_id: courseId,
    name: hariUser.name,
    email: hariUser.email,
    created_at: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
  });
  journey.trackStudentId(hariStudentId);
  journey.hari.studentId = hariStudentId;

  // Insert masteries
  for (const c of conceptData) {
    const cId = conceptIdsByLabel.get(c.label)!;
    await supabase.serviceClient.from("student_mastery").insert({
      id: randomUUID(),
      student_id: hariStudentId,
      concept_id: cId,
      confidence: c.confidence,
      attempts: 0,
      version: 1,
      last_updated: new Date(now.getTime() - 86_400_000).toISOString(),
    });
  }

  // Sign in Hari and Teacher
  const teacherLogin = await signIn(journey.harness.teacher.page, {
    email: teacherUser.email,
    password: "TestPassword123!",
  });
  journey.teacher = {
    user: teacherLogin.user,
    session: teacherLogin.session,
    password: "TestPassword123!",
  };

  const hariLogin = await signIn(journey.harness.hari.page, {
    email: hariUser.email,
    password: "TestPassword123!",
  });
  journey.hari = {
    user: hariLogin.user,
    session: hariLogin.session,
    studentId: hariStudentId,
    password: "TestPassword123!",
  };

  return {
    courseId,
    attentionId,
    transformersId,
    vectorsId,
    conceptIdsByLabel,
  };
}

/**
 * Sets up canonical demo dataset for J11:
 * Adds one historical perfect Rahul Vectors encounter on D-5 with 150-XP practice event,
 * making Rahul initial effort 658 vs Hari 620.
 */
export async function setupJ11Scenario(
  journey: JourneyFixture
): Promise<J11ScenarioResult> {
  await journey.initCanonicalDemo();

  const supabase = journey.supabase;
  const now = journey.now;
  const dMinus5 = new Date(now.getTime() - 5 * 86_400_000).toISOString();
  const dMinus5Date = dMinus5.slice(0, 10);

  const vectorsId = journey.conceptIdsByLabel.get("Vectors")!;
  const backpropId = journey.conceptIdsByLabel.get("Backpropagation")!;
  const compGraphsId = journey.conceptIdsByLabel.get("Computational Graphs")!;

  // 1. Create historical Rahul Vectors encounter on D-5
  const encounterId = randomUUID();
  const attemptId = randomUUID();

  await supabase.serviceClient.from("encounters").insert({
    id: encounterId,
    student_id: journey.rahul.studentId,
    concept_id: vectorsId,
    source: "practice",
    status: "completed",
    question_ids: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    hints_used: {},
    created_at: dMinus5,
    completed_at: dMinus5,
  });

  await supabase.serviceClient.from("quiz_attempts").insert({
    id: attemptId,
    student_id: journey.rahul.studentId,
    concept_id: vectorsId,
    encounter_id: encounterId,
    score: 1.0,
    correct_count: 5,
    total_questions: 5,
    submitted_at: dMinus5,
  });

  await supabase.serviceClient.from("mastery_evidence").insert({
    id: randomUUID(),
    student_id: journey.rahul.studentId,
    concept_id: vectorsId,
    evidence_type: "quiz",
    source_id: attemptId,
    prior_confidence: 0.45,
    new_confidence: 0.6,
    recorded_at: dMinus5,
  });

  // 150-XP practice ledger entry brings Rahul's initial effort to 658
  await supabase.serviceClient.from("xp_events").insert({
    student_id: journey.rahul.studentId,
    amount: 150,
    reason: "encounter",
    source_id: attemptId,
    award_date: dMinus5Date,
    concept_id: vectorsId,
    created_at: dMinus5,
  });

  return {
    courseId: journey.courseId,
    backpropId,
    compGraphsId,
    vectorsId,
  };
}
