# Product Specification: Spark

## 1. Product Vision & Personas

Spark is an educational intelligence system designed to eliminate the passive disconnect between live classroom instruction, individual student mastery, and peer study. The platform transforms course syllabi into living prerequisite knowledge graphs, streams live lecture transcripts to detect concepts on the fly, executes AI-driven formative evaluations, and arranges targeted, consensual peer study sessions.

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
- **F-A04: Prerequisite DAG Generation**: Extract 30–40 foundational concepts and directed prerequisite edges (`source -> target` where source must precede target) via OpenRouter.
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
- **F-C05: Cited Resource Discovery**: Live web search via OpenRouter (Perplexity search model) to fetch authoritative academic tutorials, papers, and videos with verified URLs.
- **F-C06: Resource Q&A**: Grounded Q&A against retrieved search context with strict citation requirements.

### Feature Family D: Consensual Peer Collaboration
- **F-D01: Opt-In Study Pool**: Ephemeral matchmaking queue where students select 1–3 concepts; automatic 5-minute pool entry expiration.
- **F-D02: Complementary Match Engine**: Algorithmic pairing based on complementary confidence gaps (mean absolute difference $\ge 0.30$ across overlapping concepts).
- **F-D03: Private Match Chat**: Secure, isolated in-app text messaging exclusively accessible to the two matched peers.
- **F-D04: Mutual Availability Scheduling**: Stored future UTC availability intervals $[startsAt, endsAt)$; automated identification of the earliest 30-minute mutual overlap.
- **F-D05: Dual-Consent Acceptance**: Mandatory bilateral acceptance of a proposed study slot before meeting confirmation.
- **F-D06: Genuine Zoom Scheduling**: Authentic Zoom meeting generation using the owning teacher's authorized Zoom credentials, returning genuine join URLs and meeting IDs.

### Feature Family E: Spark Learning Experience & Habit Loops
- **F-E01: Star Experience & Dynamic Vessel Visualizer**: Represents concept nodes as interactive stars positioned by D3-force with vertical clip-rectangle fill proportional to confidence ($c \in [0.0, 1.0]$). Visual fill states map one-to-one to canonical bands: `gray` (Unassessed), `red` (Dim / Needs practice), `yellow` (Lit / Developing), `green` (Shining / Mastered).
- **F-E02: Reactive Mascot (Spark)**: Embedded SVG companion mascot with expressive mood states (`calm`, `think`, `cheer`, `oops`, `sleepy`) and evolutionary forms (`ember`, `spark`, `glow`, `nova`) derived strictly from whole-course sky brightness (average confidence). Spark offers warm, adult, non-shaming coaching without leaking solutions.
- **F-E03: Daily Quest & Streak Loop**: Automatically generates a persistent daily queue of up to three ready concepts (unreviewed, overdue >3 days, or confidence $< 0.70$) per student per UTC date. Clearing a nonempty quest advances the streak and awards 25 XP.
- **F-E04: Practice Encounters & Tiered Hints**: Surfaces five-question practice quizzes in an engaging inline panel with Spark reactions and exactly three progressive server-released hint tiers (Level 1: Nudge, Level 2: Bigger hint, Level 3: Walkthrough). Hints discount earned XP without altering quiz scoring or mastery evidence formulas.
- **F-E05: Eclipse Review-Pressure Diagnostic**: Computes course-wide review pressure targeting up to three lowest-confidence ready concepts. Strength is computed as $\text{round}(100 \times \sum \max(0, 0.70 - c_i) / (n \times 0.70))$ alongside an optional teacher-managed upcoming exam countdown. Purely diagnostic; never decays confidence.
- **F-E06: Append-Only XP Effort Ledger**: Tracks student study effort in an append-only server-authoritative ledger (`xp_events`). Practice encounters award $\max(8, 30 - 6 \times \text{hintsUsed})$ for correct answers and 8 XP for incorrect answers (max once per student/concept/date); Daily Quest clear awards 25 XP; Party quest clear awards 60 XP. XP never mutates `student_mastery`.
- **F-E07: Collaborative Party Goals**: Enables matched study-group peers to embark on a shared Party quest targeting 1–3 shared concepts. Each peer independently completes the five-question quiz; bilateral completion awards 60 XP to each peer without bypassing individual mastery grading.
- **F-E08: Instructor Class Sky & Effort Quadrant**: Provides instructors an aggregate knowledge graph showing class mean confidence per concept, transcript-evidenced taught status, and an effort-vs-mastery roster quadrant (identifying high-effort/low-mastery students who need pedagogical intervention) without student-facing leaderboards.

