import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readDemoConfig, type DemoConfig } from "./config.js";
import {
  buildDemoDataset,
  validateDemoCurriculum,
  DEMO_PASSWORD,
  DEFAULT_DEMO_NAMESPACE,
  type DemoDataset,
} from "./dataset.js";

export interface DemoSeedResult {
  courseId: string;
  conceptCount: number;
  edgeCount: number;
  studentCount: number;
  masteryCount: number;
  elapsedMs: number;
}

function escapeSqlStr(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

function formatSqlVal(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) throw new Error(`Non-finite number in SQL: ${val}`);
    return val.toString();
  }
  return escapeSqlStr(val);
}

function formatSqlJson(obj: unknown): string {
  return escapeSqlStr(JSON.stringify(obj)) + "::jsonb";
}

function formatSqlUuidArray(arr: string[]): string {
  if (arr.length === 0) return "'{}'::uuid[]";
  const items = arr.map((id) => escapeSqlStr(id)).join(", ");
  return `ARRAY[${items}]::uuid[]`;
}

function createSupabaseAdminClient(config: DemoConfig, serviceRoleKey: string): SupabaseClient {
  return createClient(config.supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function provisionDemoAuthUsers(
  adminClient: SupabaseClient,
  dataset: DemoDataset,
): Promise<void> {
  for (const user of dataset.authUsers) {
    const { data: existingUser, error: fetchErr } = await adminClient.auth.admin.getUserById(
      user.id,
    );

    if (existingUser?.user) {
      const u = existingUser.user;
      const isDemo = u.app_metadata?.demo === true;
      if (!isDemo || u.email !== user.email) {
        throw new Error(
          `Auth ID conflict: existing user ${user.id} has email '${u.email}', expected demo user '${user.email}'`,
        );
      }

      // Restore password and name
      const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
        password: DEMO_PASSWORD,
        user_metadata: { name: user.name },
        app_metadata: { demo: true },
      });
      if (updateErr) {
        throw new Error(`Failed to update demo user ${user.email}: ${updateErr.message}`);
      }
    } else {
      // Check if another user owns this email
      if (fetchErr && !fetchErr.message.toLowerCase().includes("not found")) {
        // Continue to create or verify
      }

      const { error: createErr } = await adminClient.auth.admin.createUser({
        id: user.id,
        email: user.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { name: user.name },
        app_metadata: { demo: true },
      });

      if (createErr) {
        throw new Error(`Failed to provision demo user ${user.email}: ${createErr.message}`);
      }
    }
  }
}

async function verifyPreexistingAuthUsers(
  adminClient: SupabaseClient,
  dataset: DemoDataset,
): Promise<void> {
  for (const user of dataset.authUsers) {
    const { data: existing, error } = await adminClient.auth.admin.getUserById(user.id);
    if (error || !existing?.user || existing.user.email !== user.email) {
      throw new Error(
        `Preexisting verified demo identities required for reset. User ${user.email} missing. Run npm run db:seed first.`,
      );
    }
  }
}

