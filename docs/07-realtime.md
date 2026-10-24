# Real-Time WebSocket Protocols: Socket.IO 4 Specifications

This document specifies the real-time bidirectional communication layer powered by Socket.IO 4, mounted on the Node.js persistent server.

---

## 1. Connection Security & Room Authorization

### 1.1 Handshake Authentication
All WebSocket connections require an authenticated handshake. Clients supply the Supabase JWT via auth payload:
```typescript
const socket = io({
  auth: {
    token: "<supabase_access_token>"
  }
});
```
- The server validates the token using Supabase `auth.getUser(token)`. Connections with invalid or expired tokens are immediately rejected with `401 Unauthorized`.
- **Identity Invariant (INV-R01)**: The server strictly derives the user's `userId`, `role` (`teacher` | `student`), and authorized course/student IDs from verified database state. Client query parameters asserting role or student identity are ignored.

### 1.2 Room Topology & Membership Rules
Clients join isolated rooms to receive targeted broadcasts:

| Room Pattern | Authorization Constraint | Target Audience |
|---|---|---|
| `lecture:<lectureId>` | Student enrolled in course OR course teacher | Broadcasts lecture events (chunks, polls, ended) |
| `professor:<lectureId>` | Verified course teacher ONLY | Real-time aggregate heatmap, student active counts |
| `student:<studentId>` | Owning student ONLY (`auth_id` match) | Private poll evaluations, private mastery updates |
| `study-group:<matchId>` | Either of the two matched students | Peer-to-peer chat notifications, scheduling updates |

*Security Rule: Attempting to join a room without authorization returns a socket acknowledgment error `{ success: false, error: "FORBIDDEN" }`.*

---

## 2. Event Specifications & Payload Schemas

All server-to-client events include standard metadata:
- `eventId`: Unique UUID for client deduplication.
- `occurredAt`: UTC ISO-8601 timestamp.
- Monotonic entity `version` or timestamp.

### 2.1 Client-to-Server Events

#### `lecture:join`
Client requests entry to a lecture session room.
- **Payload**: `{ lectureId: string }`
- **Ack Response**: `{ success: boolean, error?: string }`
- **Side Effect**: If student, increments active connection count and activates lecture attendance.

#### `lecture:leave`
Client cleanly leaves a lecture session room.
- **Payload**: `{ lectureId: string }`
- **Ack Response**: `{ success: boolean }`
- **Side Effect**: Decrements student connection count; if zero, ends active attendance tracking.

#### `study-group:join`
Client enters an active peer study group room.
- **Payload**: `{ matchId: string }`
- **Ack Response**: `{ success: boolean, error?: string }`

#### `study-group:leave`
Client leaves a peer study group room.
- **Payload**: `{ matchId: string }`
- **Ack Response**: `{ success: boolean }`

---

### 2.2 Server-to-Client Events

#### `transcript:chunk`
Broadcast to `lecture:<lectureId>` when new lecture speech is ingested.
```typescript
interface TranscriptChunkEvent {
  eventId: string;
  occurredAt: string;
  chunkId: string;
  lectureId: string;
  text: string;
  timestampSec: number;
  speakerName?: string;
}
```

#### `lecture:concept-detected`
Broadcast to `lecture:<lectureId>` when concept detection identifies topics in recent speech.
```typescript
interface ConceptDetectedEvent {
  eventId: string;
  occurredAt: string;
  lectureId: string;
  conceptIds: string[]; // Concept UUIDs active in the knowledge graph
}
```

#### `poll:new-question`
Broadcast to `lecture:<lectureId>` when the teacher activates a poll.
```typescript
interface PollNewQuestionEvent {
  eventId: string;
  occurredAt: string;
  pollId: string;
  lectureId: string;
  conceptId: string;
  question: string;
  status: "active";
  activatedAt: string;
}
```
*Privacy Rule: Expected answers or grading rubrics MUST NEVER be included in this broadcast.*

#### `poll:closed`
Broadcast to `lecture:<lectureId>` when the teacher closes the active poll.
```typescript
interface PollClosedEvent {
  eventId: string;
  occurredAt: string;
  pollId: string;
  lectureId: string;
  status: "closed";
  closedAt: string;
}
```

#### `mastery:updated`
Emitted strictly to private `student:<studentId>` room upon confidence mutation.
```typescript
interface MasteryUpdatedEvent {
  eventId: string;
  occurredAt: string;
  studentId: string;
  conceptId: string;
  confidence: number;
  band: "gray" | "red" | "yellow" | "green";
  evidenceType: "poll" | "tutor" | "quiz" | "attendance";
  attempts: number;
  version: number;
}
```

#### `heatmap:updated`
Emitted strictly to `professor:<lectureId>` room when student responses alter course aggregates.
```typescript
interface HeatmapUpdatedEvent {
  eventId: string;
  occurredAt: string;
  courseId: string;
  totalStudents: number;
  conceptId: string;
  distribution: {
    gray: number;
    red: number;
    yellow: number;
    green: number;
  };
  averageConfidence: number;
}
```

#### `lecture:ended`
Broadcast to `lecture:<lectureId>` when the teacher concludes the lecture.
```typescript
interface LectureEndedEvent {
  eventId: string;
  occurredAt: string;
  lectureId: string;
  endedAt: string;
}
```

#### `lecture:summary-ready`
Broadcast to `lecture:<lectureId>` when automated summarization concludes.
```typescript
interface LectureSummaryReadyEvent {
  eventId: string;
  occurredAt: string;
  lectureId: string;
  summary: string;
  keyConceptsCovered: string[];
}
```

