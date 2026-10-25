# Canonical Service Ports: TypeScript Interfaces

This document defines the canonical TypeScript interfaces, DTOs, domain models, and port contracts across all application modules.

---

## 1. Common Types & Identity Context

```typescript
export type UUID = string;
export type ISOTimestamp = string; // UTC ISO-8601 (e.g., "2026-10-20T14:30:00.000Z")

export type UserRole = "teacher" | "student";

export type MasteryBand = "gray" | "red" | "yellow" | "green";

export interface ActorContext {
  userId: UUID;
  authId: UUID;
  email: string;
  name: string;
  role: UserRole;
  teacherId?: UUID;
  enrolledCourses: {
    studentId: UUID;
    courseId: UUID;
  }[];
}

export interface Clock {
  now(): Date;
  nowISO(): ISOTimestamp;
}

export interface IdGenerator {
  generateId(): UUID;
  generateJoinCode(): string;
}
```

---

## 2. Core Domain Models & Mastery Evidence

```typescript
export interface Course {
  id: UUID;
  teacherId: UUID;
  name: string;
  description?: string;
  joinCode: string;
  pdfCacheHash?: string;
  examAt?: ISOTimestamp;
  createdAt: ISOTimestamp;
}

export interface Student {
  id: UUID;
  authId: UUID;
  courseId: UUID;
  name: string;
  email: string;
  createdAt: ISOTimestamp;
}

export interface ConceptNode {
  id: UUID;
  courseId: UUID;
  label: string;
  description: string;
  category: string;
  difficulty: number;
  x?: number;
  y?: number;
  createdAt: ISOTimestamp;
}

export interface ConceptEdge {
  id: UUID;
  courseId: UUID;
  sourceId: UUID;
  targetId: UUID;
  relationship: "prerequisite";
  createdAt: ISOTimestamp;
}

export interface StudentMastery {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  confidence: number;
  attempts: number;
  version: number;
  lastUpdated: ISOTimestamp;
}

export type MasteryEvidence =
  | { type: "poll"; outcome: "correct" | "partial" | "wrong"; sourceId: UUID }
  | { type: "tutor"; sourceId: UUID }
  | { type: "quiz"; score: number; sourceId: UUID }
  | { type: "attendance"; sourceId: UUID };
```

---

## 3. Platform & Core Services (Lane A)

```typescript
export interface CourseService {
  createCourse(actor: ActorContext, name: string, description?: string): Promise<Course>;
  getCourse(actor: ActorContext, courseId: UUID): Promise<Course>;
  listCourses(actor: ActorContext): Promise<Course[]>;
  enrollStudent(actor: ActorContext, joinCode: string): Promise<Student>;
  listEnrolledStudents(actor: ActorContext, courseId: UUID): Promise<Student[]>;
}

export interface GraphService {
  validateGraph(nodes: Omit<ConceptNode, "id" | "courseId" | "createdAt">[], edges: [string, string][]): Promise<boolean>;
  commitKnowledgeGraph(
    actor: ActorContext,
    courseId: UUID,
    nodes: Omit<ConceptNode, "id" | "courseId" | "createdAt">[],
    edges: [string, string][]
  ): Promise<{ nodeCount: number; edgeCount: number }>;
  getCourseGraph(actor: ActorContext, courseId: UUID): Promise<{
    nodes: (ConceptNode & { importance: number; confidence?: number; band?: MasteryBand })[];
    edges: ConceptEdge[];
  }>;
  calculateImportance(courseId: UUID): Promise<Map<UUID, number>>;
}

export interface MasteryService {
  getMastery(actor: ActorContext, studentId: UUID): Promise<StudentMastery[]>;
  applyEvidence(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    evidence: MasteryEvidence
  ): Promise<{
    confidence: number;
    band: MasteryBand;
    attempts: number;
    version: number;
  }>;
  getClassHeatmap(actor: ActorContext, courseId: UUID): Promise<{
    conceptId: UUID;
    distribution: Record<MasteryBand, number>;
    averageConfidence: number;
  }[]>;
  initializeStudentMastery(studentId: UUID, courseId: UUID): Promise<number>;
}
```

---

## 4. Classroom & Collaboration Services (Lane B)