export function buildSeedSqlTransaction(dataset: DemoDataset): string {
  const statements: string[] = [];

  statements.push("BEGIN;");
  statements.push(
    `SELECT pg_advisory_xact_lock(hashtext('spark-demo-seed-lock:' || ${escapeSqlStr(dataset.scope.namespace)}));`,
  );

  // Preflight checks
  statements.push(`
DO $$
DECLARE
  v_existing_teacher UUID;
BEGIN
  SELECT teacher_id INTO v_existing_teacher FROM public.courses WHERE id = ${escapeSqlStr(dataset.course.id)};
  IF v_existing_teacher IS NOT NULL AND v_existing_teacher <> ${escapeSqlStr(dataset.teacher.id)} THEN
    RAISE EXCEPTION 'Demo course % is owned by a different teacher %', ${escapeSqlStr(dataset.course.id)}, v_existing_teacher;
  END IF;

  IF EXISTS (SELECT 1 FROM public.courses WHERE join_code = ${escapeSqlStr(dataset.course.joinCode)} AND id <> ${escapeSqlStr(dataset.course.id)}) THEN
    RAISE EXCEPTION 'Demo join code % is in use by another course', ${escapeSqlStr(dataset.course.joinCode)};
  END IF;

  IF EXISTS (SELECT 1 FROM public.teachers WHERE (auth_id = ${escapeSqlStr(dataset.teacher.authId)} OR email = ${escapeSqlStr(dataset.teacher.email)}) AND id <> ${escapeSqlStr(dataset.teacher.id)}) THEN
    RAISE EXCEPTION 'Teacher identity collision for %', ${escapeSqlStr(dataset.teacher.email)};
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE course_id = ${escapeSqlStr(dataset.course.id)}
      AND id NOT IN (${dataset.students.map((s) => escapeSqlStr(s.id)).join(", ")})
  ) THEN
    RAISE EXCEPTION 'Course % has unexpected non-demo enrollments', ${escapeSqlStr(dataset.course.id)};
  END IF;
END $$;
`);

  // Clear existing demo course data (FK restrict on quiz_attempt in party_quest_progress)
  statements.push(`
DELETE FROM public.party_quest_progress
WHERE party_quest_id IN (
  SELECT pq.id FROM public.party_quests pq
  JOIN public.study_group_matches sgm ON sgm.id = pq.match_id
  WHERE sgm.course_id = ${escapeSqlStr(dataset.course.id)}
);
`);

  // Delete course cascades everything else
  statements.push(`DELETE FROM public.courses WHERE id = ${escapeSqlStr(dataset.course.id)};`);

  // Upsert teacher
  statements.push(`
INSERT INTO public.teachers (id, auth_id, name, email, created_at)
VALUES (${escapeSqlStr(dataset.teacher.id)}, ${escapeSqlStr(dataset.teacher.authId)}, ${escapeSqlStr(dataset.teacher.name)}, ${escapeSqlStr(dataset.teacher.email)}, ${escapeSqlStr(dataset.teacher.createdAt)})
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email;
`);

  // Insert course
  statements.push(`
INSERT INTO public.courses (id, teacher_id, name, description, join_code, created_at, exam_at)
VALUES (${escapeSqlStr(dataset.course.id)}, ${escapeSqlStr(dataset.course.teacherId)}, ${escapeSqlStr(dataset.course.name)}, ${escapeSqlStr(dataset.course.description)}, ${escapeSqlStr(dataset.course.joinCode)}, ${escapeSqlStr(dataset.course.createdAt)}, ${escapeSqlStr(dataset.course.examAt)});
`);

  // Insert concepts
  const conceptRows = dataset.concepts
    .map(
      (c) =>
        `(${escapeSqlStr(c.id)}, ${escapeSqlStr(c.courseId)}, ${escapeSqlStr(c.label)}, ${escapeSqlStr(c.description)}, ${escapeSqlStr(c.category)}, ${c.difficulty}, ${escapeSqlStr(c.createdAt)})`,
    )
    .join(",\n");
  statements.push(`
INSERT INTO public.concept_nodes (id, course_id, label, description, category, difficulty, created_at)
VALUES
${conceptRows};
`);

  // Insert edges
  const edgeRows = dataset.edges
    .map(
      (e) =>
        `(${escapeSqlStr(e.id)}, ${escapeSqlStr(e.courseId)}, ${escapeSqlStr(e.sourceId)}, ${escapeSqlStr(e.targetId)}, ${escapeSqlStr(e.relationship)}, ${escapeSqlStr(e.createdAt)})`,
    )
    .join(",\n");
  statements.push(`
INSERT INTO public.concept_edges (id, course_id, source_id, target_id, relationship, created_at)
VALUES
${edgeRows};
`);

  // Insert students
  const studentRows = dataset.students
    .map(
      (s) =>
        `(${escapeSqlStr(s.id)}, ${escapeSqlStr(s.authId)}, ${escapeSqlStr(s.courseId)}, ${escapeSqlStr(s.name)}, ${escapeSqlStr(s.email)}, ${escapeSqlStr(s.createdAt)})`,
    )
    .join(",\n");
  statements.push(`
INSERT INTO public.students (id, auth_id, course_id, name, email, created_at)
VALUES
${studentRows};
`);

  // Insert student mastery (132 rows)
  const masteryRows = dataset.mastery
    .map(
      (m) =>
        `(${escapeSqlStr(m.id)}, ${escapeSqlStr(m.studentId)}, ${escapeSqlStr(m.conceptId)}, ${m.confidence}, ${m.attempts}, ${m.version}, ${escapeSqlStr(m.lastUpdated)})`,
    )
    .join(",\n");
  statements.push(`
INSERT INTO public.student_mastery (id, student_id, concept_id, confidence, attempts, version, last_updated)
VALUES
${masteryRows};
`);

  // Insert concept quiz questions (Vectors bank)
  const questionRows = dataset.quizQuestions
    .map(
      (q) =>
        `(${escapeSqlStr(q.id)}, ${escapeSqlStr(q.conceptId)}, ${escapeSqlStr(q.question)}, ${escapeSqlStr(q.optionA)}, ${escapeSqlStr(q.optionB)}, ${escapeSqlStr(q.optionC)}, ${escapeSqlStr(q.optionD)}, ${q.correctAnswer}, ${escapeSqlStr(q.explanation)}, ${q.questionOrder}, ${formatSqlJson(q.hints)}, ${escapeSqlStr(q.createdAt)})`,
    )
    .join(",\n");
  statements.push(`
INSERT INTO public.concept_quiz_questions (id, concept_id, question, option_a, option_b, option_c, option_d, correct_answer, explanation, question_order, hints, created_at)
VALUES
${questionRows};
`);

  // Insert historical daily quests (cleared)
  const clearedQuests = dataset.dailyQuests.filter((q) => q.clearedAt !== null);
  if (clearedQuests.length > 0) {
    const clearedQuestRows = clearedQuests
      .map(
        (q) =>
          `(${escapeSqlStr(q.id)}, ${escapeSqlStr(q.studentId)}, ${escapeSqlStr(q.questDate)}, ${formatSqlUuidArray(q.conceptIds)}, ${formatSqlUuidArray(q.completedIds)}, ${formatSqlVal(q.clearedAt)}, ${q.version}, ${escapeSqlStr(q.createdAt)}, ${escapeSqlStr(q.updatedAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.daily_quests (id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at)
VALUES
${clearedQuestRows};
`);
  }

  // Insert encounters
  if (dataset.encounters.length > 0) {
    const encounterRows = dataset.encounters
      .map(
        (enc) =>
          `(${escapeSqlStr(enc.id)}, ${escapeSqlStr(enc.studentId)}, ${escapeSqlStr(enc.conceptId)}, ${escapeSqlStr(enc.source)}, ${formatSqlVal(enc.questId)}, ${formatSqlVal(enc.partyQuestId)}, ${escapeSqlStr(enc.status)}, ${formatSqlUuidArray(enc.questionIds)}, ${formatSqlJson(enc.optionPermutations)}, ${formatSqlJson(enc.hintsUsed)}, ${enc.version}, ${escapeSqlStr(enc.createdAt)}, ${escapeSqlStr(enc.updatedAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.encounters (id, student_id, concept_id, source, quest_id, party_quest_id, status, question_ids, option_permutations, hints_used, version, created_at, updated_at)
VALUES
${encounterRows};
`);
  }

  // Insert quiz attempts
  if (dataset.quizAttempts.length > 0) {
    const attemptRows = dataset.quizAttempts
      .map(
        (att) =>
          `(${escapeSqlStr(att.id)}, ${escapeSqlStr(att.studentId)}, ${escapeSqlStr(att.conceptId)}, ${att.score}, ${att.correctCount}, ${att.totalQuestions}, ${formatSqlJson(att.submittedAnswers)}, ${formatSqlVal(att.encounterId)}, ${escapeSqlStr(att.submittedAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.quiz_attempts (id, student_id, concept_id, score, correct_count, total_questions, submitted_answers, encounter_id, submitted_at)
VALUES
${attemptRows};
`);
  }

  // Insert XP events
  if (dataset.xpEvents.length > 0) {
    const xpRows = dataset.xpEvents
      .map(
        (xp) =>
          `(${escapeSqlStr(xp.id)}, ${escapeSqlStr(xp.studentId)}, ${xp.amount}, ${escapeSqlStr(xp.reason)}, ${escapeSqlStr(xp.sourceId)}, ${escapeSqlStr(xp.awardDate)}, ${formatSqlVal(xp.conceptId)}, ${escapeSqlStr(xp.createdAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.xp_events (id, student_id, amount, reason, source_id, award_date, concept_id, created_at)
VALUES
${xpRows};
`);
  }

  // Insert mastery evidence
  if (dataset.masteryEvidence.length > 0) {
    const evidenceRows = dataset.masteryEvidence
      .map(
        (ev) =>
          `(${escapeSqlStr(ev.id)}, ${escapeSqlStr(ev.studentId)}, ${escapeSqlStr(ev.conceptId)}, ${escapeSqlStr(ev.evidenceType)}, ${escapeSqlStr(ev.sourceId)}, ${ev.priorConfidence}, ${ev.newConfidence}, ${escapeSqlStr(ev.createdAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.mastery_evidence (id, student_id, concept_id, evidence_type, source_id, prior_confidence, new_confidence, created_at)
VALUES
${evidenceRows};
`);
  }

  // Insert today's daily quests (uncompleted)
  const todayQuests = dataset.dailyQuests.filter((q) => q.clearedAt === null);
  if (todayQuests.length > 0) {
    const todayQuestRows = todayQuests
      .map(
        (q) =>
          `(${escapeSqlStr(q.id)}, ${escapeSqlStr(q.studentId)}, ${escapeSqlStr(q.questDate)}, ${formatSqlUuidArray(q.conceptIds)}, ${formatSqlUuidArray(q.completedIds)}, NULL, ${q.version}, ${escapeSqlStr(q.createdAt)}, ${escapeSqlStr(q.updatedAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.daily_quests (id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at)
VALUES
${todayQuestRows};
`);
  }

  // Insert historical match
  if (dataset.matches.length > 0) {
    const matchRows = dataset.matches
      .map(
        (m) =>
          `(${escapeSqlStr(m.id)}, ${escapeSqlStr(m.courseId)}, ${escapeSqlStr(m.student1Id)}, ${escapeSqlStr(m.student2Id)}, ${formatSqlUuidArray(m.conceptIds)}, ${escapeSqlStr(m.schedulingStatus)}, ${formatSqlVal(m.proposedStart)}, ${formatSqlVal(m.proposedEnd)}, ${m.student1Accepted}, ${m.student2Accepted}, ${escapeSqlStr(m.status)}, ${escapeSqlStr(m.meetingStatus)}, ${escapeSqlStr(m.createdAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.study_group_matches (id, course_id, student1_id, student2_id, concept_ids, scheduling_status, proposed_start, proposed_end, student1_accepted, student2_accepted, status, meeting_status, created_at)
VALUES
${matchRows};
`);
  }

  // Insert party quest
  if (dataset.partyQuests.length > 0) {
    const partyQuestRows = dataset.partyQuests
      .map(
        (pq) =>
          `(${escapeSqlStr(pq.id)}, ${escapeSqlStr(pq.matchId)}, ${formatSqlUuidArray(pq.conceptIds)}, ${escapeSqlStr(pq.status)}, ${pq.version}, ${escapeSqlStr(pq.createdAt)}, ${escapeSqlStr(pq.updatedAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.party_quests (id, match_id, concept_ids, status, version, created_at, updated_at)
VALUES
${partyQuestRows};
`);
  }

  // Insert availability
  if (dataset.availability.length > 0) {
    const availRows = dataset.availability
      .map(
        (a) =>
          `(${escapeSqlStr(a.id)}, ${escapeSqlStr(a.studentId)}, ${escapeSqlStr(a.courseId)}, ${escapeSqlStr(a.startsAt)}, ${escapeSqlStr(a.endsAt)}, ${escapeSqlStr(a.createdAt)})`,
      )
      .join(",\n");
    statements.push(`
INSERT INTO public.student_availability (id, student_id, course_id, starts_at, ends_at, created_at)
VALUES
${availRows};
`);
  }

  // SQL Assertions before COMMIT
  const hariId = dataset.students.find((s) => s.persona === "hari")!.id;
  const rahulId = dataset.students.find((s) => s.persona === "rahul")!.id;
  const prajId = dataset.students.find((s) => s.persona === "praj")!.id;
  const vamshiId = dataset.students.find((s) => s.persona === "vamshi")!.id;

  statements.push(`
DO $$
DECLARE
  v_concepts INTEGER;
  v_edges INTEGER;
  v_students INTEGER;
  v_mastery INTEGER;
  v_xp_hari INTEGER;
  v_xp_rahul INTEGER;
  v_xp_praj INTEGER;
  v_xp_vamshi INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_concepts FROM public.concept_nodes WHERE course_id = ${escapeSqlStr(dataset.course.id)};
  IF v_concepts <> 33 THEN
    RAISE EXCEPTION 'Expected 33 concepts, got %', v_concepts;
  END IF;

  SELECT COUNT(*) INTO v_edges FROM public.concept_edges WHERE course_id = ${escapeSqlStr(dataset.course.id)};
  IF v_edges <> 34 THEN
    RAISE EXCEPTION 'Expected 34 edges, got %', v_edges;
  END IF;

  SELECT COUNT(*) INTO v_students FROM public.students WHERE course_id = ${escapeSqlStr(dataset.course.id)};
  IF v_students <> 4 THEN
    RAISE EXCEPTION 'Expected 4 students, got %', v_students;
  END IF;

  SELECT COUNT(*) INTO v_mastery FROM public.student_mastery sm
  JOIN public.students s ON s.id = sm.student_id
  WHERE s.course_id = ${escapeSqlStr(dataset.course.id)};
  IF v_mastery <> 132 THEN
    RAISE EXCEPTION 'Expected 132 mastery rows, got %', v_mastery;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_xp_hari FROM public.xp_events WHERE student_id = ${escapeSqlStr(hariId)};
  IF v_xp_hari <> 620 THEN
    RAISE EXCEPTION 'Expected 620 XP for Hari, got %', v_xp_hari;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_xp_rahul FROM public.xp_events WHERE student_id = ${escapeSqlStr(rahulId)};
  IF v_xp_rahul <> 508 THEN
    RAISE EXCEPTION 'Expected 508 XP for Rahul, got %', v_xp_rahul;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_xp_praj FROM public.xp_events WHERE student_id = ${escapeSqlStr(prajId)};
  IF v_xp_praj <> 320 THEN
    RAISE EXCEPTION 'Expected 320 XP for Praj, got %', v_xp_praj;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_xp_vamshi FROM public.xp_events WHERE student_id = ${escapeSqlStr(vamshiId)};
  IF v_xp_vamshi <> 0 THEN
    RAISE EXCEPTION 'Expected 0 XP for Vamshi, got %', v_xp_vamshi;
  END IF;
END $$;
`);

  statements.push("COMMIT;");
  return statements.join("\n");
}