#### `study-group:matched`
Emitted to individual `student:<studentId>` rooms when a consensual peer match is formed.
```typescript
interface StudyGroupMatchedEvent {
  eventId: string;
  occurredAt: string;
  matchId: string;
  courseId: string;
  conceptIds: string[];
  peerName: string; // First name / display name of matched peer
}
```

#### `study-group:message`
Broadcast to `study-group:<matchId>` when a peer sends an in-app message.
```typescript
interface StudyGroupMessageEvent {
  eventId: string;
  occurredAt: string;
  messageId: string;
  matchId: string;
  senderId: string;
  content: string;
}
```

#### `study-group:updated`
Broadcast to `study-group:<matchId>` when scheduling status or Zoom link updates.
```typescript
interface StudyGroupUpdatedEvent {
  eventId: string;
  occurredAt: string;
  matchId: string;
  schedulingStatus: "pending" | "proposed" | "accepted" | "no-overlap";
  proposedSlot?: { startsAt: string; endsAt: string };
  student1Accepted: boolean;
  student2Accepted: boolean;
  zoomLink?: string;
  meetingStatus: "pending" | "created" | "unavailable";
}
```

#### `game:updated`
Emitted privately to `student:<studentId>` when XP is awarded, a Daily Quest item is marked complete, or the quest clears.
```typescript
interface GameUpdatedEvent {
  eventId: string;
  occurredAt: string; // UTC ISO-8601
  studentId: string;
  updatedAt: string;  // Database commit-derived timestamp
  summary: GameSummaryDTO;
  dailyQuest: DailyQuestDTO | null;
}
```
*Invariant*: Sockets emit `game:updated` ONLY after underlying database mutations to `xp_events`, `daily_quests`, or `student_mastery` have committed to PostgreSQL.

#### `party:quest-updated`
Broadcast to `study-group:<matchId>` when either peer completes a quiz for a shared concept or the party quest clears.
```typescript
interface PartyQuestUpdatedEvent {
  eventId: string;
  occurredAt: string; // UTC ISO-8601
  matchId: string;
  partyQuestId: string;
  version: number;
  status: "active" | "completed" | "cancelled";
  completedPairs: number;
  totalPairs: number;
}
```
*Invariant*: Emitted only after `party_quest_progress` and any resulting `xp_events` are committed.

---

## 3. Attendance Tracking & Connection Lifecycle

To ensure reliable lecture attendance evidence without false disconnects:
1. **Reference Counting**: The server maintains an in-memory map of `activeConnections: Map<studentId, Set<socketId>>` partitioned by `lectureId`.
2. **Tab Redundancy**: If a student opens multiple browser tabs to the same lecture, each socket registers in the set. Closing one tab decrements the count; attendance remains active until the set becomes empty.
3. **Grace Period**: If a student's last socket disconnects unexpectedly, a 30-second grace timer starts before attendance tracking is suspended, preventing brief Wi-Fi blips from disrupting continuous exposure calculations.

---

## 4. Reconnection & Snapshot Hydration Protocol

Socket transport delivery is at-most-once. If a client disconnects, missed WebSocket packets are NOT queued in memory for replay. Instead, clients follow a strict hydration protocol:

```text
┌─────────────────┐       ┌──────────────────────┐       ┌────────────────────────┐
│  Client Mobile  │       │   Socket.IO Server   │       │   Express HTTP API     │
└────────┬────────┘       └──────────┬───────────┘       └───────────┬────────────┘
         │                           │                               │
         │ (Network Drop)            │                               │
         │                           │                               │
         │ Reconnects & Authenticates│                               │
         │──────────────────────────>│                               │
         │ Socket 'connect' fired    │                               │
         │<──────────────────────────│                               │
         │                           │                               │
         │ Re-join Lecture Room      │                               │
         │ emit("lecture:join")      │                               │
         │──────────────────────────>│                               │
         │                           │                               │
         │ Fetch Authoritative State Snapshot                        │
         │ GET /api/lectures/:id/snapshot                            │
         │──────────────────────────────────────────────────────────>│
         │ Rehydrates active poll, recent chunks, active concepts    │
         │<──────────────────────────────────────────────────────────│
```

### 4.1 Game Progression & Study Group Snapshot Hydration
Reconnecting student and peer clients MUST NOT infer committed learning or progression state from local animation timers or guessed increments. Upon reconnection:
1. **Student Game State**: The client calls `GET /api/students/:studentId/game-summary` and `GET /api/students/:studentId/daily-quest` to rehydrate authoritative XP, streak, sky brightness, and Daily Quest completion subsets.
2. **Peer Collaboration State**: Matched clients in an active study group call `GET /api/study-groups/:matchId/quests` and `GET /api/study-groups/:matchId/messages` to rehydrate current party quest completion and peer chat.
3. **Tie-Breaking Concurrency**: If concurrent socket notifications arrive with equal timestamps, the client breaks ties by fetching the fresh authenticated HTTP snapshot.

---

## 5. Zoom RTMS & Simulator Streaming Architecture

1. **Zoom Real-Time Media Streams (RTMS)**: In live mode (`LECTURE_SOURCE=zoom`), the backend establishes an authenticated streaming connection to Zoom's RTMS server for the active meeting. Audio packets or live transcription strings are piped into `ClassroomService.ingestTranscriptChunk()`.
2. **Lecture Simulator (`LECTURE_SOURCE=simulator`)**: In testing and demo mode, an in-process ticker reads pre-recorded lecture scripts, emitting chunks at realistic speech cadences (e.g., one sentence every 4 seconds) to exercise concept detection and poll generation identically to live audio.
