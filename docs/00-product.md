# Product Specification: HackOHIO Classroom Companion

## 1. Product Vision & Personas

HackOHIO Classroom Companion is an educational intelligence system designed to eliminate the passive disconnect between live classroom instruction, individual student mastery, and peer study. The platform transforms course syllabi into living prerequisite knowledge graphs, streams live lecture transcripts to detect concepts on the fly, executes AI-driven formative evaluations, and arranges targeted, consensual peer study sessions.

### Primary Personas

#### 1. Teacher (Prof. Sarah Chen)
- **Role**: Course creator, lecturer, and instructional designer.
- **Goals**:
  - Automatically structure course syllabi into coherent, prerequisite-ordered knowledge graphs.
  - Monitor real-time student comprehension during live lectures without interrupting speech flow.
  - Deploy targeted formative polls and receive instant, objective evaluations of student reasoning.
  - Receive actionable, data-driven pedagogical interventions based on emerging student misconceptions.
  - Facilitate productive peer collaboration among struggling and proficient students.
- **Pain Points**: Lack of visibility into real-time student confusion; grading open-ended formative checks is too slow during class; inability to efficiently pair students who can teach each other.

#### 2. Student (Hari, Rahul)
- **Role**: Enrolled learner seeking concept mastery and academic support.
- **Goals**:
  - Understand how individual lecture topics connect to broader course prerequisites.
  - Receive immediate, constructive feedback on formative lecture checks without public embarrassment.
  - Engage in private Socratic tutoring tailored to specific weak concepts.
  - Access structured learning pages and self-paced, server-graded practice quizzes.
  - Find consenting study partners with complementary strengths and coordinate authentic study sessions.
- **Pain Points**: Falling behind when prerequisite concepts are shaky; generic chatbots that provide answers without teaching; isolated studying and difficult scheduling with peers.

---

## 2. Comprehensive Feature Inventory

### Feature Family A: Course Management & Knowledge Graphs
- **F-A01: Course Lifecycle**: Create courses, generate unique 8-character join codes, and manage teacher ownership.
- **F-A02: Student Enrollment**: Idempotent enrollment via join code; automatic initialization of personal concept mastery rows at `confidence = 0.0`.
- **F-A03: Bounded Syllabus Ingestion**: Ingest PDF syllabi up to 50 MiB, automatically bounding extraction to `min(pageCount, 10)` pages with clear UI truncation disclosure.
- **F-A04: Prerequisite DAG Generation**: Extract 30–40 foundational concepts and directed prerequisite edges (`source -> target` where source must precede target) using Anthropic Claude.
- **F-A05: Graph Preview & Commit**: Teacher visual preview of extracted concepts and edges with interactive graph inspection before irreversible database persistence.
- **F-A06: Prerequisite Validation**: Strict server-side verification ensuring graph acyclicity, no self-edges, valid node references, and incoming-degree prerequisite weighting.
- **F-A07: Interactive Graph Visualization**: D3-force rendering with prerequisite hierarchical levels, color-coded mastery bands, ancestor path highlighting, and responsive keyboard navigation.

### Feature Family B: Live Classroom & Formative Assessment
- **F-B01: Lecture Lifecycle**: Start, monitor, and conclude live lecture sessions with persistent session records.
- **F-B02: Dual Speech Ingestion**: Support live audio/transcript ingestion via Zoom Real-Time Media Streams (RTMS) or an automated lecture simulator with explicit UI provenance labels.
- **F-B03: Live Concept Detection**: Real-time sliding-window analysis of incoming transcript chunks to associate speech with active knowledge graph concepts.
- **F-B04: Ephemeral Lecture Attendance**: Reference-counted WebSocket tracking of active student connections; automatic attendance mastery evidence recorded after continuous concept exposure.
- **F-B05: Socratic Poll Generation**: Dynamic generation of open-ended, conceptual poll questions tied to currently discussed concepts.
- **F-B06: Poll State Machine**: Teacher-controlled lifecycle (`draft` -> `active` -> `closed`) with strict single-response submission and late-response rejection.
- **F-B07: Server-Side Poll Evaluation**: Objective grading of student answers against rubrics into discrete outcomes (`correct`, `partial`, `wrong`) with pedagogical feedback.
- **F-B08: Atomic Mastery Updates**: Immediate recalculation and transactional persistence of student confidence following poll evaluation.
- **F-B09: Class Heatmap & Roster**: Real-time aggregation of student confidence distributions across all course concepts for the teacher dashboard.
- **F-B10: Pedagogical Interventions**: On-demand AI synthesis of class-wide misconceptions and concrete instructional recommendations during class.
- **F-B11: Lecture Summarization**: Automated generation and persistence of lecture summaries, highlighted concepts, and timestamped transcript excerpts upon lecture completion.

