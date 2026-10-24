# Domain Glossary

This glossary establishes the canonical vocabulary for Spark. All code identifiers, database columns, API fields, documentation, and agent discussions MUST adhere strictly to these terms. Synonyms listed under **Avoid** MUST NOT be used in new designs or codebase extensions.

---

### Course & Membership

#### course
A bounded academic subject created by an instructor (e.g., "CS229 Machine Learning"). Serves as the root boundary for knowledge graphs, lectures, enrollments, polls, and study groups.
- _Avoid_: class, subject, module, workspace.

#### teacher
The authorized instructor persona who creates courses, imports syllabi, starts lectures, launches polls, reviews student mastery, and configures Zoom integration credentials. `teacher` is the canonical machine role used in code, databases, tokens, and authorization checks.
- _Note_: `professor` is retained solely as a visual UI label and URL segment (`/professor/dashboard`).
- _Avoid_: instructor, lecturer, admin, presenter (in code/data models).

#### student
An individual learner participating in a course. In the data model, a `students` record represents a verified user's specific course enrollment. A single authenticated user may have multiple student records across different courses.
- _Avoid_: pupil, participant, attendee, user (when referring to enrollment).

#### enrollment
The association connecting an authenticated user (`auth_id`) to a specific `course`. Enrollment is established via a unique course `join_code` and is idempotent.
- _Avoid_: registration, subscription, membership.

---

### Knowledge Graph & Mastery

#### concept
A discrete, major topic or skill within a course curriculum (e.g., "Gradient Descent", "Cross-Entropy"). In the knowledge graph, each concept is a node with a label, description, category, difficulty rating, and layout coordinates.
- _Avoid_: topic, skill, competency, node (when referring to curriculum content).

#### prerequisite edge
A directed link between two concepts indicating that mastery of concept A is required before learning concept B. Directed from prerequisite to dependent: `source_id -> target_id` means `source` is prerequisite to `target`.
- _Avoid_: dependency, prerequisite_link, graph_edge.

#### knowledge graph
A Directed Acyclic Graph (DAG) composed of 30 to 40 broad course concepts and their prerequisite edges, extracted from a syllabus and reviewed by the teacher.
- _Avoid_: concept_map, skill_tree, curriculum_graph.

#### confidence
A continuous scalar value in the closed real interval $[0.0, 1.0]$ representing a student's estimated mastery of a specific concept. Defaults to `0.0` upon enrollment.
- _Avoid_: score, grade, mastery_level, rating (when referring to the continuous metric).

#### mastery band
A discrete semantic categorization of confidence into one of four mutually exclusive bands:
1. `gray`: $c = 0.0$ (unassessed / zero evidence)
2. `red`: $0.0 < c < 0.40$ (struggling / urgent intervention)
3. `yellow`: $0.40 \le c < 0.70$ (developing / partial comprehension)
4. `green`: $c \ge 0.70$ (mastered / confident)
- _Avoid_: mastery_tier, proficiency_bucket.
- _Avoid_: lime, orange (these are legacy cosmetic subdivisions, not canonical semantic bands).

#### mastery evidence
A discrete, verifiable event that triggers an update to a student's confidence for a concept. Encapsulated as a discriminated union of four types:
- `poll`: Free-form response evaluated by AI (`correct` $\to \max(old, 0.85)$, `partial` $\to \max(old, 0.50)$, `wrong` $\to 0.20$ if $old=0$ else $\min(old, 0.20)$).
- `tutor`: Productive Socratic dialogue (`clamp(old + 0.20, 0, 1)`).
- `quiz`: Server-evaluated practice quiz score ($\ge 80\% \to +0.15$, $\ge 60\% \to +0.10$, $\ge 40\% \to +0.05$, else $+0.02$).
- `attendance`: Verified presence during a lecture chunk covering the concept ($\min(old + 0.05, 0.30)$ only if $old < 0.30$).
- _Avoid_: mastery_boost, score_delta, direct confidence setting.

---

### Live Classroom & Formative Assessment

#### lecture
A synchronous class session created by a teacher within a course. Manages real-time audio/transcript streaming, live concept detection, poll broadcasting, and attendance evidence.
- _Avoid_: class_session, meeting, livestream.

#### transcript chunk
A discrete segment of transcribed speech from a live lecture, containing the spoken text, elapsed lecture timestamp in seconds (`timestampSec`), speaker identity, and detected concept associations.
- _Avoid_: audio_slice, speech_fragment, subtitle.

#### poll
An open-ended, short-answer comprehension question generated dynamically by AI from active lecture concepts or authored by a teacher, broadcast to all enrolled students currently attending the lecture.
- _Avoid_: quiz (during live lecture), formative_check, survey.

#### evaluation
A server-side grading process that assesses a student's poll response against an expected answer or rubric, returning a discrete outcome (`correct`, `partial`, `wrong`) and constructive feedback.
- _Avoid_: assessment, mark, score (for poll answers).

---

### Autonomous Learning

#### tutoring session
A multi-turn interactive conversation between an enrolled student and an AI Socratic tutor, targeting specific low-confidence concepts without revealing direct quiz answers.
- _Avoid_: chatbot_session, ai_helper, study_chat.

#### understanding evidence
Verifiable proof generated during tutoring indicating that a student has grasped a concept, qualifying them for a mastery update.
- _Avoid_: tutor_boost_flag, chat_score.

#### practice quiz
A set of multiple-choice questions dynamically generated for a concept to evaluate student comprehension outside of live lecture. Graded strictly on the server against pre-stored answer keys.
- _Avoid_: test, exam, concept_assessment.

