# HTTP REST API Contracts: Express 5 Routes

This document specifies the canonical HTTP REST API contracts implemented in Express 5 under the `/api/*` path prefix.

---

## 1. Global Standards & Error Envelopes

### 1.1 Content Types & Headers
- All request and response bodies use `Content-Type: application/json; charset=utf-8` (except multipart file upload).
- Endpoints returning personal learner or instructor data MUST include `Cache-Control: private, no-store`.
- Clients authenticate by supplying `Authorization: Bearer <supabase_jwt>`.

### 1.2 Standard Error Envelope
All error responses return a standardized JSON error object:
```typescript
interface ApiError {
  error: {
    code: string;       // UPPER_SNAKE_CASE domain error code
    message: string;    // Human-readable diagnostic description
    requestId: string;  // Correlation UUID for distributed tracing
  };
}
```

### 1.3 Standard HTTP Status Codes
| Code | Meaning | Typical Domain Scenario |
|---|---|---|
| `200 OK` | Success | Query, update, or synchronous execution succeeded. |
| `201 Created` | Resource Created | Resource persisted successfully (e.g., course, lecture, poll). |
| `400 Bad Request` | Syntax / Validation Failure | Zod schema validation failed on request body or parameters. |
| `401 Unauthorized` | Missing / Invalid Token | Bearer token missing, expired, or invalid. |
| `403 Forbidden` | Authorization Denial | User lacks required role (`teacher` vs `student`) or course enrollment. |
| `404 Not Found` | Entity Missing | Requested ID does not exist within the authorized scope. |
| `409 Conflict` | State Machine Conflict | Active poll exists, duplicate response, graph exists, out-of-sequence hint, or duplicate encounter submit. |
| `413 Payload Too Large` | Upload Limit Exceeded | Uploaded PDF syllabus exceeds 50 MiB limit. |
| `422 Unprocessable` | Domain / Provider Error | Malformed AI output or cyclical graph structure detected. |
| `502 Bad Gateway` | Upstream API Failure | OpenRouter or Zoom returned an upstream network error. |
| `503 Service Unavailable` | Provider Not Configured | Capability disabled or API keys missing in live integration mode. |
| `504 Gateway Timeout` | Timeout Exceeded | AI or Zoom pipeline exceeded per-capability SLA timeout. |

### 1.4 Spark Progression & Encounter Error Codes
| Code | HTTP Status | Domain Cause | Correct Client Action |
|---|---|---|---|
| `ENCOUNTER_ALREADY_SUBMITTED` | `409 Conflict` | Attempted to request hint or re-submit answers on completed Encounter. | Display existing result; do not allow additional submissions. |
| `HINT_OUT_OF_SEQUENCE` | `409 Conflict` | Requested hint level without first unlocking the preceding tier ($1 \to 2 \to 3$). | Request next available sequential tier. |
| `INVALID_HINT_LEVEL` | `400 Bad Request` | Requested hint level is outside $\{1, 2, 3\}$. | Request level 1, 2, or 3. |
| `INVITATION_EXPIRED` | `409 Conflict` | Responded to an invitation whose 5-minute pool entry has expired. | Re-enter study pool to seek fresh match. |
| `INVITATION_ALREADY_RESOLVED`| `409 Conflict` | Attempted to accept/decline an already resolved invitation. | Refresh study group status. |

### 1.5 Standard List Pagination
List responses return a cursor-paginated envelope:
```typescript
interface PaginatedList<T> {
  items: T[];
  nextCursor?: string; // Base64-encoded cursor or null if end of list
}
```
Default limit is 50 items; maximum allowed limit is 100 items.

---

## 2. Family A: Platform, Core & Course Management

### `GET /api/health`
- **Auth**: None (Public).
- **Response `200 OK`**: `{ status: "ok", timestamp: string, version: string, mode: "fixture" | "live" }`

### `POST /api/auth/signup`
- **Auth**: None (Public).
- **Body**: `{ email: string, password: string, name: string, role: "teacher" | "student" }`
- **Response `201 Created`**: `{ user: { id: string, email: string, name: string, role: string }, session: { accessToken: string, refreshToken: string } }`