### Feature Family C: Autonomous Learning & Tutoring
- **F-C01: Socratic Tutoring**: Private multi-turn AI chat focused on student-selected concepts; guides learning through questioning without leaking quiz or poll solutions.
- **F-C02: Understanding Evidence Recording**: Detection of student comprehension breakthroughs during tutoring, triggering a bounded mastery increase.
- **F-C03: Generated Learning Pages**: Comprehensive, Markdown-formatted concept guides featuring formal definitions, core mechanisms, worked examples, and common pitfalls.
- **F-C04: Practice Quizzes**: Five-question multiple-choice quizzes with randomized option order and server-side validation against precomputed answer keys.
- **F-C05: Cited Resource Discovery**: Live web search via Perplexity to fetch authoritative academic tutorials, papers, and videos with verified URLs.
- **F-C06: Resource Q&A**: Grounded Q&A against retrieved search context with strict citation requirements.

### Feature Family D: Consensual Peer Collaboration
- **F-D01: Opt-In Study Pool**: Ephemeral matchmaking queue where students select 1–3 concepts; automatic 5-minute pool entry expiration.
- **F-D02: Complementary Match Engine**: Algorithmic pairing based on complementary confidence gaps (mean absolute difference $\ge 0.30$ across overlapping concepts).
- **F-D03: Private Match Chat**: Secure, isolated in-app text messaging exclusively accessible to the two matched peers.
- **F-D04: Mutual Availability Scheduling**: Stored future UTC availability intervals $[startsAt, endsAt)$; automated identification of the earliest 30-minute mutual overlap.
- **F-D05: Dual-Consent Acceptance**: Mandatory bilateral acceptance of a proposed study slot before meeting confirmation.
- **F-D06: Genuine Zoom Scheduling**: Authentic Zoom meeting generation using the owning teacher's authorized Zoom credentials, returning genuine join URLs and meeting IDs.

---

## 3. End-to-End User Journeys (J01 – J08)

The system behavior is formally validated against eight end-to-end user journeys. Every journey defines a strict acceptance contract:

### Journey J01: Course Creation & Syllabus Ingestion
- **Persona**: Teacher (Prof. Chen).
- **Flow**:
  1. Teacher navigates to `/` and signs in via email/password.
  2. Creates course "CS229: Machine Learning" and receives a unique 8-character join code (e.g., `CS229-8F`).
  3. Uploads an 11-page syllabus PDF.
  4. System processes `min(11, 10) = 10` pages, renders a visual warning notifying the teacher that pages 11+ were truncated, and displays a preview of 33 extracted concepts and 34 prerequisite edges.
  5. Teacher inspects the preview, verifies that foundational concepts (e.g., "Vectors") precede applied concepts ("Matrices"), and clicks "Confirm Graph".
  6. System transactionally commits nodes and edges, creating initial zero-confidence mastery rows for any existing students.
- **Acceptance Criteria**:
  - `POST /api/courses/:courseId/upload` returns preview DTO with `totalPages: 11`, `processedPages: 10`, `truncated: true`.
  - `POST /api/courses/:courseId/graph` transactionally persists nodes and edges.
  - Second attempt to commit graph returns `409 GRAPH_ALREADY_EXISTS`.

### Journey J02: Student Onboarding & Prerequisite Navigation
- **Persona**: Student (Hari).
- **Flow**:
  1. Student signs in and submits join code `CS229-8F`.
  2. System idempotently enrolls Hari into CS229 and initializes 33 mastery rows with `confidence = 0.0` (all rendered in `gray`).
  3. Hari opens `/student/[studentId]` and views the interactive knowledge graph.
  4. Clicking on "Backpropagation" highlights its upstream prerequisite ancestors ("Chain Rule", "Derivatives", "Computational Graphs") with distinct visual links.
- **Acceptance Criteria**:
  - `POST /api/courses/enroll` returns `studentId` and course metadata.
  - All 33 concept nodes render with `gray` mastery status.
  - Ancestor traversal correctly identifies all transitive prerequisite paths.