---

## 3. End-to-End User Journeys (J01 – J11)

The system behavior is formally validated against eleven end-to-end user journeys (J01–J11). Every journey defines a strict acceptance contract:

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
  2. System calls OpenRouter with recent transcript chunks and concept context to generate an open-ended question: `"Why must we save the intermediate activations during the forward pass of backpropagation?"`
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
  3. AI pipeline identifies root misconception via OpenRouter: *"Students are confusing computational graph storage requirements with inference optimization."*
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
  8. Rahul requests supplementary resources; OpenRouter returns three verified external academic guides with valid URLs via Perplexity search model.
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


### Journey J09: Daily Review Quest, Progressive Hints & Effort Streak
- **Persona**: Student (Rahul).
- **Flow**:
  1. Rahul opens the student dashboard on a new UTC calendar date.
  2. System queries `GET /api/students/:studentId/daily-quest` and retrieves a persisted 3-item Daily Quest: "Backpropagation", "Derivatives", "Computational Graphs".
  3. Rahul launches a practice Encounter for "Backpropagation".
  4. On Question 1, Rahul requests Hint Level 1 (Nudge) via `POST /api/encounters/:encounterId/hints`; server returns contextual hint text.
  5. Rahul requests Hint Level 2 (Bigger hint); server returns deeper conceptual guidance without leaking the answer.
  6. Rahul completes and submits all 5 answers via `POST /api/encounters/:encounterId/submit`.
  7. Server grades attempt ($4/5 = 80\%$), applies canonical quiz evidence ($+0.15$ confidence boost, moving $c$ from $0.20 \to 0.35$), computes earned XP accounting for used hints, records an append-only `xp_events` entry, and marks "Backpropagation" completed in Rahul's Daily Quest.
  8. Rahul finishes the remaining two quest concepts; the Daily Quest clears (`clearedAt` is set), awarding 25 bonus XP and incrementing Rahul's daily streak from 2 to 3.
- **Acceptance Criteria**:
  - Hints are released strictly in sequential order ($1 \to 2 \to 3$); skipping returns `409 HINT_OUT_OF_SEQUENCE`.
  - Hints reduce XP awarded but have zero effect on quiz scoring delta ($+0.15$) or mastery evidence.
  - Daily quest queue order and completion status remain identical across page reloads.
  - Repeating practice on the same concept on the same UTC date earns zero duplicate practice XP.
  - Streak increments exactly once per UTC calendar day upon nonempty quest clear.

### Journey J10: Eclipse Review Diagnostic & Mascot Evolution
- **Persona**: Student (Hari) and Companion (Spark).
- **Flow**:
  1. Teacher sets upcoming midterm exam date: `PUT /api/courses/:courseId/exam` with `examAt = 2026-11-01T14:00:00Z`.
  2. Hari navigates to dashboard; system requests `GET /api/students/:studentId/eclipse`.
  3. Hari has 2 ready concepts below 0.70 ("Attention Mechanisms" at 0.35, "Transformers" at 0.50). Eclipse strength computes to $\text{round}(100 \times ((0.70 - 0.35) + (0.70 - 0.50)) / (2 \times 0.70)) = \text{round}(100 \times 0.55 / 1.40) = 39\%$.
  4. UI displays Eclipse banner showing 39% review pressure and a 10-day exam countdown.
  5. Mascot Spark currently renders in `glow` form (course average confidence = 0.58).
  6. Hari completes practice encounters and live polls, raising whole-course mean confidence past 0.75.
  7. Mascot Spark transitions with celebratory animation into `nova` form (`form = nova`, `formProgress = 1.0`).