### `POST /api/auth/login`
- **Auth**: None (Public).
- **Body**: `{ email: string, password: string }`
- **Response `200 OK`**: `{ user: { id: string, email: string, name: string, role: string }, session: { accessToken: string, refreshToken: string } }`

### `POST /api/auth/logout`
- **Auth**: Bearer token required.
- **Response `200 OK`**: `{ success: true }`

### `GET /api/auth/me`
- **Auth**: Bearer token required.
- **Response `200 OK`**: `{ id: string, email: string, name: string, role: "teacher" | "student", teacherId?: string, enrollments: { studentId: string, courseId: string, courseName: string }[] }`

### `GET /api/courses`
- **Auth**: Bearer token required.
- **Response `200 OK`**: `CourseDTO[]` (returns courses owned if teacher, or enrolled courses if student).

### `POST /api/courses`
- **Auth**: Teacher role required.
- **Body**: `{ name: string, description?: string }`
- **Response `201 Created`**: `CourseDTO` (includes generated `joinCode`, e.g. `"CS229-8F"`).

### `GET /api/courses/:courseId`
- **Auth**: Enrolled student or course owner.
- **Response `200 OK`**: `CourseDTO`

### `POST /api/courses/enroll`
- **Auth**: Authenticated student.
- **Body**: `{ joinCode: string }`
- **Response `200 OK`**: `{ studentId: string, courseId: string, courseName: string }` (Idempotent: returns existing enrollment if already enrolled).

### `POST /api/courses/:courseId/upload`
- **Auth**: Course teacher.
- **Content-Type**: `multipart/form-data` (file: `syllabus`, max 50 MiB).
- **Response `200 OK`**: 
  ```typescript
  {
    courseId: string;
    totalPages: number;
    processedPages: number; // min(totalPages, 10)
    truncated: boolean;
    preview: {
      concepts: { label: string; description: string; category: string; difficulty: number }[];
      edges: [string, string][]; // [sourceLabel, targetLabel]
    };
  }
  ```

### `POST /api/courses/:courseId/graph`
- **Auth**: Course teacher.
- **Body**: `{ concepts: ConceptInputDTO[], edges: [string, string][] }`
- **Response `201 Created`**: `{ success: true, nodeCount: number, edgeCount: number }`
- **Errors**: `409 GRAPH_ALREADY_EXISTS` if course already has committed concepts.

### `GET /api/courses/:courseId/graph`
- **Auth**: Enrolled student or teacher.
- **Response `200 OK`**:
  ```typescript
  {
    nodes: { id: string; label: string; description: string; category: string; difficulty: number; importance: number; confidence?: number; band?: "gray" | "red" | "yellow" | "green" }[];
    edges: { id: string; source: string; target: string; relationship: string }[];
  }
  ```

### `GET /api/courses/:courseId/heatmap`
- **Auth**: Course teacher.
- **Response `200 OK`**:
  ```typescript
  {
    courseId: string;
    totalStudents: number;
    concepts: {
      conceptId: string;
      label: string;
      category: string;
      distribution: { gray: number; red: number; yellow: number; green: number };
      averageConfidence: number;
    }[];
  }
  ```

### `GET /api/courses/:courseId/students`
- **Auth**: Course teacher.
- **Query**: `?limit=50&cursor=...`
- **Response `200 OK`**: `PaginatedList<{ studentId: string; name: string; email: string; enrolledAt: string; averageConfidence: number }>`

### `GET /api/courses/:courseId/students/summary`
- **Auth**: Course teacher.
- **Response `200 OK`**: `{ totalEnrolled: number, activeInLecture: number, strugglingCount: number, developingCount: number, masteredCount: number }`

### `PUT /api/courses/:courseId/exam`
- **Auth**: Course teacher.
- **Body**: `{ examAt: string | null }` (UTC ISO-8601 or null to clear)
- **Response `200 OK`**: `{ success: true, examAt: string | null }`