### Journey J03: Live Lecture & Real-Time Attendance
- **Persona**: Teacher (Prof. Chen) and Students (Hari, Rahul).
- **Flow**:
  1. Teacher starts lecture "Lecture 4: Backpropagation & Computational Graphs" from dashboard.
  2. Hari and Rahul navigate to their student views; their browser sockets join `lecture:<lectureId>`.
  3. Lecture audio streams into the system (via Zoom RTMS or lecture simulator).
  4. System ingests transcript chunk: `"Today we derive the backpropagation algorithm using the chain rule on computational graphs."`
  5. Concept detection pipeline associates chunk with concepts: `Backpropagation`, `Chain Rule`, `Computational Graphs`.
  6. Sockets broadcast `transcript:chunk` and `lecture:concept-detected` to all attending clients.
  7. Clients display real-time transcript text and pulse the active concept nodes on the graph.
  8. System records continuous attendance; students with confidence $< 0.30$ receive an attendance boost of $+0.05$ (clamped to $0.30$).
- **Acceptance Criteria**:
  - Transcript chunks persist in database with timestamps and speaker attribution.
  - Attendance evidence updates database and emits `mastery:updated` to individual student rooms.
  - Disconnecting one tab does not terminate attendance if another student tab remains connected.

### Journey J04: Formative Socratic Poll Cycle
- **Persona**: Teacher (Prof. Chen) and Students (Hari, Rahul).
- **Flow**:
  1. Teacher clicks "Generate Poll" on dashboard.
  2. System calls Anthropic Claude with recent transcript chunks and concept context to generate an open-ended question: `"Why must we save the intermediate activations during the forward pass of backpropagation?"`
  3. Teacher reviews draft, edits rubric, and clicks "Activate Poll".
  4. Server transitions poll to `active` and broadcasts `poll:new-question` to `lecture:<lectureId>`.
  5. Hari submits answer: `"Because the chain rule requires local gradients evaluated at the forward values to compute weight updates."`
  6. Rahul submits answer: `"To make the network run faster during inference."`
  7. Server evaluates Hari as `correct` ($\text{confidence} \to \max(old, 0.85)$) and Rahul as `wrong` ($\text{confidence} \to \min(old, 0.20)$).
  8. Server transactionally commits responses and mastery evidence, then emits private `mastery:updated` events to Hari and Rahul.
  9. Teacher closes poll; teacher dashboard receives updated aggregated class heatmap.
- **Acceptance Criteria**:
  - Only one poll can be `active` at a time.
  - Hari's node turns `green` ($\ge 0.70$); Rahul's node turns `red` ($< 0.40$).
  - Hari never receives Rahul's private evaluation or score.
  - Repeated answer submissions return `409 RESPONSE_ALREADY_SUBMITTED`.

### Journey J05: Mid-Lecture Pedagogical Interventions
- **Persona**: Teacher (Prof. Chen).
- **Flow**:
  1. Observing high error rates on the backpropagation poll, teacher clicks "Suggest Interventions".
  2. System analyzes poll evaluations, student response clusters, and concept prerequisites.
  3. Anthropic pipeline identifies root misconception: *"Students are confusing computational graph storage requirements with inference optimization."*
  4. System returns two concrete teaching actions:
     - *"Pause and draw a 2-node scalar computational graph on the board, explicitly writing where $\frac{\partial z}{\partial x}$ is evaluated."*
     - *"Ask a follow-up question contrasting memory usage during training versus inference."*
  5. Teacher concludes lecture; system summarizes the session, links transcript excerpts, and persists the record.
- **Acceptance Criteria**:
  - `POST /api/lectures/:lectureId/interventions` returns concrete, course-specific recommendations within 30 seconds.
  - Lecture status transitions to `completed`; summary is queryable via `/api/lectures/:lectureId/summary`.