---

### Peer Collaboration & Scheduling

#### study-group pool
A transient, course-scoped queue of enrolled students who have explicitly opted in to find study partners for specific concepts. Pool entries automatically expire after 5 minutes.
- _Avoid_: waiting_room, matchmaking_queue, peer_lobby.

#### match
A mutual, consensual pairing of exactly two students from the study-group pool who exhibit complementary knowledge gaps (mean absolute confidence difference $\ge 0.30$ on overlapping concepts).
- _Avoid_: group, pair, study_team.

#### availability interval
A discrete, future half-open time interval $[startsAt, endsAt)$ of at least 30 minutes expressed in UTC ISO-8601, during which a student is available for peer study.
- _Avoid_: free_slot, calendar_block.

---

### Operational Modes & Testing

#### fixture
A deterministic, offline mock implementation of an external provider (OpenRouter or Zoom) used for unit tests, contract checks, and offline development. Enabled via `INTEGRATION_MODE=fixture`.
- _Avoid_: mock_service, fake_backend, stub.

#### live integration
An execution mode connecting to authentic external APIs (OpenRouter for Anthropic Claude and Perplexity models, Zoom RTMS and REST APIs). Enabled via `INTEGRATION_MODE=live`. Missing credentials cause immediate, explicit capability errors.
- _Avoid_: production_mode (in development contexts).

#### simulation
An automated in-process generator that emits realistic lecture transcript chunks, simulated speech, or student actions for testing and demonstration purposes without human intervention.
- _Avoid_: fake_lecture, bot_stream.

---

### Spark Experience & Product Presentation Layer

#### Spark
The product brand name and reactive SVG companion mascot. Guides learners through their academic quest line with expressive mood animations (`calm`, `think`, `cheer`, `oops`, `sleepy`) and evolutionary forms (`ember`, `spark`, `glow`, `nova`) derived strictly from whole-course sky brightness (average confidence). Spark never provides direct answers or overrides server evaluations.

#### quest line
The student-facing product presentation label for an academic `course`. Machine identifiers, database columns, route segments, and API contracts strictly remain `course` and `course_id`.
- _Allowed product label_: quest line.
- _Avoid_: skill tree, game world, campaign.

#### star
The student-facing visual representation of a curriculum `concept` node in the knowledge graph. Positioned dynamically via D3-force simulation; vertical SVG clip rectangle reflects `confidence` ($c \in [0.0, 1.0]$). Visual fill states map one-to-one to canonical bands: `gray` (Unassessed), `red` (Dim / Needs practice), `yellow` (Lit / Developing), `green` (Shining / Mastered). Machine identifiers strictly remain `concept` and `concept_id`.
- _Allowed product label_: star.
- _Avoid_: planet, node, skill badge.

#### track
The student-facing visual grouping for concepts sharing a curriculum `category`. Machine identifiers strictly remain `category`.
- _Allowed product label_: track.
- _Avoid_: transit lane, train line.

#### Encounter
The student-facing presentation and orchestration wrapper for a five-question, four-option practice quiz or live formative poll. Features mascot reactions, progressive tiered hints, and reward cards. Backed by `encounters` storage and evaluated through canonical `quiz_attempts` and `MasteryService.applyEvidence()`.
- _Allowed product label_: Encounter.
- _Avoid_: battle, mini-game, challenge.

#### hint
Progressive pedagogical assistance available during practice Encounters across three explicit server-controlled levels: Level 1 (Nudge), Level 2 (Bigger hint), Level 3 (Walkthrough). Hints teach reasoning without revealing correct answers, are released sequentially, and discount earned XP without altering quiz scoring or mastery evidence formulas.
- _Avoid_: answer_reveal, cheat, clue.

#### Daily Quest
A daily review queue of up to three ready concepts (unreviewed, overdue >3 days, or $c < 0.70$) generated per student per UTC date. Clearing a nonempty quest increments the daily streak and awards 25 XP.
- _Allowed product label_: Daily Quest.
- _Avoid_: daily mission, chore, backlog.

#### streak
The count of consecutive UTC calendar days on which an enrolled student clears a nonempty Daily Quest. A missed calendar date resets the streak on the next clear. Streak tracking reflects habit and effort, never academic confidence.

#### Eclipse
A student-facing diagnostic indicator quantifying review pressure toward upcoming exams, targeting up to three lowest-confidence ready concepts. Strength ranges from 0 to 100 based on distance from mastery ($c = 0.70$). Eclipse is purely diagnostic and never decays confidence or locks content.

#### XP (Experience Points)
An append-only, server-authoritative ledger of student learning effort recorded in `xp_events`. XP is awarded for completed practice quizzes, Daily Quest clears, and completed Party quests. XP is strictly orthogonal to academic mastery and never mutates `student_mastery`.
- _Avoid_: score, mastery points, level points.

#### party
The student-facing collaborative label for an authenticated two-student `match` from the study-group pool. Matched peers may activate a shared Party quest (1–3 concepts) to earn shared XP upon bilateral independent quiz completion. Machine identifiers strictly remain `study_group_matches` and `match_id`.
- _Allowed product label_: party.
- _Avoid_: clan, guild, squad, trios.

#### Class Sky
The instructor-facing aggregate knowledge graph visualization displaying mean class confidence across concepts, transcript-evidenced taught/untaught status, and an effort-vs-mastery roster quadrant without student-facing leaderboards. Machine data routes through `GameService.getCourseEffort()` and existing lecture/mastery repositories.