### `GET /api/courses/:courseId/students/effort`
- **Auth**: Course teacher.
- **Response `200 OK`**: `CourseEffortDTO[]` (Student effort XP, average confidence, and `high_effort_low_mastery` intervention flags)

### `GET /api/students/:studentId/mastery`
- **Auth**: Student self or course teacher.
- **Response `200 OK`**:
  ```typescript
  {
    studentId: string;
    courseId: string;
    overallConfidence: number;
    concepts: {
      conceptId: string;
      label: string;
      confidence: number;
      band: "gray" | "red" | "yellow" | "green";
      attempts: number;
      lastUpdated: string;
    }[];
  }
  ```

### `GET /api/concepts/:conceptId`
- **Auth**: Authenticated member.
- **Response `200 OK`**: `ConceptDTO`

---

## 3. Family B: Classroom, Live Lectures & Formative Polls

### `GET /api/courses/:courseId/lectures`
- **Auth**: Enrolled student or teacher.
- **Response `200 OK`**: `LectureDTO[]`

### `POST /api/courses/:courseId/lectures`
- **Auth**: Course teacher.
- **Body**: `{ title: string }`
- **Response `201 Created`**: `LectureDTO` (status: `"live"`, `startedAt: string`)

### `GET /api/lectures/:lectureId`
- **Auth**: Enrolled student or teacher.
- **Response `200 OK`**: `LectureDTO`

### `POST /api/lectures/:lectureId/end`
- **Auth**: Course teacher.
- **Response `200 OK`**: `LectureDTO` (status: `"completed"`, `endedAt: string`)

### `GET /api/lectures/:lectureId/snapshot`
- **Auth**: Enrolled student or teacher.
- **Response `200 OK`**:
  ```typescript
  {
    lecture: LectureDTO;
    activePoll: PublicPollDTO | null; // Public projection: expectedAnswer stripped
    recentChunks: TranscriptChunkDTO[];
    activeConceptIds: string[];
  }
  ```

### `POST /api/lectures/:lectureId/transcript`
- **Auth**: Course teacher or trusted internal adapter (Zoom RTMS / simulator).
- **Body**: `{ text: string, timestampSec: number, speakerName?: string }`
- **Response `201 Created`**: `{ chunkId: string, detectedConceptIds: string[] }`

### `GET /api/lectures/:lectureId/transcript-chunks`
- **Auth**: Enrolled student or teacher.
- **Query**: `?limit=50&cursor=...`
- **Response `200 OK`**: `PaginatedList<TranscriptChunkDTO>`

### `GET /api/lectures/:lectureId/transcript-excerpts`
- **Auth**: Enrolled student or teacher.
- **Query**: `?conceptId=UUID`
- **Response `200 OK`**: `TranscriptExcerptDTO[]`

### `GET /api/lectures/:lectureId/summary`
- **Auth**: Enrolled student or teacher.
- **Response `200 OK`**: `{ lectureId: string, summary: string, keyConceptsCovered: string[], generatedAt: string }`

### `POST /api/lectures/:lectureId/poll/generate`
- **Auth**: Course teacher.
- **Body**: `{ conceptId?: string }` (if omitted, uses recently detected concepts).
- **Response `201 Created`**: `PollDTO` (status: `"draft"`, includes generated question and expected answer).

### `GET /api/lectures/:lectureId/polls`
- **Auth**: Course teacher.
- **Response `200 OK`**:
  ```typescript
  {
    lectureId: string;
    draft: { poll: PollDTO; responseCount: number } | null;
    active: { poll: PollDTO; responseCount: number } | null;
    closed: { poll: PollDTO; responseCount: number } | null;
  }
  ```

### `PATCH /api/polls/:pollId`
- **Auth**: Course teacher.
- **Body**: `{ question: string; expectedAnswer: string }`
- **Response `200 OK`**: `PollDTO` (status: `"draft"`, saved question and expected answer).
- **Errors**: `400 INVALID_POLL_STATUS` if poll is not in draft status; `404 NOT_FOUND` if absent.