function executePsqlTransaction(dbContainer: string, sql: string): void {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        dbContainer,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    const detail = execErr.stderr ? execErr.stderr.trim() : execErr.message ?? String(err);
    throw new Error(`Database transaction failed: ${detail}`, { cause: err });
  }
}

export async function seedDemoDatabase(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now: Date = new Date(),
  namespace = DEFAULT_DEMO_NAMESPACE,
): Promise<DemoSeedResult> {
  const startTime = performance.now();
  const config = readDemoConfig(env);

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || serviceRoleKey.trim() === "") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for seeding");
  }

  const encryptionKey = env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey.trim())) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a 64-character hexadecimal string");
  }

  const dataset = buildDemoDataset(now, namespace);
  await validateDemoCurriculum(dataset);

  const adminClient = createSupabaseAdminClient(config, serviceRoleKey);
  await provisionDemoAuthUsers(adminClient, dataset);

  const sql = buildSeedSqlTransaction(dataset);
  executePsqlTransaction(config.dbContainer, sql);

  const elapsedMs = Math.round(performance.now() - startTime);
  return {
    courseId: dataset.course.id,
    conceptCount: dataset.concepts.length,
    edgeCount: dataset.edges.length,
    studentCount: dataset.students.length,
    masteryCount: dataset.mastery.length,
    elapsedMs,
  };
}

export async function resetDemoDatabase(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now: Date = new Date(),
  namespace = DEFAULT_DEMO_NAMESPACE,
): Promise<DemoSeedResult> {
  const startTime = performance.now();
  const config = readDemoConfig(env);

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || serviceRoleKey.trim() === "") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for demo reset");
  }

  const dataset = buildDemoDataset(now, namespace);
  const adminClient = createSupabaseAdminClient(config, serviceRoleKey);
  await verifyPreexistingAuthUsers(adminClient, dataset);

  const sql = buildSeedSqlTransaction(dataset);
  executePsqlTransaction(config.dbContainer, sql);

  const elapsedMs = Math.round(performance.now() - startTime);
  return {
    courseId: dataset.course.id,
    conceptCount: dataset.concepts.length,
    edgeCount: dataset.edges.length,
    studentCount: dataset.students.length,
    masteryCount: dataset.mastery.length,
    elapsedMs,
  };
}