```typescript
export interface LectureSession {
  id: UUID;
  courseId: UUID;
  title: string;
  status: "live" | "completed";
  startedAt: ISOTimestamp;
  endedAt?: ISOTimestamp;
}

export interface TranscriptChunk {
  id: UUID;
  lectureId: UUID;
  text: string;
  timestampSec: number;
  speakerName?: string;
  detectedConceptIds: UUID[];
  createdAt: ISOTimestamp;
}

export interface PollQuestion {
  id: UUID;
  lectureId: UUID;
  conceptId: UUID;
  question: string;
  expectedAnswer: string;
  status: "draft" | "active" | "closed";
  generatedAt: ISOTimestamp;
  activatedAt?: ISOTimestamp;
  closedAt?: ISOTimestamp;
}

export type PublicPollQuestion = Omit<PollQuestion, "expectedAnswer">;

export interface PollDraftInput {
  question: string;
  expectedAnswer: string;
}

export interface TeacherPollSummary {
  poll: PollQuestion;
  responseCount: number;
}

export interface TeacherPollSnapshot {
  lectureId: UUID;
  draft: TeacherPollSummary | null;
  active: TeacherPollSummary | null;
  closed: TeacherPollSummary | null;
}

export interface ClassroomService {
  startLecture(actor: ActorContext, courseId: UUID, title: string): Promise<LectureSession>;
  endLecture(actor: ActorContext, lectureId: UUID): Promise<LectureSession>;
  getLectureSnapshot(actor: ActorContext, lectureId: UUID): Promise<{
    lecture: LectureSession;
    activePoll: PublicPollQuestion | null;
    recentChunks: TranscriptChunk[];
    activeConceptIds: UUID[];
  }>;
  ingestTranscriptChunk(
    actor: ActorContext,
    lectureId: UUID,
    text: string,
    timestampSec: number,
    speakerName?: string
  ): Promise<TranscriptChunk>;
  generatePoll(actor: ActorContext, lectureId: UUID, conceptId?: UUID): Promise<PollQuestion>;
  activatePoll(actor: ActorContext, pollId: UUID): Promise<PollQuestion>;
  respondToPoll(
    actor: ActorContext,
    pollId: UUID,
    studentId: UUID,
    answer: string
  ): Promise<{
    responseId: UUID;
    outcome: "correct" | "partial" | "wrong";
    feedback: string;
    newConfidence: number;
    newBand: MasteryBand;
  }>;
  closePoll(actor: ActorContext, pollId: UUID): Promise<PollQuestion>;
}

export interface TeacherPollService {
  generatePoll(actor: ActorContext, lectureId: UUID, conceptId?: UUID): Promise<PollQuestion>;
  editDraft(actor: ActorContext, pollId: UUID, input: PollDraftInput): Promise<PollQuestion>;
  getSnapshot(actor: ActorContext, lectureId: UUID): Promise<TeacherPollSnapshot>;
}

export interface StudyGroupService {
  optIntoPool(actor: ActorContext, courseId: UUID, conceptIds: UUID[]): Promise<{ status: "waiting" | "matched"; matchId?: UUID; expiresAt: ISOTimestamp }>;
  optOutOfPool(actor: ActorContext, courseId: UUID): Promise<void>;
  getCandidates(actor: ActorContext, courseId: UUID): Promise<{
    studentId: UUID;
    requestedConcepts: { conceptId: UUID; label: string; band: MasteryBand }[];
    complementaryGap: number;
    fitKind: "reciprocal" | "mentor";
  }[]>;
  sendInvitation(actor: ActorContext, courseId: UUID, inviteeId: UUID, conceptIds: UUID[]): Promise<{ invitationId: UUID; expiresAt: ISOTimestamp }>;
  respondToInvitation(actor: ActorContext, invitationId: UUID, decision: "accepted" | "declined"): Promise<{ status: "accepted" | "declined"; matchId?: UUID }>;
  registerAvailability(actor: ActorContext, courseId: UUID, intervals: { startsAt: ISOTimestamp; endsAt: ISOTimestamp }[]): Promise<void>;
  getMatchMessages(actor: ActorContext, matchId: UUID): Promise<{ id: UUID; senderId: UUID; content: string; createdAt: ISOTimestamp }[]>;
  sendMessage(actor: ActorContext, matchId: UUID, content: string): Promise<{ id: UUID; senderId: UUID; content: string; createdAt: ISOTimestamp }>;
  proposeSchedule(actor: ActorContext, matchId: UUID): Promise<{ schedulingStatus: "proposed" | "no-overlap"; proposedSlot?: { startsAt: ISOTimestamp; endsAt: ISOTimestamp } }>;
  acceptSchedule(actor: ActorContext, matchId: UUID, slot: { startsAt: ISOTimestamp; endsAt: ISOTimestamp }): Promise<{ bothAccepted: boolean; zoomMeetingId?: string; zoomLink?: string }>;
  createPartyQuest(actor: ActorContext, matchId: UUID, conceptIds: UUID[]): Promise<{ partyQuestId: UUID; status: "active"; conceptIds: UUID[] }>;
  getPartyQuests(actor: ActorContext, matchId: UUID): Promise<{
    partyQuestId: UUID;
    conceptIds: UUID[];
    status: "active" | "completed" | "cancelled";
    progress: { studentId: UUID; conceptId: UUID; completed: boolean }[];
  }[]>;
}

---

## 5. AI Pipelines & Learning Services (Lane C)

```typescript
export interface AiService {
  extractPrerequisiteGraph(pdfBytes: Buffer): Promise<{
    totalPages: number;
    processedPages: number;
    truncated: boolean;
    concepts: { label: string; description: string; category: string; difficulty: number }[];
    edges: [string, string][];
  }>;
  detectConcepts(chunkText: string, candidateConcepts: { id: UUID; label: string }[]): Promise<UUID[]>;
  generatePollQuestion(concept: ConceptNode, recentTranscript: string): Promise<{ question: string; expectedAnswer: string }>;
  evaluatePollResponse(question: string, expectedAnswer: string, studentAnswer: string): Promise<{
    outcome: "correct" | "partial" | "wrong";
    feedback: string;
  }>;
  socraticTutorTurn(
    concept: ConceptNode,
    messageHistory: { role: "user" | "assistant"; content: string }[],
    newStudentMessage: string
  ): Promise<{
    assistantResponse: string;
    understandingDetected: boolean;
  }>;
  summarizeMisconceptions(pollId: UUID, responses: { answer: string; outcome: string }[]): Promise<{
    misconceptions: string[];
    recommendations: { title: string; description: string; actionablePrompt: string }[];
  }>;
  generateLearningPage(concept: ConceptNode): Promise<string>;
  generateQuizQuestions(concept: ConceptNode): Promise<{
    question: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: number;
    explanation: string;
  }[]>;
  searchAcademicResources(conceptLabel: string, query?: string): Promise<{
    title: string;
    url: string;
    snippet: string;
    citationNumber: number;
  }[]>;
}