### `POST /api/polls/:pollId/activate`
- **Auth**: Course teacher.
- **Response `200 OK`**: `PollDTO` (status: `"active"`, `activatedAt: string`).
- **Errors**: `409 ACTIVE_POLL_EXISTS` if another poll is active in this lecture.

### `POST /api/polls/:pollId/respond`
- **Auth**: Enrolled student attending lecture.
- **Body**: `{ answer: string }`
- **Response `200 OK`**:
  ```typescript
  {
    responseId: string;
    status: "evaluated";
    evaluation: {
      outcome: "correct" | "partial" | "wrong";
      feedback: string;
    };
    newConfidence: number;
    newBand: "gray" | "red" | "yellow" | "green";
  }
  ```
- **Errors**: `400 INVALID_POLL_STATUS` if poll is closed; `409 RESPONSE_ALREADY_SUBMITTED` on conflicting duplicate.

### `POST /api/polls/:pollId/close`
- **Auth**: Course teacher.
- **Response `200 OK`**: `PollDTO` (status: `"closed"`, `closedAt: string`)

### `POST /api/lectures/:lectureId/interventions`
- **Auth**: Course teacher.
- **Response `200 OK`**:
  ```typescript
  {
    lectureId: string;
    misconceptions: string[];
    recommendations: {
      title: string;
      description: string;
      actionablePrompt: string;
    }[];
  }
  ```

---

## 4. Family C: Autonomous Learning, Tutoring & Quizzes

### `POST /api/tutoring/sessions`
- **Auth**: Enrolled student.
- **Body**: `{ conceptIds: string[] }`
- **Response `201 Created`**: `{ sessionId: string, studentId: string, targetConcepts: string[], startedAt: string }`

### `GET /api/tutoring/sessions/:sessionId/messages`
- **Auth**: Owning student.
- **Response `200 OK`**: `TutoringMessageDTO[]`

### `POST /api/tutoring/sessions/:sessionId/messages`
- **Auth**: Owning student.
- **Body**: `{ content: string, conceptId?: string }`
- **Response `200 OK`**:
  ```typescript
  {
    userMessage: TutoringMessageDTO;
    assistantMessage: TutoringMessageDTO;
    understandingDetected: boolean;
    masteryUpdated?: {
      conceptId: string;
      newConfidence: number;
      newBand: "gray" | "red" | "yellow" | "green";
    };
  }
  ```

### `GET /api/concepts/:conceptId/learning-page`
- **Auth**: Enrolled student or teacher.
- **Response `200 OK`**: `{ conceptId: string, content: string, lastUpdated: string }`

### `POST /api/concepts/:conceptId/learning-page/generate`
- **Auth**: Teacher or student.
- **Response `201 Created`**: `{ conceptId: string, content: string, generatedAt: string }`

### `GET /api/concepts/:conceptId/quiz`
- **Auth**: Enrolled student.
- **Response `200 OK`**:
  ```typescript
  {
    conceptId: string;
    questions: {
      id: string;
      question: string;
      options: [string, string, string, string]; // options without revealing correct answer index
      questionOrder: number;
    }[];
  }
  ```

### `POST /api/concepts/:conceptId/quiz/generate`
- **Auth**: Course teacher or system.
- **Response `201 Created`**: `{ conceptId: string, questionCount: number }`

### `POST /api/concepts/:conceptId/quiz-submit`
- **Auth**: Enrolled student.
- **Body**: `{ answers: { questionId: string; selectedOption: number }[] }`
- **Response `200 OK`**:
  ```typescript
  {
    attemptId: string;
    conceptId: string;
    score: number;        // e.g. 0.80
    correctCount: number; // e.g. 4
    totalQuestions: number;
    feedback: {
      questionId: string;
      correct: boolean;
      correctOption: number;
      explanation: string;
    }[];
    masteryDelta: number; // e.g. +0.15
    newConfidence: number;
    newBand: "gray" | "red" | "yellow" | "green";
  }
  ```

