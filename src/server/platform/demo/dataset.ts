import { createHash } from "node:crypto";
import type { UUID } from "../../../contracts/common.js";
import {
  FIXTURE_COURSE_ID,
  FIXTURE_33_CONCEPTS,
  FIXTURE_34_EDGES,
} from "../../ai/index.js";
import { validateGraph, selectDailyQuestCandidates } from "../../core/index.js";
import { calculateNodeImportance } from "../../core/graph/importance-calculator.js";
import type { DemoPersona } from "./config.js";

export const DEFAULT_DEMO_NAMESPACE = "spark-demo:p7-a-02";
export const DEMO_PASSWORD = "DemoPass123!";

export function demoId(label: string, namespace = DEFAULT_DEMO_NAMESPACE): string {
  const hash = createHash("sha256").update(`${namespace}:${label}`).digest();
  // Set UUID v5 / RFC 4122 variant bits
  hash[6] = (hash[6]! & 0x0f) | 0x50; // Version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.toString("hex", 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface DemoDatasetScope {
  namespace: string;
  scopeHash: string;
  courseId: string;
  joinCode: string;
  teacherEmail: string;
  studentEmails: Record<DemoPersona, string>;
}

export interface DemoDataset {
  scope: DemoDatasetScope;
  authUsers: Array<{
    id: string;
    email: string;
    name: string;
    role: "teacher" | "student";
    persona: DemoPersona;
  }>;
  teacher: {
    id: string;
    authId: string;
    name: string;
    email: string;
    createdAt: string;
  };
  course: {
    id: string;
    teacherId: string;
    name: string;
    description: string;
    joinCode: string;
    createdAt: string;
    examAt: string;
  };
  students: Array<{
    id: string;
    authId: string;
    courseId: string;
    name: string;
    email: string;
    persona: DemoPersona;
    createdAt: string;
  }>;
  concepts: Array<{
    id: string;
    courseId: string;
    label: string;
    description: string;
    category: string;
    difficulty: number;
    createdAt: string;
  }>;
  edges: Array<{
    id: string;
    courseId: string;
    sourceId: string;
    targetId: string;
    relationship: string;
    createdAt: string;
  }>;
  mastery: Array<{
    id: string;
    studentId: string;
    conceptId: string;
    confidence: number;
    attempts: number;
    version: number;
    lastUpdated: string;
  }>;
  masteryEvidence: Array<{
    id: string;
    studentId: string;
    conceptId: string;
    evidenceType: "quiz" | "tutor" | "poll" | "attendance";
    sourceId: string;
    priorConfidence: number;
    newConfidence: number;
    createdAt: string;
  }>;
  quizQuestions: Array<{
    id: string;
    conceptId: string;
    question: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: number;
    explanation: string;
    questionOrder: number;
    hints: [string, string, string];
    createdAt: string;
  }>;
  encounters: Array<{
    id: string;
    studentId: string;
    conceptId: string;
    source: "daily" | "star" | "eclipse" | "party";
    questId: string | null;
    partyQuestId: string | null;
    status: "completed" | "active" | "abandoned";
    questionIds: string[];
    optionPermutations: Record<string, number[]>;
    hintsUsed: Record<string, number>;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  quizAttempts: Array<{
    id: string;
    studentId: string;
    conceptId: string;
    score: number;
    correctCount: number;
    totalQuestions: number;
    submittedAnswers: Array<{
      question_id: string;
      selected_option: number;
      correct: boolean;
    }>;
    encounterId: string | null;
    submittedAt: string;
  }>;
  dailyQuests: Array<{
    id: string;
    studentId: string;
    questDate: string;
    conceptIds: string[];
    completedIds: string[];
    clearedAt: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  xpEvents: Array<{
    id: string;
    studentId: string;
    amount: number;
    reason: "encounter" | "quest_cleared" | "party";
    sourceId: string;
    awardDate: string;
    conceptId: string | null;
    createdAt: string;
  }>;
  matches: Array<{
    id: string;
    courseId: string;
    student1Id: string;
    student2Id: string;
    conceptIds: string[];
    schedulingStatus: string;
    proposedStart: string | null;
    proposedEnd: string | null;
    student1Accepted: boolean;
    student2Accepted: boolean;
    status: string;
    meetingStatus: string;
    createdAt: string;
  }>;
  partyQuests: Array<{
    id: string;
    matchId: string;
    conceptIds: string[];
    status: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  availability: Array<{
    id: string;
    studentId: string;
    courseId: string;
    startsAt: string;
    endsAt: string;
    createdAt: string;
  }>;
}

export function buildDemoDataset(
  now: Date,
  namespace = DEFAULT_DEMO_NAMESPACE,
): DemoDataset {
  const isDefault = namespace === DEFAULT_DEMO_NAMESPACE;
  const scopeHash = createHash("sha256").update(namespace).digest("hex").slice(0, 8);

  const courseId = isDefault ? FIXTURE_COURSE_ID : demoId("course:cs229", namespace);
  const joinCode = isDefault ? "CS229-8F" : `T${scopeHash.slice(0, 7).toUpperCase()}`;

  const teacherEmail = isDefault
    ? "sarah.chen@example.test"
    : `sarah.chen-${scopeHash}@example.test`;

  const studentEmails: Record<DemoPersona, string> = {
    teacher: teacherEmail,
    hari: isDefault ? "hari@example.test" : `hari-${scopeHash}@example.test`,
    rahul: isDefault ? "rahul@example.test" : `rahul-${scopeHash}@example.test`,
    praj: isDefault ? "praj@example.test" : `praj-${scopeHash}@example.test`,
    vamshi: isDefault ? "vamshi@example.test" : `vamshi-${scopeHash}@example.test`,
  };

  const scope: DemoDatasetScope = {
    namespace,
    scopeHash,
    courseId,
    joinCode,
    teacherEmail,
    studentEmails,
  };

  // Base calendar date D at UTC midnight
  const dMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dMinus = (days: number, hour = 0, minute = 0) =>
    new Date(dMidnight.getTime() - days * 86400000 + hour * 3600000 + minute * 60000);
  const dPlus = (days: number, hour = 0, minute = 0) =>
    new Date(dMidnight.getTime() + days * 86400000 + hour * 3600000 + minute * 60000);
  const dateStr = (d: Date) => d.toISOString().slice(0, 10);

  // 1. Auth Users
  const authUsers: DemoDataset["authUsers"] = [
    {
      id: demoId("auth:teacher", namespace),
      email: teacherEmail,
      name: "Prof. Sarah Chen",
      role: "teacher",
      persona: "teacher",
    },
    {
      id: demoId("auth:hari", namespace),
      email: studentEmails.hari,
      name: "Hari",
      role: "student",
      persona: "hari",
    },
    {
      id: demoId("auth:rahul", namespace),
      email: studentEmails.rahul,
      name: "Rahul",
      role: "student",
      persona: "rahul",
    },
    {
      id: demoId("auth:praj", namespace),
      email: studentEmails.praj,
      name: "Praj",
      role: "student",
      persona: "praj",
    },
    {
      id: demoId("auth:vamshi", namespace),
      email: studentEmails.vamshi,
      name: "Vamshi",
      role: "student",
      persona: "vamshi",
    },
  ];

  // 2. Teacher Profile
  const teacher: DemoDataset["teacher"] = {
    id: demoId("teacher:chen", namespace),
    authId: demoId("auth:teacher", namespace),
    name: "Prof. Sarah Chen",
    email: teacherEmail,
    createdAt: dMinus(7).toISOString(),
  };

  // 3. Course
  const course: DemoDataset["course"] = {
    id: courseId,
    teacherId: teacher.id,
    name: "CS229: Machine Learning",
    description: "Synthetic local demonstration course for CS229: Machine Learning.",
    joinCode,
    createdAt: dMinus(7).toISOString(),
    examAt: dPlus(7).toISOString(),
  };

  // 4. Students
  const students: DemoDataset["students"] = [
    {
      id: demoId("student:hari", namespace),
      authId: demoId("auth:hari", namespace),
      courseId,
      name: "Hari",
      email: studentEmails.hari,
      persona: "hari",
      createdAt: dMinus(7).toISOString(),
    },
    {
      id: demoId("student:rahul", namespace),
      authId: demoId("auth:rahul", namespace),
      courseId,
      name: "Rahul",
      email: studentEmails.rahul,
      persona: "rahul",
      createdAt: dMinus(7).toISOString(),
    },
    {
      id: demoId("student:praj", namespace),
      authId: demoId("auth:praj", namespace),
      courseId,
      name: "Praj",
      email: studentEmails.praj,
      persona: "praj",
      createdAt: dMinus(7).toISOString(),
    },
    {
      id: demoId("student:vamshi", namespace),
      authId: demoId("auth:vamshi", namespace),
      courseId,
      name: "Vamshi",
      email: studentEmails.vamshi,
      persona: "vamshi",
      createdAt: dMinus(7).toISOString(),
    },
  ];

  const studentMap = new Map(students.map((s) => [s.persona, s]));

  // 5. Concepts & Concept Map
  const conceptIdMap = new Map<string, string>();
  const concepts: DemoDataset["concepts"] = FIXTURE_33_CONCEPTS.map((c) => {
    const id = isDefault ? c.id : demoId(`concept:${c.label}`, namespace);
    conceptIdMap.set(c.label, id);
    return {
      id,
      courseId,
      label: c.label,
      description: c.description,
      category: c.category,
      difficulty: c.difficulty,
      createdAt: dMinus(7).toISOString(),
    };
  });

  // 6. Edges
  const edges: DemoDataset["edges"] = FIXTURE_34_EDGES.map(([srcLabel, tgtLabel]) => {
    const sourceId = conceptIdMap.get(srcLabel);
    const targetId = conceptIdMap.get(tgtLabel);
    if (!sourceId || !targetId) {
      throw new Error(`Unknown concept in edge: ${srcLabel} -> ${tgtLabel}`);
    }
    return {
      id: demoId(`edge:${srcLabel}:${tgtLabel}`, namespace),
      courseId,
      sourceId,
      targetId,
      relationship: "prerequisite",
      createdAt: dMinus(7).toISOString(),
    };
  });

  // 7. Student Mastery (132 rows)
  const defaultMasteries: Record<DemoPersona, number> = {
    teacher: 0,
    hari: 0.81,
    rahul: 0.4,
    praj: 0.65,
    vamshi: 0.0,
  };

  const masteryOverrides: Record<string, Partial<Record<DemoPersona, number>>> = {
    Matrices: { hari: 0.84, rahul: 0.39, praj: 0.8, vamshi: 0.0 },
    Vectors: { hari: 0.95, rahul: 0.45, praj: 0.8, vamshi: 0.0 },
    Derivatives: { hari: 0.9, rahul: 0.35, praj: 0.75, vamshi: 0.0 },
    Gradients: { hari: 0.85, rahul: 0.2, praj: 0.65, vamshi: 0.0 },
    "Gradient Descent": { hari: 0.85, rahul: 0.2, praj: 0.5, vamshi: 0.0 },
    Backpropagation: { hari: 0.8, rahul: 0.15, praj: 0.4, vamshi: 0.0 },
  };

  const mastery: DemoDataset["mastery"] = [];
  const masteryByStudentAndConcept = new Map<string, Map<string, number>>();

  for (const st of students) {
    const conceptMap = new Map<string, number>();
    for (const c of concepts) {
      const overrideVal = masteryOverrides[c.label]?.[st.persona];
      const confidence = overrideVal !== undefined ? overrideVal : defaultMasteries[st.persona];
      if (!Number.isFinite(confidence) || confidence < 0.0 || confidence > 1.0) {
        throw new Error(`Invalid confidence value ${confidence} for ${st.name} / ${c.label}`);
      }
      mastery.push({
        id: demoId(`mastery:${st.persona}:${c.label}`, namespace),
        studentId: st.id,
        conceptId: c.id,
        confidence,
        attempts: 0,
        version: 1,
        lastUpdated: dMinus(1).toISOString(),
      });
      conceptMap.set(c.id, confidence);
    }
    masteryByStudentAndConcept.set(st.id, conceptMap);
  }

  // 8. Quiz Questions (Vectors bank)
  const vectorsConceptId = conceptIdMap.get("Vectors");
  if (!vectorsConceptId) {
    throw new Error("Vectors concept not found in demo dataset");
  }

  const rawVectorsQuestions: Array<{
    question: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: number;
    explanation: string;
    hints: [string, string, string];
  }> = [
    {
      question: "What is the dimension of the vector [4, -1] in standard Euclidean space?",
      optionA: "2",
      optionB: "1",
      optionC: "4",
      optionD: "3",
      correctAnswer: 0,
      explanation: "A vector with two components [4, -1] has dimensionality 2.",
      hints: [
        "Count the number of coordinates or entries in the ordered tuple.",
        "The vector consists of components along the x and y axes.",
        "There are exactly two scalar components in [4, -1].",
      ],
    },
    {
      question: "What is the Euclidean norm (L2 norm) of the 2D vector (3, 4)?",
      optionA: "5",
      optionB: "7",
      optionC: "25",
      optionD: "1",
      correctAnswer: 0,
      explanation: "The Euclidean norm is sqrt(3^2 + 4^2) = sqrt(9 + 16) = sqrt(25) = 5.",
      hints: [
        "Recall the Pythagorean theorem applied to vector components.",
        "Square each component, sum them, and take the square root.",
        "Compute sqrt(3^2 + 4^2) = sqrt(25).",
      ],
    },
    {
      question: "Compute the dot product of vectors (1, 2) and (3, 4).",
      optionA: "11",
      optionB: "14",
      optionC: "10",
      optionD: "7",
      correctAnswer: 0,
      explanation: "The dot product is (1*3) + (2*4) = 3 + 8 = 11.",
      hints: [
        "Multiply matching components together and sum the resulting products.",
        "Multiply the first components (1*3) and the second components (2*4).",
        "Add 3 and 8 to get the inner product.",
      ],
    },
    {
      question: "What is the scalar multiplication result of 2 * (1, -3)?",
      optionA: "(2, -6)",
      optionB: "(2, -3)",
      optionC: "(3, -1)",
      optionD: "(-2, 6)",
      correctAnswer: 0,
      explanation:
        "Scalar multiplication distributes across each component: 2*1=2, 2*(-3)=-6.",
      hints: [
        "Multiply each individual component of the vector by the scalar scalar.",
        "Multiply 1 by 2 for the first entry, and -3 by 2 for the second entry.",
        "The resulting vector coordinates are 2 and -6.",
      ],
    },
    {
      question:
        "Under what condition are two non-zero Euclidean vectors considered orthogonal?",
      optionA: "Their dot product equals zero",
      optionB: "Their Euclidean norms are identical",
      optionC: "Their cross product equals one",
      optionD: "Their component sum is zero",
      correctAnswer: 0,
      explanation: "Two non-zero vectors u and v are orthogonal if and only if u · v = 0.",
      hints: [
        "Consider the angle theta between vectors and the formula u · v = |u||v|cos(theta).",
        "When vectors are perpendicular, the cosine of 90 degrees is 0.",
        "The inner product of perpendicular vectors evaluates to zero.",
      ],
    },
  ];

  const quizQuestions: DemoDataset["quizQuestions"] = rawVectorsQuestions.map(
    (q, idx) => ({
      id: demoId(`question:vectors:${idx + 1}`, namespace),
      conceptId: vectorsConceptId,
      question: q.question,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      questionOrder: idx + 1,
      hints: q.hints,
      createdAt: dMinus(7).toISOString(),
    }),
  );

  const questionIds = quizQuestions.map((q) => q.id);

  // 9. Historical Encounters, Attempts & XP Events
  const encounters: DemoDataset["encounters"] = [];
  const quizAttempts: DemoDataset["quizAttempts"] = [];
  const xpEvents: DemoDataset["xpEvents"] = [];

  interface EncounterSpec {
    persona: "hari" | "rahul" | "praj";
    dateLabel: string;
    dayOffset: number;
    rewards: [number, number, number, number, number];
  }

  const encounterSpecs: EncounterSpec[] = [
    // Hari: 150, 150, 150, 70
    { persona: "hari", dateLabel: "d4", dayOffset: 4, rewards: [30, 30, 30, 30, 30] },
    { persona: "hari", dateLabel: "d3", dayOffset: 3, rewards: [30, 30, 30, 30, 30] },
    { persona: "hari", dateLabel: "d2", dayOffset: 2, rewards: [30, 30, 30, 30, 30] },
    { persona: "hari", dateLabel: "d1", dayOffset: 1, rewards: [30, 12, 12, 8, 8] },
    // Rahul: 150, 110, 108, 40
    { persona: "rahul", dateLabel: "d7", dayOffset: 7, rewards: [30, 30, 30, 30, 30] },
    { persona: "rahul", dateLabel: "d3", dayOffset: 3, rewards: [30, 30, 18, 24, 8] },
    { persona: "rahul", dateLabel: "d2", dayOffset: 2, rewards: [24, 24, 24, 18, 18] },
    { persona: "rahul", dateLabel: "d1", dayOffset: 1, rewards: [8, 8, 8, 8, 8] },
    // Praj: 150, 120
    { persona: "praj", dateLabel: "d2", dayOffset: 2, rewards: [30, 30, 30, 30, 30] },
    { persona: "praj", dateLabel: "d1", dayOffset: 1, rewards: [24, 24, 24, 24, 24] },
  ];

  for (const spec of encounterSpecs) {
    const st = studentMap.get(spec.persona)!;
    const encDate = dMinus(spec.dayOffset, 12, 0);
    const encDateStr = dateStr(encDate);

    // Compute metrics from reward array
    let correctCount = 0;
    let xpTotal = 0;
    const hintsUsed: Record<string, number> = {};
    const submittedAnswers: DemoDataset["quizAttempts"][number]["submittedAnswers"] = [];

    spec.rewards.forEach((r, idx) => {
      const qNum = (idx + 1).toString();
      xpTotal += r;
      if (r === 30) {
        correctCount += 1;
        hintsUsed[qNum] = 0;
        submittedAnswers.push({
          question_id: questionIds[idx]!,
          selected_option: 0,
          correct: true,
        });
      } else if (r === 24) {
        correctCount += 1;
        hintsUsed[qNum] = 1;
        submittedAnswers.push({
          question_id: questionIds[idx]!,
          selected_option: 0,
          correct: true,
        });
      } else if (r === 18) {
        correctCount += 1;
        hintsUsed[qNum] = 2;
        submittedAnswers.push({
          question_id: questionIds[idx]!,
          selected_option: 0,
          correct: true,
        });
      } else if (r === 12) {
        correctCount += 1;
        hintsUsed[qNum] = 3;
        submittedAnswers.push({
          question_id: questionIds[idx]!,
          selected_option: 0,
          correct: true,
        });
      } else if (r === 8) {
        hintsUsed[qNum] = 0;
        submittedAnswers.push({
          question_id: questionIds[idx]!,
          selected_option: 1, // incorrect choice
          correct: false,
        });
      } else {
        throw new Error(`Unexpected reward value ${r}`);
      }
    });

    const score = correctCount / 5;
    const encounterId = demoId(`encounter:${spec.persona}:${spec.dateLabel}`, namespace);
    const attemptId = demoId(`attempt:${spec.persona}:${spec.dateLabel}`, namespace);
    const questId = demoId(`quest:${spec.persona}:${spec.dateLabel}`, namespace);

    encounters.push({
      id: encounterId,
      studentId: st.id,
      conceptId: vectorsConceptId,
      source: "daily",
      questId,
      partyQuestId: null,
      status: "completed",
      questionIds,
      optionPermutations: {
        "1": [0, 1, 2, 3],
        "2": [0, 1, 2, 3],
        "3": [0, 1, 2, 3],
        "4": [0, 1, 2, 3],
        "5": [0, 1, 2, 3],
      },
      hintsUsed,
      version: 1,
      createdAt: encDate.toISOString(),
      updatedAt: encDate.toISOString(),
    });

    quizAttempts.push({
      id: attemptId,
      studentId: st.id,
      conceptId: vectorsConceptId,
      score,
      correctCount,
      totalQuestions: 5,
      submittedAnswers,
      encounterId,
      submittedAt: encDate.toISOString(),
    });

    xpEvents.push({
      id: demoId(`xp:encounter:${spec.persona}:${spec.dateLabel}`, namespace),
      studentId: st.id,
      amount: xpTotal,
      reason: "encounter",
      sourceId: attemptId,
      awardDate: encDateStr,
      conceptId: vectorsConceptId,
      createdAt: encDate.toISOString(),
    });
  }

  // 10. Historical Daily Quests (Cleared)
  const dailyQuests: DemoDataset["dailyQuests"] = [];

  interface QuestSpec {
    persona: "hari" | "rahul" | "praj";
    dateLabel: string;
    dayOffset: number;
  }

  const clearedQuestSpecs: QuestSpec[] = [
    { persona: "hari", dateLabel: "d4", dayOffset: 4 },
    { persona: "hari", dateLabel: "d3", dayOffset: 3 },
    { persona: "hari", dateLabel: "d2", dayOffset: 2 },
    { persona: "hari", dateLabel: "d1", dayOffset: 1 },
    { persona: "rahul", dateLabel: "d7", dayOffset: 7 },
    { persona: "rahul", dateLabel: "d3", dayOffset: 3 },
    { persona: "rahul", dateLabel: "d2", dayOffset: 2 },
    { persona: "rahul", dateLabel: "d1", dayOffset: 1 },
    { persona: "praj", dateLabel: "d2", dayOffset: 2 },
    { persona: "praj", dateLabel: "d1", dayOffset: 1 },
  ];

  const defaultQuestConcepts = [
    vectorsConceptId,
    conceptIdMap.get("Matrices")!,
    conceptIdMap.get("Derivatives")!,
  ];

  for (const spec of clearedQuestSpecs) {
    const st = studentMap.get(spec.persona)!;
    const qDate = dMinus(spec.dayOffset, 14, 0);
    const qDateStr = dateStr(qDate);
    const questId = demoId(`quest:${spec.persona}:${spec.dateLabel}`, namespace);

    dailyQuests.push({
      id: questId,
      studentId: st.id,
      questDate: qDateStr,
      conceptIds: defaultQuestConcepts,
      completedIds: defaultQuestConcepts,
      clearedAt: qDate.toISOString(),
      version: 1,
      createdAt: dMinus(spec.dayOffset, 0, 0).toISOString(),
      updatedAt: qDate.toISOString(),
    });

    xpEvents.push({
      id: demoId(`xp:quest:${spec.persona}:${spec.dateLabel}`, namespace),
      studentId: st.id,
      amount: 25,
      reason: "quest_cleared",
      sourceId: questId,
      awardDate: qDateStr,
      conceptId: null,
      createdAt: qDate.toISOString(),
    });
  }

  // 11. Rahul's Review History in mastery_evidence
  // Rahul's Distributions is overdue at D-4; Vectors, Perceptron, Overfitting, Train/Val/Test Split current at D-1; Derivatives has no quiz/tutor review.
  const masteryEvidence: DemoDataset["masteryEvidence"] = [];
  const rahulStudent = studentMap.get("rahul")!;

  const rahulReviewSpecs: Array<{
    conceptLabel: string;
    dayOffset: number;
    priorConfidence: number;
    newConfidence: number;
  }> = [
    {
      conceptLabel: "Distributions",
      dayOffset: 4,
      priorConfidence: 0.3,
      newConfidence: 0.4,
    },
    {
      conceptLabel: "Vectors",
      dayOffset: 1,
      priorConfidence: 0.35,
      newConfidence: 0.45,
    },
    {
      conceptLabel: "Perceptron",
      dayOffset: 1,
      priorConfidence: 0.3,
      newConfidence: 0.4,
    },
    {
      conceptLabel: "Overfitting",
      dayOffset: 1,
      priorConfidence: 0.3,
      newConfidence: 0.4,
    },
    {
      conceptLabel: "Train/Val/Test Split",
      dayOffset: 1,
      priorConfidence: 0.3,
      newConfidence: 0.4,
    },
  ];

  for (const rev of rahulReviewSpecs) {
    const conceptId = conceptIdMap.get(rev.conceptLabel);
    if (!conceptId) {
      throw new Error(`Concept ${rev.conceptLabel} not found for review spec`);
    }
    const revDate = dMinus(rev.dayOffset, 10, 0);
    const sourceId = demoId(
      `quiz:review:rahul:${rev.conceptLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      namespace,
    );

    masteryEvidence.push({
      id: demoId(`evidence:review:rahul:${rev.conceptLabel}`, namespace),
      studentId: rahulStudent.id,
      conceptId,
      evidenceType: "quiz",
      sourceId,
      priorConfidence: rev.priorConfidence,
      newConfidence: rev.newConfidence,
      createdAt: revDate.toISOString(),
    });
  }

  // 12. Today's Daily Quests (Uncompleted)
  // Derived via public selectDailyQuestCandidates and calculateNodeImportance
  const topologyNodes = concepts.map((c) => ({ id: c.id as UUID }));
  const topologyEdges = edges.map((e) => ({
    sourceId: e.sourceId as UUID,
    targetId: e.targetId as UUID,
  }));
  const importanceMap = calculateNodeImportance(topologyNodes, topologyEdges);

  for (const st of students) {
    const studentMasteryMap = masteryByStudentAndConcept.get(st.id)!;
    const latestReviewsMap = new Map<UUID, Date>();

    if (st.persona === "rahul") {
      for (const rev of rahulReviewSpecs) {
        const cId = conceptIdMap.get(rev.conceptLabel)! as UUID;
        latestReviewsMap.set(cId, dMinus(rev.dayOffset, 10, 0));
      }
    }

    const candidateIds = selectDailyQuestCandidates({
      nodes: topologyNodes,
      edges: topologyEdges,
      masteries: studentMasteryMap as ReadonlyMap<UUID, number>,
      latestReviews: latestReviewsMap,
      importanceMap,
      now,
    });

    dailyQuests.push({
      id: demoId(`quest:today:${st.persona}`, namespace),
      studentId: st.id,
      questDate: dateStr(dMidnight),
      conceptIds: candidateIds,
      completedIds: [],
      clearedAt: null,
      version: 1,
      createdAt: dMidnight.toISOString(),
      updatedAt: dMidnight.toISOString(),
    });
  }

  // 13. Historical Completed Match (Hari & Rahul)
  const hariStudent = studentMap.get("hari")!;
  const backpropConceptId = conceptIdMap.get("Backpropagation")!;

  const [student1Id, student2Id] =
    hariStudent.id < rahulStudent.id
      ? [hariStudent.id, rahulStudent.id]
      : [rahulStudent.id, hariStudent.id];

  const historicalMatchId = demoId("match:historical:hari-rahul", namespace);
  const matches: DemoDataset["matches"] = [
    {
      id: historicalMatchId,
      courseId,
      student1Id,
      student2Id,
      conceptIds: [backpropConceptId],
      schedulingStatus: "accepted",
      proposedStart: dMinus(2, 15, 0).toISOString(),
      proposedEnd: dMinus(2, 15, 30).toISOString(),
      student1Accepted: true,
      student2Accepted: true,
      status: "completed",
      meetingStatus: "pending",
      createdAt: dMinus(2, 14, 0).toISOString(),
    },
  ];

  // 14. Cancelled Backpropagation Party Quest
  const partyQuests: DemoDataset["partyQuests"] = [
    {
      id: demoId("party-quest:historical:hari-rahul", namespace),
      matchId: historicalMatchId,
      conceptIds: [backpropConceptId],
      status: "cancelled",
      version: 1,
      createdAt: dMinus(2, 14, 0).toISOString(),
      updatedAt: dMinus(2, 14, 30).toISOString(),
    },
  ];

  // 15. Tomorrow 15:00–15:30 UTC Availability for Hari and Rahul
  const tomorrowStart = dPlus(1, 15, 0);
  const tomorrowEnd = dPlus(1, 15, 30);

  const availability: DemoDataset["availability"] = [
    {
      id: demoId("availability:tomorrow:hari", namespace),
      studentId: hariStudent.id,
      courseId,
      startsAt: tomorrowStart.toISOString(),
      endsAt: tomorrowEnd.toISOString(),
      createdAt: dMidnight.toISOString(),
    },
    {
      id: demoId("availability:tomorrow:rahul", namespace),
      studentId: rahulStudent.id,
      courseId,
      startsAt: tomorrowStart.toISOString(),
      endsAt: tomorrowEnd.toISOString(),
      createdAt: dMidnight.toISOString(),
    },
  ];

  return {
    scope,
    authUsers,
    teacher,
    course,
    students,
    concepts,
    edges,
    mastery,
    masteryEvidence,
    quizQuestions,
    encounters,
    quizAttempts,
    dailyQuests,
    xpEvents,
    matches,
    partyQuests,
    availability,
  };
}

export async function validateDemoCurriculum(dataset: DemoDataset): Promise<boolean> {
  return await validateGraph(
    dataset.concepts.map((c) => ({
      label: c.label,
      description: c.description,
      category: c.category,
      difficulty: c.difficulty,
    })),
    FIXTURE_34_EDGES,
  );
}