export interface LearningService {
  createTutoringSession(actor: ActorContext, studentId: UUID, conceptIds: UUID[]): Promise<{ sessionId: UUID }>;
  submitTutoringMessage(
    actor: ActorContext,
    sessionId: UUID,
    content: string,
    conceptId?: UUID
  ): Promise<{
    assistantContent: string;
    understandingDetected: boolean;
    masteryUpdated?: { confidence: number; band: MasteryBand };
  }>;
  getLearningPage(actor: ActorContext, conceptId: UUID): Promise<string>;
  getQuiz(actor: ActorContext, conceptId: UUID): Promise<{
    id: UUID;
    question: string;
    options: [string, string, string, string];
    questionOrder: number;
  }[]>;
  submitQuiz(
    actor: ActorContext,
    studentId: UUID,
    conceptId: UUID,
    answers: { questionId: UUID; selectedOption: number }[]
  ): Promise<{
    attemptId: UUID;
    score: number;
    correctCount: number;
    totalQuestions: number;
    newConfidence: number;
    newBand: MasteryBand;
  }>;
}
```

---

## 6. Realtime Publishing & Zoom Ports (Lanes B & Platform)

```typescript
export interface RealtimePublisher {
  emitToLecture(lectureId: UUID, event: string, payload: unknown): Promise<void>;
  emitToTeacher(lectureId: UUID, event: string, payload: unknown): Promise<void>;
  emitToStudent(studentId: UUID, event: string, payload: unknown): Promise<void>;
  emitToStudyGroup(matchId: UUID, event: string, payload: unknown): Promise<void>;
}