### `POST /api/resources/search`
- **Auth**: Enrolled student or teacher.
- **Body**: `{ conceptId: string, query?: string }`
- **Response `200 OK`**: `{ conceptId: string, resources: { title: string; url: string; snippet: string; citationNumber: number }[] }`

### `POST /api/resources/ask`
- **Auth**: Enrolled student or teacher.
- **Body**: `{ conceptId: string, question: string }`
- **Response `200 OK`**: `{ answer: string, citations: { number: number; title: string; url: string }[] }`

---

## 5. Family B (Collaboration & Zoom): Study Groups & Video

### `GET /api/courses/:courseId/study-groups/availability`
- **Auth**: Enrolled student.
- **Response `200 OK`**: `AvailabilityIntervalDTO[]`

### `PUT /api/courses/:courseId/study-groups/availability`
- **Auth**: Enrolled student.
- **Body**: `{ intervals: { startsAt: string; endsAt: string }[] }`
- **Response `200 OK`**: `AvailabilityIntervalDTO[]`

### `POST /api/courses/:courseId/study-groups/opt-in`
- **Auth**: Enrolled student.
- **Body**: `{ conceptIds: string[] }` (1 to 3 concepts).
- **Response `200 OK`**: `{ status: "waiting" | "matched", matchId?: string, expiresAt: string }`

### `POST /api/courses/:courseId/study-groups/opt-out`
- **Auth**: Enrolled student.
- **Response `200 OK`**: `{ success: true }`

### `GET /api/courses/:courseId/study-groups/status`
- **Auth**: Enrolled student.
- **Response `200 OK`**: `{ inPool: boolean, poolStatus?: string, activeMatch?: StudyGroupMatchDTO }`

### `GET /api/courses/:courseId/study-groups/candidates`
- **Auth**: Enrolled student currently waiting in study pool.
- **Response `200 OK`**:
  ```typescript
  {
    candidates: {
      studentId: string;
      requestedConcepts: { conceptId: string; label: string; band: "gray" | "red" | "yellow" | "green" }[];
      complementaryGap: number; // e.g. 0.45
      fitKind: "reciprocal" | "mentor";
    }[];
  }
  ```
- *Note*: Only returns candidates who have explicitly opted into the pool within the 5-minute validity window and meet the $\ge 0.30$ knowledge gap threshold.

### `POST /api/courses/:courseId/study-groups/invitations`
- **Auth**: Enrolled student currently waiting in study pool.
- **Body**: `{ inviteeId: string, conceptIds: string[] }`
- **Response `201 Created`**: `{ invitationId: string, status: "pending", expiresAt: string }`

### `POST /api/study-group-invitations/:invitationId/respond`
- **Auth**: Target invitee student.
- **Body**: `{ decision: "accepted" | "declined" }`
- **Response `200 OK`**: `{ status: "accepted" | "declined", matchId?: string }`

### `POST /api/study-groups/:matchId/quests`
- **Auth**: Matched peer student.
- **Body**: `{ conceptIds: string[] }` (Length 1–3)
- **Response `201 Created`**: `{ partyQuestId: string, status: "active", conceptIds: string[] }`

### `GET /api/study-groups/:matchId/quests`
- **Auth**: Matched peer student.
- **Response `200 OK`**:
  ```typescript
  {
    partyQuests: {
      partyQuestId: string;
      conceptIds: string[];
      status: "active" | "completed" | "cancelled";
      progress: {
        studentId: string;
        conceptId: string;
        completed: boolean;
      }[];
    }[];
  }
  ```

### `GET /api/study-groups/:matchId/messages`
- **Auth**: Matched peer student.
- **Response `200 OK`**: `StudyGroupMessageDTO[]`

### `POST /api/study-groups/:matchId/messages`
- **Auth**: Matched peer student.
- **Body**: `{ content: string }`
- **Response `201 Created`**: `StudyGroupMessageDTO`

### `POST /api/study-groups/:matchId/schedule`
- **Auth**: Matched peer student.
- **Response `200 OK`**: `{ schedulingStatus: "proposed" | "no-overlap", proposedSlot?: { startsAt: string; endsAt: string } }`

