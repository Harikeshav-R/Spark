import type {
  DailyQuestDTO,
  GameSummaryDTO,
  EclipseDTO,
  EncounterDTO,
  EncounterHintResponse,
  EncounterResultDTO,
  CourseEffortDTO,
  GameUpdatedEvent,
  PartyQuestUpdatedEvent,
} from "../../src/contracts/index.js";

export const FIXTURE_DAILY_QUEST = {
  id: "77777777-7777-4777-8777-777777777701",
  studentId: "44444444-4444-4444-8444-444444444402",
  date: "2026-10-21",
  items: [
    {
      conceptId: "33333333-3333-4333-8333-333333333317",
      confidence: 0.2,
      band: "red",
      reviewState: "overdue",
      completed: false,
    },
    {
      conceptId: "33333333-3333-4333-8333-333333333318",
      confidence: 0.35,
      band: "red",
      reviewState: "unreviewed",
      completed: false,
    },
    {
      conceptId: "33333333-3333-4333-8333-333333333319",
      confidence: 0.5,
      band: "yellow",
      reviewState: "current",
      completed: false,
    },
  ],
  clearedAt: null,
  version: 1,
} as const satisfies DailyQuestDTO;

export const FIXTURE_GAME_SUMMARY = {
  studentId: "44444444-4444-4444-8444-444444444402",
  courseId: "22222222-2222-4222-8222-222222222222",
  xp: 420,
  streakDays: 3,
  skyBrightness: 0.58,
  form: "glow",
  formProgress: 0.15,
  updatedAt: "2026-10-21T14:30:00.000Z",
} as const satisfies GameSummaryDTO;

export const FIXTURE_ECLIPSE = {
  studentId: "44444444-4444-4444-8444-444444444402",
  strength: 39,
  targets: [
    {
      conceptId: "33333333-3333-4333-8333-333333333317",
      confidence: 0.35,
      band: "red",
    },
    {
      conceptId: "33333333-3333-4333-8333-333333333318",
      confidence: 0.5,
      band: "yellow",
    },
  ],
  examAt: "2026-11-01T14:00:00.000Z",
} as const satisfies EclipseDTO;

export const FIXTURE_ENCOUNTER = {
  id: "88888888-8888-4888-8888-888888888801",
  studentId: "44444444-4444-4444-8444-444444444402",
  conceptId: "33333333-3333-4333-8333-333333333317",
  source: "daily",
  questId: "77777777-7777-4777-8777-777777777701",
  partyQuestId: null,
  status: "active",
  questions: [
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      question:
        "Why are intermediate activations saved during the forward pass of backpropagation?",
      options: [
        "To speed up future inference passes",
        "Because local gradients evaluate partial derivatives at forward activation values",
        "To reduce total GPU memory allocation during training",
        "To prevent numerical underflow in floating-point operations",
      ],
      hintsUsed: 0,
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      question:
        "What mathematical rule underpins backpropagation through a computational graph?",
      options: [
        "Multivariate Chain Rule",
        "L'Hôpital's Rule",
        "Taylor Series Expansion",
        "Fundamental Theorem of Calculus",
      ],
      hintsUsed: 0,
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
      question:
        "In a node computing z = x * y, what is the partial derivative with respect to x?",
      options: ["y", "x", "1", "0"],
      hintsUsed: 0,
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
      question:
        "What is the time complexity of the backward pass relative to the forward pass?",
      options: [
        "Constant multiple of forward pass time",
        "Exponential in depth of graph",
        "Quadratic in number of parameters",
        "Independent of forward pass complexity",
      ],
      hintsUsed: 0,
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd05",
      question:
        "What problem occurs if intermediate activation values are discarded prematurely?",
      options: [
        "Activations must be recomputed on the backward pass, increasing compute cost",
        "Gradient values become mathematically non-zero",
        "Loss function changes value dynamically",
        "Weights cannot be initialized properly",
      ],
      hintsUsed: 0,
    },
  ],
  version: 1,
} as const satisfies EncounterDTO;

export const FIXTURE_ENCOUNTER_HINT = {
  questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  level: 1,
  text: "Recall that computing the derivative of f(g(x)) involves evaluating f'(u) at u = g(x).",
} as const satisfies EncounterHintResponse;