export interface ZoomAdapter {
  isConfigured(): boolean;
  createMeeting(
    teacherAuth: { zoomClientId: string; zoomClientSecret: string; zoomRefreshToken: string },
    topic: string,
    startTime: ISOTimestamp,
    durationMinutes: number
  ): Promise<{ meetingId: string; joinUrl: string }>;
  validateWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean;
}
```

---

## 7. Spark Experience & Game Progression Ports (Phase 1 Extensions)

```typescript
export type SparkForm = "ember" | "spark" | "glow" | "nova";
export type EncounterSource = "star" | "daily" | "eclipse" | "party";
export type HintLevel = 1 | 2 | 3;

export interface DailyQuestDTO {
  id: UUID;
  studentId: UUID;
  date: string; // YYYY-MM-DD, UTC
  items: {
    conceptId: UUID;
    confidence: number;
    band: MasteryBand;
    reviewState: "unreviewed" | "overdue" | "current";
    completed: boolean;
  }[];
  clearedAt: ISOTimestamp | null;
  version: number;
}

export interface GameSummaryDTO {
  studentId: UUID;
  courseId: UUID;
  xp: number;
  streakDays: number;
  skyBrightness: number; // 0..1, formatted as a percentage
  form: SparkForm;
  formProgress: number; // 0..1; Nova is 1
  updatedAt: ISOTimestamp;
}

export interface EclipseDTO {
  studentId: UUID;
  strength: number; // integer 0..100
  targets: { conceptId: UUID; confidence: number; band: MasteryBand }[];
  examAt: ISOTimestamp | null;
}

export type CreateEncounterInput =
  | { conceptId: UUID; source: "star" | "eclipse" }
  | { conceptId: UUID; source: "daily"; questId: UUID }
  | { conceptId: UUID; source: "party"; partyQuestId: UUID };

export interface EncounterDTO {
  id: UUID;
  studentId: UUID;
  conceptId: UUID;
  source: EncounterSource;
  questId: UUID | null;
  partyQuestId: UUID | null;
  status: "active" | "completed" | "abandoned";
  questions: {
    questionId: UUID;
    question: string;
    options: [string, string, string, string];
    hintsUsed: number;
  }[]; // exactly five
  version: number;
}

export interface EncounterResultDTO {
  encounterId: UUID;
  attemptId: UUID;
  score: number;
  correctCount: number;
  totalQuestions: 5;
  newConfidence: number;
  newBand: MasteryBand;
  feedback: {
    questionId: UUID;
    correct: boolean;
    correctOption: number;
    explanation: string;
  }[];
  xpAwarded: number; // 0 if daily practice award was already used
  summary: GameSummaryDTO;
  dailyQuest: DailyQuestDTO | null;
}

export interface CourseEffortDTO {
  studentId: UUID;
  name: string;
  xp: number;
  averageConfidence: number;
  flag: "high_effort_low_mastery" | null;
}

export interface GameService {
  getDailyQuest(actor: ActorContext, studentId: UUID): Promise<DailyQuestDTO>;
  getSummary(actor: ActorContext, studentId: UUID): Promise<GameSummaryDTO>;
  getEclipse(actor: ActorContext, studentId: UUID): Promise<EclipseDTO>;
  getCourseEffort(actor: ActorContext, courseId: UUID): Promise<CourseEffortDTO[]>;
}

export interface EncounterService {
  createEncounter(actor: ActorContext, studentId: UUID, input: CreateEncounterInput): Promise<EncounterDTO>;
  getEncounter(actor: ActorContext, encounterId: UUID): Promise<{ encounter: EncounterDTO; result: EncounterResultDTO | null }>;
  getHint(actor: ActorContext, encounterId: UUID, questionId: UUID, level: HintLevel): Promise<{ questionId: UUID; level: HintLevel; text: string }>;
  submitEncounter(actor: ActorContext, encounterId: UUID, answers: { questionId: UUID; selectedOption: number }[]): Promise<EncounterResultDTO>;
}
```