### `POST /api/study-groups/:matchId/schedule/accept`
- **Auth**: Matched peer student.
- **Body**: `{ startsAt: string, endsAt: string }`
- **Response `200 OK`**: `{ schedulingStatus: "proposed" | "accepted", bothAccepted: boolean, zoomMeeting?: ZoomMeetingDTO }`

### `POST /api/study-groups/:matchId/meeting`
- **Auth**: Matched peer student.
- **Response `200 OK`**: `ZoomMeetingDTO` (returns existing meeting or triggers generation if accepted).

### `GET /api/teachers/:teacherId/zoom-credentials`
- **Auth**: Owning teacher.
- **Response `200 OK`**: `{ configured: boolean, clientIdPrefix?: string }` (Secrets are NEVER returned).

### `PUT /api/teachers/:teacherId/zoom-credentials`
- **Auth**: Owning teacher.
- **Body**: `{ zoomClientId: string, zoomClientSecret: string }`
- **Response `200 OK`**: `{ success: true }`

### `GET /api/zoom/status`
- **Auth**: Authenticated user.
- **Response `200 OK`**: `{ configured: boolean, rtmsAvailable: boolean }`

### `POST /webhook/zoom/:teacherId`
- **Auth**: Zoom Webhook HMAC verification (`ZOOM_SECRET_TOKEN`).
- **Body**: Raw Zoom webhook payload.
- **Response `200 OK`**: Zoom challenge verification or `{ status: "processed" }`.

### `GET /auth/zoom/callback`
- **Auth**: Zoom OAuth redirect handler with state verification.
- **Response**: Redirects to teacher dashboard with connection status.

---

## 6. Family E: Spark Experience, Habits & Encounters

### `GET /api/students/:studentId/daily-quest`
- **Auth**: Enrolled student self.
- **Response `200 OK`**: `DailyQuestDTO`

### `GET /api/students/:studentId/game-summary`
- **Auth**: Enrolled student self.
- **Response `200 OK`**: `GameSummaryDTO`

### `GET /api/students/:studentId/eclipse`
- **Auth**: Enrolled student self.
- **Response `200 OK`**: `EclipseDTO`

### `POST /api/students/:studentId/encounters`
- **Auth**: Enrolled student self.
- **Body**: `CreateEncounterInput`
  ```typescript
  // Exactly one variant:
  { conceptId: string, source: "star" | "eclipse" }
  | { conceptId: string, source: "daily", questId: string }
  | { conceptId: string, source: "party", partyQuestId: string }
  ```
- **Response `201 Created`**: `EncounterDTO` (Contains 5 questions, server-permuted options, 0 answer keys)

### `GET /api/encounters/:encounterId`
- **Auth**: Owning student.
- **Response `200 OK`**: `{ encounter: EncounterDTO, result: EncounterResultDTO | null }`

### `POST /api/encounters/:encounterId/hints`
- **Auth**: Owning student.
- **Body**: `{ questionId: string, level: 1 | 2 | 3 }`
- **Response `200 OK`**: `{ questionId: string, level: 1 | 2 | 3, text: string }`
- **Errors**:
  - `409 HINT_OUT_OF_SEQUENCE`: Attempted to request level 2 before level 1, or level 3 before level 2.
  - `400 INVALID_HINT_LEVEL`: Level outside $\{1, 2, 3\}$.
  - `409 ENCOUNTER_ALREADY_SUBMITTED`: Encounter has already been submitted.

### `POST /api/encounters/:encounterId/submit`
- **Auth**: Owning student.
- **Body**:
  ```typescript
  {
    answers: { questionId: string; selectedOption: number }[]; // Exactly five answers
  }
  ```
- **Response `200 OK`**: `EncounterResultDTO`
- **Errors**:
  - `409 ENCOUNTER_ALREADY_SUBMITTED`: Repeated conflicting submission. Identical re-submissions return existing result idempotently.