### Journey J06: Socratic Tutoring & Autonomous Review
- **Persona**: Student (Rahul).
- **Flow**:
  1. Rahul reviews low confidence ($0.20$) in "Backpropagation" and opens `/student/[studentId]/tutor`.
  2. Rahul initiates Socratic chat: `"I don't understand why activations are needed for backprop."`
  3. Tutor replies Socratically: `"Think about the function $f(x) = x^2$. What is its derivative with respect to $x$? Does computing that derivative require knowing the value of $x$?"`
  4. Rahul responds correctly; after multi-turn dialogue demonstrating understanding, tutor records understanding evidence.
  5. Confidence updates: $0.20 + 0.20 = 0.40$ (band changes from `red` to `yellow`).
  6. Rahul opens `/student/[studentId]/concepts/[conceptId]`, reads the comprehensive generated learning page, and takes a 5-question practice quiz.
  7. Server validates quiz submission ($4/5 = 80\%$) and awards $+0.15$ confidence boost $\to 0.55$.
  8. Rahul requests supplementary resources; Perplexity returns three verified external academic guides with valid URLs.
- **Acceptance Criteria**:
  - Tutoring messages and session state persist in database.
  - Practice quiz grading happens strictly on the server; client cannot submit arbitrary score deltas.
  - External search results include validated academic URLs and markdown citations.

### Journey J07: Consensual Peer Matching & Authentic Scheduling
- **Persona**: Students (Rahul - Confidence 0.40, Hari - Confidence 0.85).
- **Flow**:
  1. Rahul opts into the study-group pool for "Backpropagation" and submits available time: tomorrow 14:00–16:00 UTC.
  2. Hari opts into the pool for "Backpropagation" and submits availability: tomorrow 15:00–17:00 UTC.
  3. Matchmaker calculates score: $|0.85 - 0.40| = 0.45 \ge 0.30$.
  4. System transactionally matches Hari and Rahul, creating `study_group_matches` record and emitting `study-group:matched` to both students.
  5. Hari and Rahul open the peer view and exchange messages in real-time chat.
  6. System detects mutual 30-minute availability overlap: tomorrow 15:00–15:30 UTC, setting match state to `proposed`.
  7. Rahul clicks "Accept Proposed Time"; Hari clicks "Accept Proposed Time".
  8. Upon bilateral acceptance, server connects to Zoom API using Prof. Chen's OAuth credentials, generates a real Zoom meeting, and saves the authentic join URL and meeting ID.
- **Acceptance Criteria**:
  - Unconsenting classmates are never placed into matches.
  - Matches require complementary gap ($\ge 0.30$) and concept overlap.
  - Meeting is created only after both students accept; join URL is a real Zoom URL (`https://us05web.zoom.us/j/...`).

### Journey J08: Reproducible Seeded Demonstration & Deployment
- **Persona**: Evaluator / System Administrator.
- **Flow**:
  1. Administrator runs local Docker Supabase environment and executes database migrations.
  2. Executes deterministic seed script: seeds CS229 with 33 concepts, 34 edges, 1 teacher (Prof. Chen), 4 students (Hari, Rahul, Praj, Vamshi), and 132 mastery rows.
  3. Launches application with `INTEGRATION_MODE=fixture` and `npm run demo -- --mode=fixture --seed=42`.
  4. System runs an end-to-end automated multi-browser test verifying all features offline.
  5. Administrator deploys repository to persistent host (Render) with HTTPS/WSS, verifies environment variables via `npm run doctor`, and runs smoke tests.
- **Acceptance Criteria**:
  - Database seed produces exactly 33 concepts, 34 edges, and 132 mastery rows.
  - Fixture demo executes without external API keys or cloud dependencies.
  - Production deployment maintains persistent WebSocket connections and recovers state after server restarts.

---

## 4. Scope Exclusions & Simulation Disclosure

### Explicit Scope Exclusions
- **Exam / Problem Set Ingestion**: The system explicitly does not support ingesting historical exams, homework assignments, or automated solution key generation. Syllabus and lecture transcript ingestion constitute the complete content ingestion boundary.
- **Calendar Provider Synchronization**: The system manages peer study scheduling using internal, stored UTC availability intervals. Google Calendar and Microsoft Outlook two-way sync are explicitly excluded.

### Explicit Simulation Disclosure
- **Lecture Simulator**: In development, testing, and fixture demonstration modes, lecture transcripts may be generated via the internal lecture simulator (`LECTURE_SOURCE=simulator`). The user interface MUST display a prominent `[SIMULATED TRANSCRIPT]` indicator whenever simulated speech is active.
- **Provider Fallback Policy**: When `INTEGRATION_MODE=live` is configured, the system MUST NOT silently degrade to simulated or fixture responses if third-party credentials (Anthropic, Perplexity, Zoom) are missing or invalid. Missing credentials MUST raise an explicit `503 SERVICE_UNAVAILABLE` or error badge in the UI.