export const FIXTURE_ENCOUNTER_RESULT = {
  encounterId: "88888888-8888-4888-8888-888888888801",
  attemptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  score: 0.8,
  correctCount: 4,
  totalQuestions: 5,
  newConfidence: 0.35,
  newBand: "red",
  feedback: [
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      correct: true,
      correctOption: 1,
      explanation:
        "Local gradients require forward activation values to compute exact weight updates.",
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      correct: true,
      correctOption: 0,
      explanation:
        "The multivariate chain rule allows propagation of incoming gradients to upstream parameters.",
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
      correct: true,
      correctOption: 0,
      explanation:
        "The partial derivative of a product with respect to one input equals the other input.",
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
      correct: true,
      correctOption: 0,
      explanation:
        "The backward pass is asymptotically comparable in compute to the forward pass.",
    },
    {
      questionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd05",
      correct: false,
      correctOption: 0,
      explanation:
        "Discarding activations requires recomputation during the backward pass.",
    },
  ],
  xpAwarded: 88,
  summary: {
    studentId: "44444444-4444-4444-8444-444444444402",
    courseId: "22222222-2222-4222-8222-222222222222",
    xp: 508,
    streakDays: 3,
    skyBrightness: 0.6,
    form: "glow",
    formProgress: 0.25,
    updatedAt: "2026-10-21T14:35:00.000Z",
  },
  dailyQuest: {
    id: "77777777-7777-4777-8777-777777777701",
    studentId: "44444444-4444-4444-8444-444444444402",
    date: "2026-10-21",
    items: [
      {
        conceptId: "33333333-3333-4333-8333-333333333317",
        confidence: 0.35,
        band: "red",
        reviewState: "current",
        completed: true,
      },
      {
        conceptId: "33333333-3333-4333-8333-333333333318",
        confidence: 0.35,
        band: "red",
        reviewState: "unreviewed",
        completed: false,
      },
      {
        conceptId: "33333333-3333-4333-8333-333333333319",
        confidence: 0.5,
        band: "yellow",
        reviewState: "current",
        completed: false,
      },
    ],
    clearedAt: null,
    version: 2,
  },
} as const satisfies EncounterResultDTO;

export const FIXTURE_COURSE_EFFORT = [
  {
    studentId: "44444444-4444-4444-8444-444444444402",
    name: "Rahul Verma",
    xp: 508,
    averageConfidence: 0.38,
    flag: "high_effort_low_mastery",
    unassessed: false,
  },
  {
    studentId: "44444444-4444-4444-8444-444444444401",
    name: "Hari Ram",
    xp: 620,
    averageConfidence: 0.82,
    flag: null,
    unassessed: false,
  },
] as const satisfies readonly CourseEffortDTO[];

export const FIXTURE_GAME_UPDATED_PAYLOAD = {
  eventId: "66666666-6666-4666-8666-666666666604",
  occurredAt: "2026-10-21T14:35:00.000Z",
  studentId: "44444444-4444-4444-8444-444444444402",
  updatedAt: "2026-10-21T14:35:00.000Z",
  summary: {
    studentId: "44444444-4444-4444-8444-444444444402",
    courseId: "22222222-2222-4222-8222-222222222222",
    xp: 508,
    streakDays: 3,
    skyBrightness: 0.6,
    form: "glow",
    formProgress: 0.25,
    updatedAt: "2026-10-21T14:35:00.000Z",
  },
  dailyQuest: {
    id: "77777777-7777-4777-8777-777777777701",
    studentId: "44444444-4444-4444-8444-444444444402",
    date: "2026-10-21",
    items: [
      {
        conceptId: "33333333-3333-4333-8333-333333333317",
        confidence: 0.35,
        band: "red",
        reviewState: "current",
        completed: true,
      },
    ],
    clearedAt: null,
    version: 2,
  },
} as const satisfies GameUpdatedEvent;

export const FIXTURE_PARTY_QUEST_UPDATED_PAYLOAD = {
  eventId: "66666666-6666-4666-8666-666666666605",
  occurredAt: "2026-10-21T15:10:00.000Z",
  matchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  partyQuestId: "99999999-9999-4999-8999-999999999901",
  version: 2,
  status: "completed",
  completedPairs: 2,
  totalPairs: 2,
} as const satisfies PartyQuestUpdatedEvent;