- **Acceptance Criteria**:
  - Eclipse strength accurately computes based only on target concepts ($n \le 3$ lowest-confidence ready concepts).
  - Zero weak concepts yields Eclipse strength 0% and an explicit "Clear skies" state.
  - Mascot form derives strictly from whole-course average confidence ($<25\% \to$ Ember, $25-54\% \to$ Spark, $55-74\% \to$ Glow, $\ge 75\% \to$ Nova).
  - Mascot mood animations do not obstruct user controls or falsify server state.

### Journey J11: Collaborative Party Quest & Teacher Effort Visibility
- **Persona**: Students (Hari, Rahul) and Teacher (Prof. Sarah Chen).
- **Flow**:
  1. Hari and Rahul are matched via complementary study pool matching for "Backpropagation".
  2. Hari selects 2 shared concepts ("Backpropagation", "Computational Graphs") and activates a shared Party quest via `POST /api/study-groups/:matchId/quests`.
  3. Both peers see the shared quest in their study-group view.
  4. Rahul launches practice encounters and submits quizzes for both concepts; Hari independently launches practice encounters and submits quizzes for both concepts.
  5. Upon both peers completing both concepts, the server marks the Party quest `completed`, emits `party:quest-updated` to the match socket room, and transactionally awards 60 XP to each student's `xp_events` ledger.
  6. Prof. Chen opens `/professor/dashboard` and views the **Class Sky** tab.
  7. Class Sky displays the knowledge graph with nodes colored by class mean confidence, with attention rings highlighting taught concepts with mean confidence $< 0.40$.
  8. Prof. Chen sorts the student roster by effort (XP percentile) versus mastery (confidence percentile); Rahul is flagged with `high_effort_low_mastery` (XP percentile $\ge 75\%$, confidence percentile $\le 40\%$).
  9. Prof. Chen uses this insight to send an encouraging check-in and targeted practice recommendation.
- **Acceptance Criteria**:
  - Party quests require bilateral participation; neither peer can complete the quest on behalf of the other.
  - Party quest completion awards 60 XP to each participant exactly once without altering individual confidence directly.
  - Class Sky graph displays class mean confidence using the four canonical mastery bands.
  - High-effort/low-mastery flag triggers deterministically at XP percentile $\ge 75$ and confidence percentile $\le 40$.
  - No student-facing leaderboards or public student XP comparisons are exposed.
---

## 4. Scope Exclusions & Simulation Disclosure

### Explicit Scope Exclusions
- **Exam / Problem Set Ingestion**: The system explicitly does not support ingesting historical exams, homework assignments, or automated solution key generation. Syllabus and lecture transcript ingestion constitute the complete content ingestion boundary. Teachers may optionally record an upcoming exam date timestamp for countdown and review purposes.
- **Calendar Provider Synchronization**: The system manages peer study scheduling using internal, stored UTC availability intervals. Google Calendar and Microsoft Outlook two-way sync are explicitly excluded.
- **Student Leaderboards & Competitive Social Mechanics**: XP and streaks are strictly private student effort metrics and instructor diagnostic tools. Public leaderboards, rank badges, and peer XP comparisons are prohibited.
- **Mastery Decay & Ease Scoring**: The mastery engine does not support automated confidence decay, spaced-repetition ease factor algorithms, or penalty-free poll retries.

### Explicit Simulation Disclosure
- **Lecture Simulator**: In development, testing, and fixture demonstration modes, lecture transcripts may be generated via the internal lecture simulator (`LECTURE_SOURCE=simulator`). The user interface MUST display a prominent `[SIMULATED TRANSCRIPT]` indicator whenever simulated speech is active.
- **Provider Fallback Policy**: When `INTEGRATION_MODE=live` is configured, the system MUST NOT silently degrade to simulated or fixture responses if third-party credentials (OpenRouter, Zoom) are missing or invalid. Missing credentials MUST raise an explicit `503 SERVICE_UNAVAILABLE` or error badge in the UI.
