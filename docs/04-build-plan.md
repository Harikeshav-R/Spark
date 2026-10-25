# Detailed Build Plan & Execution Instructions

This build plan provides step-by-step engineering instructions, target paths, dependencies, contracts, and verifiable checkpoint commands for all 72 checklist tasks.

---

## Phase 0: Foundations & Shared Contracts

### P0-A-01 — Repository Preflight, Toolchain Setup & Project Skeleton
- **Lane**: Lane A
- **Goal**: Initialize root `package.json`, TypeScript configuration, ESLint, and folder layout.
- **Target Paths**: `package.json`, `package-lock.json`, `tsconfig.json`, `server/index.ts`, `src/contracts/index.ts`
- **Dependencies**: None (Project entry point)
- **Consumed / Produced Contracts**: Produces initial root build scripts and directory layout.
- **Implementation Instructions**: Initialize npm project with Node.js 24 LTS, TypeScript 5.8 strict mode, Vitest, and ESLint. Create placeholder directories according to `docs/02-architecture.md`.
- **Invariant / Error Cases**: Enforce strict compilation with zero warnings.
- **Fixture Path**: Offline local compilation.
- **Prerequisites & State**: Blank root repository.

#### CP-P0-A-01 — Toolchain Preflight Verification
- **Command**: `npm run typecheck && npm run lint`
- **Expected State**: Zero TypeScript errors; linting succeeds.

---

### P0-A-02 — Supabase Local Instance & Migration 0001 Foundation
- **Lane**: Lane A
- **Goal**: Initialize local Supabase instance and author base schema migration.
- **Target Paths**: `supabase/config.toml`, `supabase/migrations/20261020000001_initial_schema.sql`
- **Dependencies**: `P0-A-01`
- **Consumed / Produced Contracts**: Produces base 18 tables defined in `docs/05-data-model.md`.
- **Implementation Instructions**: Create Docker-backed Supabase configuration. Author SQL migration script creating base tables, foreign keys, unique constraints, and indexes.
- **Invariant / Error Cases**: Reject tables without primary keys or missing cascading deletes.
- **Fixture Path**: Local Docker PostgreSQL.
- **Prerequisites & State**: Docker engine running.

#### CP-P0-A-02 — Database Migration Verification
- **Command**: `npx supabase db reset`
- **Expected State**: 18 base tables created successfully in local PostgreSQL.

---

### P0-A-03 — Shared Contracts & Zod Domain Schemas
- **Lane**: Lane A
- **Goal**: Codify canonical TypeScript types, Zod schemas, and error envelopes in `src/contracts/`.
- **Target Paths**: `src/contracts/common.ts`, `src/contracts/course.ts`, `src/contracts/mastery.ts`, `src/contracts/errors.ts`
- **Dependencies**: `P0-A-01`
- **Consumed / Produced Contracts**: Produces frozen boundary contracts for all lanes.
- **Implementation Instructions**: Project TypeScript interfaces from `docs/contracts/service-ports.md` into Zod 4 schemas with runtime validators.
- **Invariant / Error Cases**: Confidence must be validated within $[0.0, 1.0]$.
- **Fixture Path**: In-memory unit test.
- **Prerequisites & State**: Node toolchain initialized.

#### CP-P0-A-03 — Schema Contract Verification
- **Command**: `npm run test:contracts`
- **Expected State**: All Zod schemas successfully parse valid JSON fixtures in `docs/contracts/examples.md`.

---

### P0-B-01 — Classroom & Collaboration Contract Stubs & Realtime Fixtures
- **Lane**: Lane B
- **Goal**: Define Socket.IO event payload types and deterministic fake classroom services.
- **Target Paths**: `src/contracts/realtime.ts`, `src/contracts/classroom.ts`, `tests/fixtures/classroom.fixture.ts`
- **Dependencies**: `P0-A-03`
- **Consumed / Produced Contracts**: Consumes `src/contracts/common.ts`; produces realtime event types.
- **Implementation Instructions**: Implement `FakeClassroomService` returning precomputed lecture and poll data.
- **Invariant / Error Cases**: Assert that poll questions omit expected answers.
- **Fixture Path**: Local in-memory fixture.
- **Prerequisites & State**: Contracts package available.

#### CP-P0-B-01 — Realtime Contract Verification
- **Command**: `npm test tests/contracts/lane-b/realtime-contracts.test.ts`
- **Expected State**: Realtime event schemas validate all socket payloads in `docs/contracts/examples.md`.

---

### P0-C-01 — AI & Learning Service Ports & Deterministic Fixtures
- **Lane**: Lane C
- **Goal**: Define AI pipeline input/output types and create offline deterministic AI fake.
- **Target Paths**: `src/contracts/ai.ts`, `src/contracts/learning.ts`, `tests/fixtures/ai.fixture.ts`
- **Dependencies**: `P0-A-03`
- **Consumed / Produced Contracts**: Consumes common types; produces `FakeAiService`.
- **Implementation Instructions**: Implement `FakeAiService` returning deterministic 33-node DAG, poll evaluations, and tutoring replies.
- **Invariant / Error Cases**: Validate that simulated evaluations return only `correct`, `partial`, or `wrong`.
- **Fixture Path**: In-memory fake.
- **Prerequisites & State**: Contracts package available.

#### CP-P0-C-01 — AI Fixture Verification
- **Command**: `npm test tests/contracts/lane-c/ai-contracts.test.ts`
- **Expected State**: Fake AI responses match output Zod schemas in `docs/08-ai-pipelines.md`.

---

### P0-D-01 — UI Component Tokens, Route Shells & Test Harness Setup
- **Lane**: Lane D
- **Goal**: Configure Next.js 16, Tailwind CSS 4, shared UI component primitives, and Playwright test harness.
- **Target Paths**: `src/components/ui/`, `src/app/globals.css`, `playwright.config.ts`
- **Dependencies**: `P0-A-01`, `P0-A-03`
- **Consumed / Produced Contracts**: Produces reusable Button, Card, Badge, and Modal components.
- **Implementation Instructions**: Setup Tailwind 4 design tokens for mastery bands (`gray`, `red`, `yellow`, `green`). Configure Playwright multi-context browser harness.
- **Invariant / Error Cases**: Color tokens must meet WCAG 2.1 AA contrast requirements.
- **Fixture Path**: Headless component rendering.
- **Prerequisites & State**: Node toolchain initialized.

#### CP-P0-D-01 — Design System & Harness Verification
- **Command**: `npx playwright --version && npm run lint`
- **Expected State**: Playwright ready; shared UI primitives compile cleanly.

---

## Phase 1: Independent Vertical Foundations

### P1-A-01 — Supabase JWT Token Verification & ActorContext Middleware
- **Lane**: Lane A
- **Goal**: Implement server-side Supabase JWT verification and request context derivation.
- **Target Paths**: `src/server/platform/auth.ts`, `src/server/platform/middleware/require-auth.ts`
- **Dependencies**: `P0-A-02`, `P0-A-03`
- **Consumed / Produced Contracts**: Consumes Supabase token; produces verified `ActorContext`.
- **Implementation Instructions**: Verify bearer tokens using Supabase `auth.getUser(token)`. Query user roles and enrollments. Reject invalid tokens with `401 Unauthorized`.
- **Invariant / Error Cases**: Reject unverified tokens; never trust client-supplied role query parameters.
- **Fixture Path**: Mock Supabase Auth client.
- **Prerequisites & State**: Supabase migration 0001 applied.

#### CP-P1-A-01 — Auth Gateway Verification
- **Command**: `npm test tests/unit/lane-a/auth-gateway.test.ts`
- **Expected State**: Valid JWT yields complete `ActorContext`; forged token returns `401`.

---

### P1-A-02 — Course Service & Join Code Generator
- **Lane**: Lane A
- **Goal**: Implement course creation, retrieval, and cryptographic 8-character join code generation.
- **Target Paths**: `src/server/core/courses/course-service.ts`, `src/server/core/courses/course-repository.ts`
- **Dependencies**: `P1-A-01`
- **Consumed / Produced Contracts**: Implements `CourseService` from `docs/contracts/service-ports.md`.
- **Implementation Instructions**: Implement `createCourse` and `getCourse`. Generate uppercase alphanumeric join codes (e.g., `"CS229-8F"`) with uniqueness verification.
- **Invariant / Error Cases**: Non-teachers cannot create courses (`403 Forbidden`).
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Auth middleware available.

#### CP-P1-A-02 — Course Service Verification
- **Command**: `npm test tests/unit/lane-a/course-service.test.ts`
- **Expected State**: Teacher creates course; unique join code persisted and queryable.

---

### P1-A-03 — Enrollment & Mastery Initialization Service
- **Lane**: Lane A
- **Goal**: Implement idempotent student enrollment via join code and automatic zero-confidence mastery initialization.
- **Target Paths**: `src/server/core/enrollment/enrollment-service.ts`
- **Dependencies**: `P1-A-02`
- **Consumed / Produced Contracts**: Produces `Student` record and eager `student_mastery` rows.
- **Implementation Instructions**: Lookup course by join code; create `students` row; insert `student_mastery` records with `confidence = 0.0` for all existing course concepts.
- **Invariant / Error Cases**: Re-enrollment with same join code is idempotent.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Course service available.

#### CP-P1-A-03 — Enrollment Verification
- **Command**: `npm test tests/unit/lane-a/enrollment-service.test.ts`
- **Expected State**: Student enrolls; 33 zero-confidence mastery rows initialized; repeat enrollment succeeds without duplicate rows.

---

### P1-A-04 — Atomic Mastery Engine & PostgreSQL RPC
- **Lane**: Lane A
- **Goal**: Implement `apply_mastery_evidence` RPC and `MasteryService` with 4-band domain logic.
- **Target Paths**: `supabase/migrations/20261020000002_mastery_rpc.sql`, `src/server/core/mastery/mastery-service.ts`
- **Dependencies**: `P1-A-03`
- **Consumed / Produced Contracts**: Implements `MasteryService` and `applyMasteryEvidence`.
- **Implementation Instructions**: Create `apply_mastery_evidence` stored function in SQL. Implement pure functions `confidenceToBand` and `applyMasteryEvidence`.
- **Invariant / Error Cases**: Enforce attempts incremented only for poll evidence. Reject confidence outside $[0.0, 1.0]$.
- **Fixture Path**: Local PostgreSQL RPC execution.
- **Prerequisites & State**: Student mastery table created.

#### CP-P1-A-04 — Mastery Engine Verification
- **Command**: `npm test tests/integration/lane-a/mastery-engine.test.ts`
- **Expected State**: Formulas for poll, tutor, quiz, and attendance execute deterministically and atomically in PostgreSQL.

---

### P1-B-01 — Lecture Session Lifecycle & State Machine
- **Lane**: Lane B
- **Goal**: Implement lecture session persistence and state machine (`draft` -> `live` -> `completed`).
- **Target Paths**: `src/server/classroom/lecture-service.ts`, `src/server/classroom/lecture-repository.ts`
- **Dependencies**: `P0-B-01`, `P1-A-01`
- **Consumed / Produced Contracts**: Implements `startLecture` and `endLecture`.
- **Implementation Instructions**: Persist lecture session in `lecture_sessions`. Enforce transitions: a lecture starts `live` and ends `completed`.
- **Invariant / Error Cases**: Ending an already completed lecture returns `409 Conflict`.
- **Fixture Path**: In-memory repository or local DB.
- **Prerequisites & State**: Course service available.

#### CP-P1-B-01 — Lecture State Machine Verification
- **Command**: `npm test tests/unit/lane-b/lecture-lifecycle.test.ts`
- **Expected State**: Lecture starts in `live` state, records timestamps, and transitions cleanly to `completed`.

---

### P1-B-02 — Ephemeral Study Group Pool Repository
- **Lane**: Lane B
- **Goal**: Implement pool opt-in, expiration check, and opt-out repository.
- **Target Paths**: `src/server/study-groups/pool-repository.ts`
- **Dependencies**: `P0-B-01`, `P1-A-01`
- **Consumed / Produced Contracts**: Implements pool queries with 5-minute expiration filter.
- **Implementation Instructions**: Insert pool entries with `expires_at = NOW() + INTERVAL '5 minutes'`. Implement cleanup of expired waiting entries.
- **Invariant / Error Cases**: Expired entries must not be returned in matchmaking queries.
- **Fixture Path**: Local PostgreSQL or in-memory DB.
- **Prerequisites & State**: Base schema migration applied.

#### CP-P1-B-02 — Study Pool Repository Verification
- **Command**: `npm test tests/unit/lane-b/pool-repository.test.ts`
- **Expected State**: Active entries returned; entries older than 5 minutes filtered out.

---

### P1-C-01 — OpenRouter Typed Client Adapter (Anthropic & Perplexity Models)
- **Lane**: Lane C
- **Goal**: Implement typed API client wrapper for OpenRouter (routing to fast, deep, and search models).
- **Target Paths**: `src/server/ai/providers/openrouter-client.ts`
- **Dependencies**: `P0-C-01`
- **Consumed / Produced Contracts**: Implements network adapters with per-capability timeouts.
- **Implementation Instructions**: Wrap OpenRouter API via OpenAI-compatible SDK; attach Zod schema validation to raw responses; configure model IDs via environment variables (`OPENROUTER_FAST_MODEL` defaulting to `minimax/minimax-m3.1-flash:free`, `OPENROUTER_DEEP_MODEL` defaulting to `nvidia/nemotron-3-ultra-550b-a55b:free`, and `OPENROUTER_SEARCH_MODEL` defaulting to `perplexity/sonar-pro`).
- **Invariant / Error Cases**: Missing credentials in `INTEGRATION_MODE=live` raise typed configuration errors; timeouts abort requests cleanly.
- **Fixture Path**: Fixture mode returns deterministic responses without network calls.
- **Prerequisites & State**: Node toolchain initialized.

#### CP-P1-C-01 — AI Client Adapter Verification
- **Command**: `npm test tests/unit/lane-c/ai-clients.test.ts`
- **Expected State**: Fixture mode yields valid parsed objects; timeout triggers `504 Gateway Timeout`.

---

### P1-C-02 — Socratic Tutoring Session Engine
- **Lane**: Lane C
- **Goal**: Implement multi-turn tutoring message persistence and Socratic prompt loop.
- **Target Paths**: `src/server/learning/tutoring-service.ts`, `src/server/learning/tutoring-repository.ts`
- **Dependencies**: `P1-C-01`, `P1-A-04`
- **Consumed / Produced Contracts**: Implements `LearningService.createTutoringSession` and `submitTutoringMessage`.
- **Implementation Instructions**: Store messages in `tutoring_messages`. Send conversation history to Socratic prompt via OpenRouter Deep Model. If understanding is detected, call `MasteryService.applyEvidence(..., { type: 'tutor' })`.
- **Invariant / Error Cases**: Replaying same message ID does not apply duplicate mastery evidence.
- **Fixture Path**: Fake AI service.
- **Prerequisites & State**: Mastery service available.

#### CP-P1-C-02 — Tutoring Engine Verification
- **Command**: `npm test tests/unit/lane-c/tutoring-engine.test.ts`
- **Expected State**: Student message triggers Socratic response; understanding flag advances mastery by $+0.20$.

---

### P1-D-01 — App Router Shells & Navigation Layout
- **Lane**: Lane D
- **Goal**: Author page route shells in `src/app/` with responsive navigation headers.
- **Target Paths**: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/professor/dashboard/page.tsx`, `src/app/student/[studentId]/page.tsx`
- **Dependencies**: `P0-D-01`
- **Consumed / Produced Contracts**: Produces route structure adhering to `docs/09-frontend.md`.
- **Implementation Instructions**: Build App Router shells with breadcrumbs, role badges, and responsive containers. Connect shells to warm theme tokens configured in `P1-D-02`.
- **Invariant / Error Cases**: Unauthenticated requests to protected paths show sign-in prompt.
- **Fixture Path**: Next.js development server.
- **Prerequisites & State**: Design system tokens available.

#### CP-P1-D-01 — Route Shell Verification
- **Command**: `npm run build`
- **Expected State**: Next.js builds all static and dynamic route shells without layout errors.

---
### P1-A-05 — Shared Game, Encounter & Party Extension Contracts and Fixtures
- **Lane**: Lane A
- **Goal**: Codify canonical TypeScript interfaces, Zod schemas, and synthetic fixtures for Spark progression in `src/contracts/game.ts`.
- **Target Paths**: `src/contracts/game.ts`, `src/contracts/index.ts`, `tests/fixtures/game.fixture.ts`
- **Dependencies**: `P0-A-03`, `P0-B-01`, `P0-C-01`
- **Consumed / Produced Contracts**: Produces `DailyQuestDTO`, `GameSummaryDTO`, `EclipseDTO`, `EncounterDTO`, `EncounterResultDTO`, `CourseEffortDTO`, `GameService`, `EncounterService` interfaces.
- **Implementation Instructions**: Define Zod schemas and TypeScript types specified in `docs/contracts/service-ports.md` Section 7. Implement deterministic synthetic fixtures in `tests/fixtures/game.fixture.ts` matching `docs/contracts/examples.md` Section 5. Coordinate cross-lane approval gate.
- **Invariant / Error Cases**: Assert that `hintsUsed` is bounded within $[0, 3]$, `skyBrightness` in $[0.0, 1.0]$, `strength` in $[0, 100]$.
- **Fixture Path**: In-memory contract tests.
- **Prerequisites & State**: Phase 0 shared contracts available.

#### CP-P1-A-05 — Game Extension Contract Verification
- **Command**: `npm test tests/contracts/lane-a/game-contracts.test.ts`
- **Expected State**: Game and encounter schemas validate all fixtures in `docs/contracts/examples.md`.

---

### P1-A-06 — Additive Spark Learning Relational Migration 0003
- **Lane**: Lane A
- **Goal**: Author additive SQL migration creating `encounters`, `daily_quests`, and `xp_events` tables, and adding `courses.exam_at`, `concept_quiz_questions.hints`, and `quiz_attempts.encounter_id`.
- **Target Paths**: `supabase/migrations/20261021000003_spark_learning.sql`
- **Dependencies**: `P1-A-04`, `P1-A-05`
- **Consumed / Produced Contracts**: Produces 3 new application tables (bringing schema to 21 tables) without rewriting Phase 0 migration history.
- **Implementation Instructions**: Author SQL migration with unique constraint on `daily_quests(student_id, quest_date)`, append-only unique keys on `xp_events`, and 3-string check constraint on `concept_quiz_questions.hints`. Add `party_quest_id` as nullable UUID without foreign key (foreign key added in Phase 6 migration 0005).
- **Invariant / Error Cases**: Ensure idempotency; reject tables without primary keys or missing foreign keys.
- **Fixture Path**: Local Docker PostgreSQL.
- **Prerequisites & State**: Migration 0002 applied.

#### CP-P1-A-06 — Spark Schema Migration Verification
- **Command**: `npm test tests/integration/lane-a/game-schema.test.ts`
- **Expected State**: Tables `encounters`, `daily_quests`, and `xp_events` created cleanly in PostgreSQL.

---

### P1-D-02 — Warm Palette Design Tokens & Theme Follow-on
- **Lane**: Lane D
- **Goal**: Configure warm editorial palette tokens and surface themes adhering to `docs/09-frontend.md`.
- **Target Paths**: `src/app/globals.css`, `src/components/ui/theme-provider.tsx`
- **Dependencies**: `P0-D-01`, `P1-D-01`
- **Consumed / Produced Contracts**: Produces warm light paper surfaces (`#faf6ee`), panel backgrounds (`#fffdf8`), and high-contrast text tokens (`#2b2a2e`, `#a9481a`).
- **Implementation Instructions**: Update CSS root variables with canonical palette from `docs/09-frontend.md`. Replace default dark canvas styles with warm paper palette. Verify WCAG AA contrast for text ($\ge 4.5:1$) and non-text focus borders ($\ge 3:1$).
- **Invariant / Error Cases**: Body text must meet $\ge 4.5:1$ contrast; focus outlines meet $\ge 3:1$.
- **Fixture Path**: Headless CSS token test.
- **Prerequisites & State**: Route shells available.

#### CP-P1-D-02 — Warm Palette Verification
- **Command**: `npm test tests/contracts/lane-d/spark-theme.test.ts`
- **Expected State**: All design token classes compile cleanly; automated contrast audit confirms WCAG 2.1 AA compliance.

---

## Phase 2: Course Setup & Prerequisite Graph

### P2-A-01 — Prerequisite DAG Validation Engine & Cycle Detector
- **Lane**: Lane A
- **Goal**: Implement graph validation: topological sorting, cycle detection (DFS), and incoming-degree importance calculation.
- **Target Paths**: `src/server/core/graph/graph-validator.ts`, `src/server/core/graph/importance-calculator.ts`
- **Dependencies**: `P1-A-02`
- **Consumed / Produced Contracts**: Implements `GraphService.validateGraph` and `calculateImportance`.
- **Implementation Instructions**: Build Depth-First Search cycle detector. Implement incoming-prerequisite importance formula:
  $$\text{importance} = \text{sigmoid}(\text{round}(\text{in\_degree} / \text{max\_in}, 3) + 1)$$
- **Invariant / Error Cases**: Reject self-edges, duplicate node labels, missing endpoints, and cycles.
- **Fixture Path**: In-memory graph tests.
- **Prerequisites & State**: Course service available.

#### CP-P2-A-01 — DAG Validator Verification
- **Command**: `npm test tests/unit/lane-a/dag-validator.test.ts`
- **Expected State**: Valid 33-node CS229 graph passes; injected cyclic edge is rejected with cycle path details.

---

### P2-A-02 — Graph Persistence & Transactional Node/Edge Commit
- **Lane**: Lane A
- **Goal**: Implement transactional commit of concept nodes and prerequisite edges.
- **Target Paths**: `src/server/core/graph/graph-service.ts`, `src/server/core/graph/graph-repository.ts`
- **Dependencies**: `P2-A-01`
- **Consumed / Produced Contracts**: Implements `GraphService.commitKnowledgeGraph`.
- **Implementation Instructions**: Transactionally insert `concept_nodes` and `concept_edges`. Populate initial `student_mastery` rows for existing enrolled students.
- **Invariant / Error Cases**: If course already has committed nodes, return `409 GRAPH_ALREADY_EXISTS`.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: DAG validator available.

#### CP-P2-A-02 — Graph Persistence Verification
- **Command**: `npm test tests/integration/lane-a/graph-persistence.test.ts`
- **Expected State**: 33 nodes and 34 edges commit atomically; second commit attempt returns `409 Conflict`.

---

### P2-C-01 — Syllabus PDF Bounded Ingestion & Graph Extraction Pipeline
- **Lane**: Lane C
- **Goal**: Ingest syllabus PDF, slice first $\min(\text{pageCount}, 10)$ pages via `pdf-lib`, and call OpenRouter graph extraction.
- **Target Paths**: `src/server/ai/pipelines/extract-graph.ts`, `src/server/core/ingestion/pdf-processor.ts`
- **Dependencies**: `P1-C-01`, `P0-A-03`
- **Consumed / Produced Contracts**: Implements `AiService.extractPrerequisiteGraph`.
- **Implementation Instructions**: Count pages; slice first 10 pages; compute SHA-256 hash for `pdf_cache`; call OpenRouter Deep Model; parse output with Zod schema.
- **Invariant / Error Cases**: Return `truncated: true` when page count $> 10$. Enforce 50 MiB upload cap.
- **Fixture Path**: Deterministic fixture returns pre-parsed CS229 graph.
- **Prerequisites & State**: OpenRouter client adapter available.

#### CP-P2-C-01 — Syllabus Extraction Verification
- **Command**: `npm test tests/unit/lane-c/extract-graph.test.ts`
- **Expected State**: 11-page PDF produces preview with `processedPages: 10` and `truncated: true`.

---

### P2-D-01 — Syllabus Upload & Graph Preview UI
- **Lane**: Lane D
- **Goal**: Build teacher syllabus upload interface, truncation warning banner, and interactive graph preview canvas.
- **Target Paths**: `src/features/courses/syllabus-upload.tsx`, `src/features/courses/graph-preview.tsx`
- **Dependencies**: `P1-D-01`, `P0-D-01`
- **Consumed / Produced Contracts**: Consumes upload preview DTO; mounts on `/professor/upload`.
- **Implementation Instructions**: Provide drag-and-drop file upload; display loading state; render truncation warning; display concept cards and prerequisite lists before commit button.
- **Invariant / Error Cases**: Show error modal if server returns `422 Unprocessable` on cyclic graph.
- **Fixture Path**: Mock upload API response.
- **Prerequisites & State**: Route shells ready.

#### CP-P2-D-01 — Upload Preview UI Verification
- **Command**: `npm test tests/unit/lane-d/upload-ui.test.ts`
- **Expected State**: Uploading file renders preview with 33 concept badges and commit button.

---

### P2-D-02 — Interactive D3-Force Knowledge Graph Visualizer & Star Vessels
- **Lane**: Lane D
- **Goal**: Build D3-force knowledge graph with topological levels, star vessel rendering, vertical clip-rectangle confidence fill, ancestor path highlighting, and accessible text alternatives.
- **Target Paths**: `src/features/graph/knowledge-graph.tsx`, `src/features/graph/d3-force-layout.ts`, `src/features/graph/star-vessel.tsx`
- **Dependencies**: `P0-D-01`, `P2-A-01`, `P1-D-02`
- **Consumed / Produced Contracts**: Renders graph payload from `GET /api/courses/:id/graph` using warm tokens and star vessels.
- **Implementation Instructions**: Compute topological ranks; run 300-tick off-screen precomputation simulation; render SVG star vessels at D3 coordinates with bottom-up vertical clip rectangle proportional to confidence ($c \in [0.0, 1.0]$); map visual fill states 1:1 to canonical bands (`gray`, `red`, `yellow`, `green`); highlight prerequisite paths on click.
- **Invariant / Error Cases**: Support `prefers-reduced-motion` by disabling force physics; ensure all stars have textual status badges.
- **Fixture Path**: Precomputed CS229 graph fixture.
- **Prerequisites & State**: Warm design tokens and DAG validation ready.

#### CP-P2-D-02 — Graph Visualizer Verification
- **Command**: `npm test tests/unit/lane-d/knowledge-graph.test.ts`
- **Expected State**: SVG renders 33 star vessels with vertical confidence fill; clicking node illuminates all ancestor prerequisite links.

---

### P2-D-03 — SVG Companion Mascot Spark, Mood Expressions & Form Transitions
- **Lane**: Lane D
- **Goal**: Implement responsive SVG companion mascot Spark with mood expressions and form evolution.
- **Target Paths**: `src/features/mascot/spark-mascot.tsx`, `src/features/mascot/spark-moods.ts`
- **Dependencies**: `P1-D-02`, `P1-A-05`
- **Consumed / Produced Contracts**: Consumes `SparkForm`, `skyBrightness`, and client mood state; renders 132px / 84px / 32px SVG mascot.
- **Implementation Instructions**: Build vector SVG anatomy (body flame, expressive eyes, radiating rays). Implement moods (`calm`, `think`, `cheer`, `oops`, `sleepy`). Implement evolutionary forms (Ember, Spark, Glow, Nova). Use CSS transform/opacity for ambient floating; disable all motion under `prefers-reduced-motion: reduce`.
- **Invariant / Error Cases**: Mood animations must never obstruct UI controls or simulate server responses.
- **Fixture Path**: Headless SVG rendering tests.
- **Prerequisites & State**: Warm palette and game contracts available.

#### CP-P2-D-03 — Spark Mascot Verification
- **Command**: `npm test tests/unit/lane-d/spark-state.test.ts`
- **Expected State**: Mascot renders correct SVG paths for all 4 forms and 5 moods; respects reduced-motion.

---

## Phase 3: Live Classroom & Transcript Streaming

### P3-A-01 — Attendance Evidence Recording & Verification
- **Lane**: Lane A
- **Goal**: Implement attendance evidence batch recording and verification against lecture sessions.
- **Target Paths**: `src/server/core/mastery/attendance-evidence.ts`
- **Dependencies**: `P1-A-04`
- **Consumed / Produced Contracts**: Applies attendance evidence to `MasteryService`.
- **Implementation Instructions**: Batch update mastery for students attending active concept chunks: advance confidence by $+0.05$ up to $0.30$ maximum.
- **Invariant / Error Cases**: Students with confidence $\ge 0.30$ remain untouched.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Mastery engine ready.

#### CP-P3-A-01 — Attendance Evidence Verification
- **Command**: `npm test tests/unit/lane-a/attendance-evidence.test.ts`
- **Expected State**: Confidence at $0.20$ becomes $0.25$; confidence at $0.60$ remains $0.60$.

---

### P3-B-01 — Authenticated Socket.IO Server & Room Authorization
- **Lane**: Lane B
- **Goal**: Mount Socket.IO on persistent HTTP server with JWT handshake authentication and room isolation.
- **Target Paths**: `src/server/realtime/socket-server.ts`, `src/server/realtime/room-authorizer.ts`
- **Dependencies**: `P1-A-01`, `P0-B-01`
- **Consumed / Produced Contracts**: Implements `RealtimePublisher` and room access control.
- **Implementation Instructions**: Validate JWT during handshake; extract `ActorContext`; enforce room authorization on `lecture:*`, `professor:*`, and `student:*` joins.
- **Invariant / Error Cases**: Student socket attempting to join `professor:*` room receives `FORBIDDEN`.
- **Fixture Path**: In-memory Socket.IO test client.
- **Prerequisites & State**: Auth middleware available.

#### CP-P3-B-01 — Socket Authorization Verification
- **Command**: `npm test tests/integration/lane-b/socket-auth.test.ts`
- **Expected State**: Authenticated client joins authorized room; unauthorized room join is rejected.

---

### P3-B-02 — Live Transcript Chunk Ingestion & Broadcasting
- **Lane**: Lane B
- **Goal**: Ingest transcript chunks via HTTP endpoint, persist in database, and broadcast via Socket.IO.
- **Target Paths**: `src/server/classroom/transcript-ingestor.ts`, `src/server/classroom/transcript-repository.ts`
- **Dependencies**: `P3-B-01`, `P1-B-01`
- **Consumed / Produced Contracts**: Implements `ClassroomService.ingestTranscriptChunk`.
- **Implementation Instructions**: Persist chunk in `transcript_chunks`; trigger concept detection; broadcast `transcript:chunk` to `lecture:<lectureId>`.
- **Invariant / Error Cases**: Reject chunks submitted to completed lectures (`400 Bad Request`).
- **Fixture Path**: Simulated transcript input.
- **Prerequisites & State**: Socket server mounted.

#### CP-P3-B-02 — Transcript Ingestion Verification
- **Command**: `npm test tests/integration/lane-b/transcript-ingestion.test.ts`
- **Expected State**: Chunk persists with timestamp; connected socket receives `transcript:chunk` event.

---

### P3-B-03 — Reference-Counted Connection & Attendance Tracker
- **Lane**: Lane B
- **Goal**: Track active lecture attendance per student across multiple browser tabs with 30-second grace window.
- **Target Paths**: `src/server/realtime/presence-tracker.ts`
- **Dependencies**: `P3-B-01`, `P3-A-01`
- **Consumed / Produced Contracts**: Emits attendance evidence to `P3-A-01`.
- **Implementation Instructions**: Track `Map<studentId, Set<socketId>>`; increment on join, decrement on leave; start 30s timer on last socket disconnect.
- **Invariant / Error Cases**: Closing 1 of 2 tabs does not terminate attendance.
- **Fixture Path**: Multi-socket unit test.
- **Prerequisites & State**: Socket server ready.

#### CP-P3-B-03 — Attendance Tracking Verification
- **Command**: `npm test tests/unit/lane-b/presence-tracker.test.ts`
- **Expected State**: Dual-socket client retains active presence when first socket disconnects.

---

### P3-B-04 — Lecture Simulator & Zoom RTMS Streaming Adapter
- **Lane**: Lane B
- **Goal**: Build automated transcript simulator and Zoom RTMS streaming adapter with explicit UI labels.
- **Target Paths**: `src/server/zoom/rtms-adapter.ts`, `src/server/classroom/simulator.ts`
- **Dependencies**: `P3-B-02`
- **Consumed / Produced Contracts**: Ingests live speech or simulated speech into `ClassroomService`.
- **Implementation Instructions**: Implement simulated speech ticker emitting chunks every 4 seconds. In live mode, connect to Zoom RTMS WebSocket stream.
- **Invariant / Error Cases**: Simulated speech must tag chunks with `isSimulated: true`.
- **Fixture Path**: Prerecorded CS229 lecture transcript script.
- **Prerequisites & State**: Transcript ingestion endpoint ready.

#### CP-P3-B-04 — Speech Streaming Verification
- **Command**: `npm test tests/unit/lane-b/speech-streaming.test.ts`
- **Expected State**: Simulator emits sequential chunks with timestamps matching lecture script.

---

### P3-C-01 — Real-Time Sliding-Window Concept Detection Pipeline
- **Lane**: Lane C
- **Goal**: Ingest recent speech chunks and detect active knowledge graph concepts using OpenRouter Fast Model.
- **Target Paths**: `src/server/ai/pipelines/detect-concepts.ts`
- **Dependencies**: `P1-C-01`, `P0-C-01`
- **Consumed / Produced Contracts**: Implements `AiService.detectConcepts`.
- **Implementation Instructions**: Assemble 60–90 second transcript window; call OpenRouter Fast Model; parse returned UUIDs; associate in `transcript_concepts`.
- **Invariant / Error Cases**: Enforce 5-second timeout; failed detection returns empty array without throwing.
- **Fixture Path**: Deterministic text-matching fixture.
- **Prerequisites & State**: AI client available.

#### CP-P3-C-01 — Concept Detection Verification
- **Command**: `npm test tests/unit/lane-c/detect-concepts.test.ts`
- **Expected State**: Speech discussing loss functions and gradients returns IDs for "Loss Functions" and "Gradients".

---

### P3-C-02 — Post-Lecture Summarization Pipeline
- **Lane**: Lane C
- **Goal**: Generate structured summary, highlighted concepts, and transcript excerpts upon lecture completion.
- **Target Paths**: `src/server/ai/pipelines/summarize-lecture.ts`
- **Dependencies**: `P1-C-01`, `P1-B-01`
- **Consumed / Produced Contracts**: Implements `AiService.summarizeLecture`.
- **Implementation Instructions**: Fetch all chunks for lecture; call OpenRouter Deep Model; format Markdown summary; broadcast `lecture:summary-ready`.
- **Invariant / Error Cases**: Lecture with zero chunks returns concise notice without LLM error.
- **Fixture Path**: Fixture transcript dataset.
- **Prerequisites & State**: Lecture lifecycle service ready.

#### CP-P3-C-02 — Summarization Verification
- **Command**: `npm test tests/unit/lane-c/summarize-lecture.test.ts`
- **Expected State**: Completed lecture generates markdown summary with key concepts list.

---

### P3-D-01 — Teacher Live Lecture Controls & Streaming Transcript Feed
- **Lane**: Lane D
- **Goal**: Build teacher live lecture dashboard with start/end controls, live transcript feed, and concept highlights.
- **Target Paths**: `src/features/professor/lecture-controls.tsx`, `src/features/professor/transcript-feed.tsx`
- **Dependencies**: `P1-D-01`, `P3-B-02`
- **Consumed / Produced Contracts**: Mounts on `/professor/dashboard`; listens for `transcript:chunk`.
- **Implementation Instructions**: Render auto-scrolling transcript timeline; display active speaker names; render detected concept chips beside chunks.
- **Invariant / Error Cases**: Display prominent `[SIMULATED TRANSCRIPT]` badge when simulator is active.
- **Fixture Path**: Socket mock emitting test chunks.
- **Prerequisites & State**: UI tokens ready.

#### CP-P3-D-01 — Teacher Controls Verification
- **Command**: `npm test tests/unit/lane-d/teacher-dashboard.test.ts`
- **Expected State**: Transcript feed appends incoming socket chunks; elapsed timer updates continuously.

---

### P3-D-02 — Student Real-Time Lecture View & Active Node Overlay
- **Lane**: Lane D
- **Goal**: Build student live lecture sidebar and pulsing active concept overlay on knowledge graph.
- **Target Paths**: `src/features/student/student-lecture-view.tsx`, `src/features/graph/active-concept-overlay.tsx`
- **Dependencies**: `P2-D-02`, `P3-C-01`, `P2-D-03`
- **Consumed / Produced Contracts**: Listens for `lecture:concept-detected`; mounts on `/student/[studentId]`.
- **Implementation Instructions**: Listen for concept detection events; trigger pulsing amber ring on corresponding graph nodes using `motion/react`. Trigger attentive `think` mood on mascot Spark via `P2-D-03`.
- **Invariant / Error Cases**: Pulse animation respects `prefers-reduced-motion`.
- **Fixture Path**: Mock socket events.
- **Prerequisites & State**: Graph visualizer ready.

#### CP-P3-D-02 — Student Lecture View Verification
- **Command**: `npm test tests/unit/lane-d/student-lecture-view.test.ts`
- **Expected State**: Detection event pulses targeted SVG graph node on student canvas.

---

## Phase 4: Formative Polls & Teaching Interventions

### P4-A-01 — Poll Response Atomic Mastery Evidence Application
- **Lane**: Lane A
- **Goal**: Transactionally apply evaluated poll responses to `student_mastery` and increment `attempts`.
- **Target Paths**: `src/server/core/mastery/poll-evidence.ts`
- **Dependencies**: `P1-A-04`
- **Consumed / Produced Contracts**: Calls `apply_mastery_evidence` RPC for `poll` evidence.
- **Implementation Instructions**: Verify poll response; calculate new confidence ($c \to \max(old, 0.85)$ for correct, $\max(old, 0.50)$ for partial, $0.20$ or $\min(old, 0.20)$ for wrong); increment attempts by 1.
- **Invariant / Error Cases**: Duplicate identical evaluation does not re-increment attempts.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Mastery RPC ready.

#### CP-P4-A-01 — Poll Mastery Evidence Verification
- **Command**: `npm test tests/unit/lane-a/poll-evidence.test.ts`
- **Expected State**: Correct response advances confidence to $0.85$ and attempts from 0 to 1.

---

### P4-A-02 — Course Heatmap Aggregation Service & Cache
- **Lane**: Lane A
- **Goal**: Aggregate student confidence across 4 bands for all course concepts; emit `heatmap:updated`.
- **Target Paths**: `src/server/core/mastery/heatmap-service.ts`
- **Dependencies**: `P1-A-04`, `P3-B-01`
- **Consumed / Produced Contracts**: Implements `MasteryService.getClassHeatmap`.
- **Implementation Instructions**: Aggregate `student_mastery` counts grouped by concept and band (`gray`, `red`, `yellow`, `green`). Broadcast updates to `professor:<lectureId>`.
- **Invariant / Error Cases**: Empty course returns zero counts for all bands without SQL division error.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Mastery table populated.

#### CP-P4-A-02 — Heatmap Service Verification
- **Command**: `npm test tests/unit/lane-a/heatmap-service.test.ts`
- **Expected State**: Aggregated counts match seeded student confidence distribution.

---

### P4-B-01 — Poll Lifecycle Manager & Response Ingestion
- **Lane**: Lane B
- **Goal**: Manage poll state machine (`draft` -> `active` -> `closed`), response ingestion, and single-active-poll invariant.
- **Target Paths**: `src/server/classroom/poll-service.ts`, `src/server/classroom/poll-repository.ts`
- **Dependencies**: `P3-B-01`, `P1-B-01`
- **Consumed / Produced Contracts**: Implements poll activation, response submission, and closing.
- **Implementation Instructions**: Enforce single active poll per lecture. Ingest student responses with unique `(question_id, student_id)` constraint. Broadcast `poll:new-question` and `poll:closed`.
- **Invariant / Error Cases**: Activating a poll while one is active returns `409 ACTIVE_POLL_EXISTS`. Responding to a closed poll returns `400 INVALID_POLL_STATUS`. Conflicting second response returns `409 RESPONSE_ALREADY_SUBMITTED`.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Classroom service available.

#### CP-P4-B-01 — Poll Lifecycle Verification
- **Command**: `npm test tests/unit/lane-b/poll-lifecycle.test.ts`
- **Expected State**: Poll activates, accepts response, rejects duplicate, and closes cleanly.

---

### P4-C-01 — Socratic Formative Poll Question Generation Pipeline
- **Lane**: Lane C
- **Goal**: Generate open-ended conceptual comprehension questions from active lecture concepts via OpenRouter.
- **Target Paths**: `src/server/ai/pipelines/generate-poll.ts`
- **Dependencies**: `P1-C-01`, `P3-C-01`
- **Consumed / Produced Contracts**: Implements `AiService.generatePollQuestion`.
- **Implementation Instructions**: Format prompt with concept description and recent transcript chunks; call OpenRouter Fast Model; parse question and expected rubric.
- **Invariant / Error Cases**: Enforce 15-second timeout; malformed JSON throws typed parsing error.
- **Fixture Path**: Deterministic poll question fixture.
- **Prerequisites & State**: AI client ready.

#### CP-P4-C-01 — Poll Generation Verification
- **Command**: `npm test tests/unit/lane-c/generate-poll.test.ts`
- **Expected State**: Concept "Gradient Descent" produces open-ended question testing learning rate dynamics.

---

### P4-C-02 — Server-Side Poll Response Evaluation Pipeline
- **Lane**: Lane C
- **Goal**: Evaluate free-form student responses against rubric criteria into `correct`, `partial`, or `wrong`.
- **Target Paths**: `src/server/ai/pipelines/evaluate-poll.ts`
- **Dependencies**: `P1-C-01`, `P4-A-01`
- **Consumed / Produced Contracts**: Implements `AiService.evaluatePollResponse`.
- **Implementation Instructions**: Prompt OpenRouter Fast Model with rubric and student response; validate output schema with Zod; return pedagogical feedback and discrete outcome.
- **Invariant / Error Cases**: 8-second timeout; upstream error leaves response in `failed` status without mutating mastery.
- **Fixture Path**: Pre-graded test response pairs.
- **Prerequisites & State**: AI client ready.

#### CP-P4-C-02 — Poll Evaluation Verification
- **Command**: `npm test tests/unit/lane-c/evaluate-poll.test.ts`
- **Expected State**: Accurate reasoning graded `correct`; flawed explanation graded `wrong` with specific feedback.

---

### P4-C-03 — Real-Time Misconception Clustering & Pedagogical Interventions
- **Lane**: Lane C
- **Goal**: Synthesize course-specific student misconceptions from poll answers and recommend concrete teacher actions.
- **Target Paths**: `src/server/ai/pipelines/suggest-interventions.ts`
- **Dependencies**: `P1-C-01`, `P4-B-01`
- **Consumed / Produced Contracts**: Implements `AiService.suggestInterventions`.
- **Implementation Instructions**: Cluster incorrect student answers; identify root conceptual confusion; produce 2–3 actionable instructional recommendations.
- **Invariant / Error Cases**: 30-second timeout; a nonempty set of exclusively correct evaluations returns positive mastery confirmation. Empty or wholly unrated input reports insufficient evidence without claiming mastery; wrong or partial evaluations produce 2–3 actionable interventions.
- **Fixture Path**: Fixture of 4 student poll responses (1 correct, 3 flawed).
- **Prerequisites & State**: Poll response repository ready.

#### CP-P4-C-03 — Interventions Verification
- **Command**: `npm test tests/unit/lane-c/suggest-interventions.test.ts`
- **Expected State**: Incorrect backprop answers trigger specific recommendation to diagram activation caching.

---

### P4-D-01 — Formative Poll Teacher Dashboard & Live Response Heatmap
- **Lane**: Lane D
- **Goal**: Build teacher poll controls (Generate, Preview/Edit, Activate, Close) and real-time response distribution heatmap.
- **Target Paths**: `src/features/professor/poll-panel.tsx`, `src/features/professor/class-heatmap.tsx`
- **Dependencies**: `P1-D-01`, `P4-A-02`, `P4-B-01`
- **Consumed / Produced Contracts**: Mounts on `/professor/dashboard`; receives `heatmap:updated`.
- **Implementation Instructions**: Display draft question editor; show live response counter; render 4-band color bars with text percentages.
- **Invariant / Error Cases**: Disable activate button if another poll is active.
- **Fixture Path**: Mock heatmap socket events.
- **Prerequisites & State**: Teacher controls ready.

#### CP-P4-D-01 — Teacher Poll Dashboard Verification
- **Command**: `npm test tests/unit/lane-d/teacher-poll-ui.test.ts`
- **Expected State**: Activating poll updates UI state to `active`; response counter increments in real time.

---

### P4-D-02 — Student Active Poll Modal & Evaluation Card
- **Lane**: Lane D
- **Goal**: Build student poll pop-up modal, submission input, and private evaluation feedback card.
- **Target Paths**: `src/features/student/active-poll-modal.tsx`, `src/features/student/evaluation-card.tsx`
- **Dependencies**: `P1-D-01`, `P4-B-01`, `P2-D-03`
- **Consumed / Produced Contracts**: Listens for `poll:new-question`; calls `POST /api/polls/:id/respond`.
- **Implementation Instructions**: Animate modal entrance via `motion/react`; accept text response; display loading spinner; render evaluation outcome (`correct` green badge, `wrong` red badge) and feedback. Trigger Spark mascot mood reaction (`cheer` on correct, `oops` on wrong) using `P2-D-03`.
- **Invariant / Error Cases**: Modal closes cleanly when `poll:closed` event arrives.
- **Fixture Path**: Test poll question payload.
- **Prerequisites & State**: Student lecture view ready.

#### CP-P4-D-02 — Student Poll UI Verification
- **Command**: `npm test tests/unit/lane-d/student-poll-ui.test.ts`
- **Expected State**: Student submits answer; evaluation card renders outcome and feedback; personal node updates color.

### P4-A-03 — Class Sky Aggregate Confidence & Course Effort Service
- **Lane**: Lane A
- **Goal**: Implement course-level effort aggregation, percentile calculations, and Class Sky concept mean confidence queries.
- **Target Paths**: `src/server/core/game/course-effort-service.ts`
- **Dependencies**: `P4-A-02`, `P1-A-06`
- **Consumed / Produced Contracts**: Implements `GameService.getCourseEffort(actor, courseId)`.
- **Implementation Instructions**: Query total XP per student from `xp_events`; calculate mean course confidence from `student_mastery`; compute cohort percentile rank via exact formula $\text{round}(100 \times |\{j \mid X_j < X_s\}| / \max(1, N - 1))$; assign `high_effort_low_mastery` flag when $\text{percentile}_{\text{XP}} \ge 75 \land \text{percentile}_{\text{confidence}} \le 40$. Query concept mean confidence and correlate with committed transcript concepts.
- **Invariant / Error Cases**: Single-student courses return percentile 0; ties share rank; unassessed students remain explicit.
- **Fixture Path**: Database fixture with 4 students.
- **Prerequisites & State**: XP ledger and heatmap service ready.

#### CP-P4-A-03 — Course Effort Service Verification
- **Command**: `npm test tests/unit/lane-a/course-effort.test.ts`
- **Expected State**: Rahul flagged as `high_effort_low_mastery` with high XP and low confidence; Hari unflagged.

---

### P4-D-03 — Instructor Class Sky Visualization & Effort/Mastery Roster
- **Lane**: Lane D
- **Goal**: Build Class Sky tab on teacher dashboard displaying class mean concept stars, taught attention rings, and effort vs mastery quadrant roster.
- **Target Paths**: `src/features/professor/class-sky.tsx`, `src/features/professor/effort-roster.tsx`
- **Dependencies**: `P4-D-01`, `P4-A-03`, `P2-D-03`
- **Consumed / Produced Contracts**: Consumes `CourseEffortDTO[]` and concept mean confidence; mounts on `/professor/dashboard`.
- **Implementation Instructions**: Render knowledge graph with stars colored by class mean confidence; display attention rings for taught concepts with $\bar{c} < 0.40$; build sortable effort roster with XP, confidence, and `high_effort_low_mastery` warning badge.
- **Invariant / Error Cases**: Ensure no student-facing leaderboards or public ranking indicators exist.
- **Fixture Path**: Mock teacher dashboard state.
- **Prerequisites & State**: Teacher dashboard and course effort service ready.

#### CP-P4-D-03 — Class Sky UI Verification
- **Command**: `npm test tests/unit/lane-d/class-sky.test.ts`
- **Expected State**: Taught concept below 0.40 renders crimson attention ring; effort table sorts by XP and confidence percentiles.

---
---

## Phase 5: Autonomous Learning & Socratic Tutoring

### P5-A-01 — Quiz & Tutoring Evidence RPC Integration
- **Lane**: Lane A
- **Goal**: Integrate practice quiz and tutoring understanding evidence with `apply_mastery_evidence` RPC.
- **Target Paths**: `src/server/core/mastery/learning-evidence.ts`
- **Dependencies**: `P1-A-04`
- **Consumed / Produced Contracts**: Applies `quiz` and `tutor` evidence to `MasteryService`.
- **Implementation Instructions**: Calculate quiz deltas based on score fraction: $\ge 80\% \to +0.15$, $\ge 60\% \to +0.10$, $\ge 40\% \to +0.05$, else $+0.02$. Tutor evidence adds $+0.20$ clamped to $1.0$.
- **Invariant / Error Cases**: Quiz attempts must not increment `student_mastery.attempts`.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Mastery RPC ready.

#### CP-P5-A-01 — Learning Evidence Verification
- **Command**: `npm test tests/unit/lane-a/learning-evidence.test.ts`
- **Expected State**: $80\%$ quiz score advances confidence by $+0.15$; attempts counter remains unchanged.

---

### P5-C-01 — Socratic Tutoring Dialogue Pipeline & Understanding Verification
- **Lane**: Lane C
- **Goal**: Implement multi-turn Socratic tutoring pipeline with understanding verification check.
- **Target Paths**: `src/server/ai/pipelines/socratic-tutor.ts`, `src/server/ai/pipelines/check-understanding.ts`
- **Dependencies**: `P1-C-02`, `P5-A-01`
- **Consumed / Produced Contracts**: Implements `AiService.socraticTutorTurn` and `checkUnderstanding`.
- **Implementation Instructions**: Maintain conversation context; guide student with questioning; call verification check on breakthrough; trigger mastery update.
- **Invariant / Error Cases**: Never leak quiz answer keys or direct solutions in tutor responses.
- **Fixture Path**: Fixture multi-turn dialogue.
- **Prerequisites & State**: Tutoring session engine ready.

#### CP-P5-C-01 — Socratic Tutoring Pipeline Verification
- **Command**: `npm test tests/unit/lane-c/socratic-tutor.test.ts`
- **Expected State**: Tutor responds Socratically; student explanation of derivative confirms understanding and updates mastery.

---

### P5-C-02 — Concept Learning Page Generation Pipeline
- **Lane**: Lane C
- **Goal**: Generate comprehensive, structured Markdown learning pages with KaTeX math and common pitfalls.
- **Target Paths**: `src/server/ai/pipelines/generate-learning-page.ts`, `src/server/learning/learning-page-repository.ts`
- **Dependencies**: `P1-C-01`
- **Consumed / Produced Contracts**: Implements `AiService.generateLearningPage`.
- **Implementation Instructions**: Call OpenRouter Deep Model; format markdown with formal definition, intuition, worked examples, and pitfalls; cache in `concept_learning_pages`.
- **Invariant / Error Cases**: 60-second timeout; sanitize markdown output.
- **Fixture Path**: Precomputed markdown learning guide.
- **Prerequisites & State**: AI client available.

#### CP-P5-C-02 — Learning Page Pipeline Verification
- **Command**: `npm test tests/unit/lane-c/learning-page.test.ts`
- **Expected State**: Generated page contains definition, math blocks, and examples exceeding 500 characters.

---

### P5-C-03 — Practice Quiz Generation & Server-Side Scoring Engine
- **Lane**: Lane C
- **Goal**: Generate 5-question multiple choice quizzes and evaluate submissions strictly on the server.
- **Target Paths**: `src/server/ai/pipelines/generate-quiz.ts`, `src/server/learning/quiz-service.ts`
- **Dependencies**: `P1-C-01`, `P5-A-01`
- **Consumed / Produced Contracts**: Implements `AiService.generateQuizQuestions` and `LearningService.submitQuiz`.
- **Implementation Instructions**: Generate 5 questions with 4 options each; store correct answer in `concept_quiz_questions`. On submission, grade indices on server; record attempt in `quiz_attempts`. Hint-capable Encounter enhancements are added in `P5-C-06`.
- **Invariant / Error Cases**: Strip correct answer indices from student quiz fetch endpoints.
- **Fixture Path**: Stored quiz question set.
- **Prerequisites & State**: Learning repository ready.

#### CP-P5-C-03 — Quiz Scoring Verification
- **Command**: `npm test tests/unit/lane-c/quiz-service.test.ts`
- **Expected State**: Server grades answer indices; 4/5 correct yields $0.80$ score and $+0.15$ delta.

---

### P5-C-04 — OpenRouter Academic Resource Search & Cited Q&A (Perplexity Models)
- **Lane**: Lane C
- **Goal**: Search authoritative academic resources and provide grounded Q&A with validated citations via OpenRouter (Perplexity search model).
- **Target Paths**: `src/server/ai/pipelines/search-resources.ts`, `src/server/ai/pipelines/resource-qa.ts`
- **Dependencies**: `P1-C-01`
- **Consumed / Produced Contracts**: Implements `AiService.searchAcademicResources` and `answerResourceQuestion`.
- **Implementation Instructions**: Call OpenRouter Search Model (Perplexity Sonar Pro); validate external URLs; parse citation numbers; return structured resources.
- **Invariant / Error Cases**: 10-second timeout; malformed citation URLs are filtered out.
- **Fixture Path**: Deterministic search fixture with verified URLs.
- **Prerequisites & State**: OpenRouter client available.

#### CP-P5-C-04 — Academic Search Verification
- **Command**: `npm test tests/unit/lane-c/resource-search.test.ts`
- **Expected State**: Query returns verified academic URLs and grounded answer with citations.

---

### P5-C-05 — TutorFeature, LearningFeature & StudyGroupFeature UI Modules
- **Lane**: Lane C
- **Goal**: Author the three self-contained feature UI components exported for Lane D route shells.
- **Target Paths**: `src/features/tutor/tutor-feature.tsx`, `src/features/learning/learning-feature.tsx`, `src/features/study-groups/study-group-feature.tsx`
- **Dependencies**: `P5-C-01`, `P5-C-02`, `P5-C-03`, `P0-D-01`
- **Consumed / Produced Contracts**: Exports typed React feature components consuming standard DTOs.
- **Implementation Instructions**: Build chat widget, KaTeX math renderer, quiz question card, and study group matchmaking lobby.
- **Invariant / Error Cases**: Render error boundary if child API call fails.
- **Fixture Path**: Mock feature props and API handlers.
- **Prerequisites & State**: Design tokens available.

#### CP-P5-C-05 — Feature Components Verification
- **Command**: `npm test tests/unit/lane-c/feature-components.test.ts`
- **Expected State**: All three feature components render cleanly with interactive state handling.

---

### P5-D-01 — Student Concept Learning & Quiz Route Shell Mounting
- **Lane**: Lane D
- **Goal**: Mount `LearningFeature` on `/student/[studentId]/concepts/[conceptId]` with breadcrumb navigation.
- **Target Paths**: `src/app/student/[studentId]/concepts/[conceptId]/page.tsx`
- **Dependencies**: `P1-D-01`, `P5-C-05`
- **Consumed / Produced Contracts**: Mounts Lane C `LearningFeature`.
- **Implementation Instructions**: Validate route parameters; fetch initial concept metadata; render `LearningFeature` inside student layout.
- **Invariant / Error Cases**: Invalid concept ID returns 404 Not Found page.
- **Fixture Path**: Mock route props.
- **Prerequisites & State**: Route shells ready.

#### CP-P5-D-01 — Learning Page Route Verification
- **Command**: `npm test tests/unit/lane-d/learning-route.test.ts`
- **Expected State**: Concept page renders learning guide and quiz widget.

---

### P5-D-02 — Student Tutoring & Lecture Summaries Shell Mounting
- **Lane**: Lane D
- **Goal**: Mount `TutorFeature` on `/student/[studentId]/tutor` and lecture summaries on `/student/[studentId]/summaries`.
- **Target Paths**: `src/app/student/[studentId]/tutor/page.tsx`, `src/app/student/[studentId]/summaries/page.tsx`
- **Dependencies**: `P1-D-01`, `P5-C-05`, `P3-C-02`
- **Consumed / Produced Contracts**: Mounts Lane C `TutorFeature` and summary viewer.
- **Implementation Instructions**: Provide concept selector for tutoring; mount interactive tutor; display chronological list of completed lecture summaries.
- **Invariant / Error Cases**: Empty summaries list shows helpful guidance.
- **Fixture Path**: Mock student session data.
- **Prerequisites & State**: Route shells ready.

#### CP-P5-D-02 — Tutoring & Summary Route Verification
- **Command**: `npm test tests/unit/lane-d/tutor-route.test.ts`
- **Expected State**: Tutoring page loads Socratic chat; summaries page renders past lecture highlights.

### P5-A-02 — Daily Quests, Streak Calculation, XP Ledger & Eclipse Service
- **Lane**: Lane A
- **Goal**: Implement Daily Quest generation, streak tracking, append-only XP awards, and Eclipse review pressure calculation in `GameService`.
- **Target Paths**: `src/server/core/game/game-service.ts`, `src/server/core/game/daily-quest-generator.ts`, `src/server/core/game/eclipse-service.ts`
- **Dependencies**: `P1-A-06`, `P5-A-01`, `P2-A-02`
- **Consumed / Produced Contracts**: Implements `GameService.getDailyQuest`, `getSummary`, `getEclipse`.
- **Implementation Instructions**: Generate up to 3 ready concepts (unreviewed, overdue >3 days, or $c < 0.70$) sorted overdue first, confidence ascending, importance descending, UUID ascending. Persist in `daily_quests` for `(student_id, quest_date)`. Compute streak increments on nonempty clear. Calculate Eclipse strength $\text{round}(100 \times \sum \max(0, 0.70 - c_i) / (n \times 0.70))$. Award exact-once XP via `xp_events` with unique constraint enforcement.
- **Invariant / Error Cases**: Reopening quest on same date returns identical queue; repeating quiz on same concept/date awards 0 XP; empty quest clear awards 0 XP and leaves streak unchanged.
- **Fixture Path**: Unit test with student mastery fixture.
- **Prerequisites & State**: Spark schema and quiz evidence ready.

#### CP-P5-A-02 — Game Progression Service Verification
- **Command**: `npm test tests/integration/lane-a/game-progression.test.ts`
- **Expected State**: Daily quest generates 3 sorted concepts; streak increments upon clear; repeated clear preserves exact-once XP award.

---

### P5-C-06 — Hint-Capable Question Generation & Practice Encounter Orchestration
- **Lane**: Lane C
- **Goal**: Implement `EncounterService` wrapping 5-question quizzes with 3-tier sequential hints and XP calculation.
- **Target Paths**: `src/server/learning/encounter-service.ts`, `src/server/learning/encounter-repository.ts`
- **Dependencies**: `P1-A-05`, `P5-C-03`, `P5-A-02`
- **Consumed / Produced Contracts**: Implements `EncounterService.createEncounter`, `getEncounter`, `getHint`, `submitEncounter`.
- **Implementation Instructions**: Create encounter with 5 questions and permuted options; store in `encounters`. Handle hint requests with strict sequential unlocking ($1 \to 2 \to 3$). Grade submission against stored keys; apply canonical quiz evidence; calculate XP discounted by hints used ($\max(8, 30 - 6 \times \text{hintsUsed})$ for correct, 8 for incorrect); update daily quest completion subset; emit `game:updated`.
- **Invariant / Error Cases**: Out-of-sequence hint returns `409 HINT_OUT_OF_SEQUENCE`; level outside 1–3 returns `400 INVALID_HINT_LEVEL`; hint after submit returns `409 ENCOUNTER_ALREADY_SUBMITTED`.
- **Fixture Path**: Question fixture with 3 hints per question.
- **Prerequisites & State**: Quiz service and game progression service ready.

#### CP-P5-C-06 — Encounter Service Verification
- **Command**: `npm test tests/integration/lane-c/encounters.test.ts`
- **Expected State**: Skipping hint tier returns 409; submission awards correct XP discounted by hints; mastery updates normally.

---

### P5-C-07 — Exported EncounterFeature Component & Hint Drawer
- **Lane**: Lane C
- **Goal**: Build accessible `EncounterFeature` React component with question carousel, hint drawer, Spark mood reactions, and reward card.
- **Target Paths**: `src/features/encounters/encounter-feature.tsx`, `src/features/encounters/hint-drawer.tsx`
- **Dependencies**: `P5-C-05`, `P5-C-06`
- **Consumed / Produced Contracts**: Exports `EncounterFeature` consuming `EncounterDTO` and `ActorContext`.
- **Implementation Instructions**: Render 5-question form with KaTeX math; build 3-tier hint drawer requesting `/api/encounters/:id/hints`; mount 84px Spark mascot in `think` mood; display submission result with score, confidence delta, XP earned, and Spark `cheer`/`oops` reaction.
- **Invariant / Error Cases**: Ensure submit button disables during transit; render clear error message on server failure.
- **Fixture Path**: Mock encounter props.
- **Prerequisites & State**: Feature components and encounter service ready.

#### CP-P5-C-07 — Encounter Feature Verification
- **Command**: `npm test tests/unit/lane-c/encounter-feature.test.ts`
- **Expected State**: Requesting hint displays text; submitting all 5 answers renders feedback card with XP total.

---

### P5-D-03 — Student Quests, Eclipse, Mascot Shell Mounting & Encounter Integration
- **Lane**: Lane D
- **Goal**: Mount Daily Quest panel, Eclipse diagnostic banner, Summary pill, 132px Spark mascot, and Encounter feature on `/student/[studentId]`.
- **Target Paths**: `src/features/student/quest-panel.tsx`, `src/features/student/eclipse-banner.tsx`, `src/features/student/game-summary-pill.tsx`, `src/app/student/[studentId]/page.tsx`
- **Dependencies**: `P5-A-02`, `P5-C-07`, `P2-D-02`, `P2-D-03`
- **Consumed / Produced Contracts**: Integrates game progression panels with star graph and mounts `EncounterFeature` in slide-over drawer.
- **Implementation Instructions**: Add summary pill (XP, streak, sky brightness, mascot thumbnail) to header; render Daily Quest panel with ready review items; render Eclipse banner with exam countdown; trigger `EncounterFeature` drawer when student clicks "Practice Encounter" on star detail drawer.
- **Invariant / Error Cases**: Empty daily quest displays "No review needed" state; reduced motion disables mascot floating.
- **Fixture Path**: Mock student game state.
- **Prerequisites & State**: Graph visualizer, mascot, and encounter feature ready.

#### CP-P5-D-03 — Student Game Panels Verification
- **Command**: `npm test tests/unit/lane-d/student-quests.test.ts`
- **Expected State**: Daily quest displays items; clicking practice opens encounter drawer; summary pill displays live XP.

---
---

## Phase 6: Consensual Peer Collaboration & Zoom Scheduling

### P6-A-01 — Study Group Relational Schema (Migration 0004), Availability & Lock RPCs
- **Lane**: Lane A
- **Goal**: Author migration for `student_availability`, `study_group_messages`, and `claim_and_create_match` RPC.
- **Target Paths**: `supabase/migrations/20261022000004_study_groups.sql`
- **Dependencies**: `P0-A-02`, `P1-A-06`
- **Consumed / Produced Contracts**: Produces study group relational schema and atomic pairing lock.
- **Implementation Instructions**: Author SQL migration creating availability intervals, chat table, and `claim_and_create_match` stored procedure enforcing `student1_id < student2_id`. Verify incremental application after game migration 0003 (`20261021000003_spark_learning.sql`).
- **Invariant / Error Cases**: Prevent simultaneous dual-matching of the same pool entry using `FOR UPDATE` row locks.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Base migrations 0001–0003 applied.

#### CP-P6-A-01 — Study Group Schema Verification
- **Command**: `npm test tests/integration/lane-a/study-group-schema.test.ts`
- **Expected State**: Availability tables created; `claim_and_create_match` atomically pairs two waiting students.

---

### P6-B-01 — Consensual Complementary Matchmaking Engine
- **Lane**: Lane B
- **Goal**: Implement complementary matchmaking algorithm ($\text{gap} \ge 0.30$) and atomic pair claiming.
- **Target Paths**: `src/server/study-groups/matchmaker.ts`, `src/server/study-groups/study-group-service.ts`
- **Dependencies**: `P6-A-01`, `P1-B-02`, `P1-A-04`
- **Consumed / Produced Contracts**: Implements `StudyGroupService.optIntoPool`.
- **Implementation Instructions**: Query waiting pool candidates; calculate mean absolute confidence difference over overlapping concepts; if $\ge 0.30$, invoke `claim_and_create_match` RPC; emit `study-group:matched`.
- **Invariant / Error Cases**: Students with identical confidence ($< 0.30$ gap) remain waiting. Unconsenting students never match.
- **Fixture Path**: Candidate pool fixture (Hari conf $0.80$, Rahul conf $0.15$).
- **Prerequisites & State**: Pool repository and RPC ready.

#### CP-P6-B-01 — Matchmaker Verification
- **Command**: `npm test tests/unit/lane-b/matchmaker.test.ts`
- **Expected State**: Hari and Rahul match on Backpropagation (gap $0.65$); two identical students do not match.

---

### P6-B-02 — Secure Peer Messaging & Room Broadcaster
- **Lane**: Lane B
- **Goal**: Implement persistent in-app messaging between matched peers with Socket.IO notifications.
- **Target Paths**: `src/server/study-groups/messaging-service.ts`, `src/server/study-groups/messaging-repository.ts`
- **Dependencies**: `P6-A-01`, `P3-B-01`
- **Consumed / Produced Contracts**: Implements `sendMessage` and `getMatchMessages`.
- **Implementation Instructions**: Persist message in `study_group_messages`; broadcast `study-group:message` to `study-group:<matchId>` room.
- **Invariant / Error Cases**: Non-members attempting to send or read messages receive `403 Forbidden`. No LLM bot simulation.
- **Fixture Path**: Local PostgreSQL.
- **Prerequisites & State**: Socket server ready.

#### CP-P6-B-02 — Peer Messaging Verification
- **Command**: `npm test tests/integration/lane-b/peer-messaging.test.ts`
- **Expected State**: S1 sends message; S2 receives socket event; third student access is blocked.

---

### P6-B-03 — Mutual Availability Overlap Detector & Scheduling State Machine
- **Lane**: Lane B
- **Goal**: Identify earliest 30-minute mutual UTC availability overlap and manage bilateral acceptance state.
- **Target Paths**: `src/server/study-groups/scheduler.ts`
- **Dependencies**: `P6-A-01`, `P6-B-01`
- **Consumed / Produced Contracts**: Implements `proposeSchedule` and `acceptSchedule`.
- **Implementation Instructions**: Intersect half-open UTC intervals $[startsAt, endsAt)$; propose earliest $\ge 30\text{-min}$ window; record `student1_accepted` and `student2_accepted`.
- **Invariant / Error Cases**: If no overlap exists, set `scheduling_status = 'no-overlap'`.
- **Fixture Path**: Overlapping availability intervals fixture.
- **Prerequisites & State**: Study group matches table ready.

#### CP-P6-B-03 — Availability Scheduler Verification
- **Command**: `npm test tests/unit/lane-b/scheduler.test.ts`
- **Expected State**: Overlapping intervals 14:00–16:00 and 15:00–17:00 propose 15:00–15:30 slot; bilateral acceptance advances state to `accepted`.

---

### P6-B-04 — Authentic Zoom OAuth 2.0 Client & Meeting Adapter
- **Lane**: Lane B
- **Goal**: Implement teacher Zoom OAuth flow, token refresh, and authentic meeting creation via Zoom REST API.
- **Target Paths**: `src/server/zoom/zoom-oauth.ts`, `src/server/zoom/zoom-meeting-adapter.ts`
- **Dependencies**: `P6-B-03`, `P1-A-01`
- **Consumed / Produced Contracts**: Implements `ZoomAdapter.createMeeting`.
- **Implementation Instructions**: Encrypt/decrypt teacher Zoom tokens at rest; call Zoom REST API to create scheduled meeting upon bilateral acceptance; persist join link and meeting ID.
- **Invariant / Error Cases**: If credentials missing in live mode, report `meeting_status = 'unavailable'`. Never generate fake URLs.
- **Fixture Path**: Deterministic Zoom adapter fixture.
- **Prerequisites & State**: Scheduler service ready.

#### CP-P6-B-04 — Zoom Meeting Adapter Verification
- **Command**: `npm test tests/unit/lane-b/zoom-adapter.test.ts`
- **Expected State**: Bilateral acceptance calls Zoom adapter, generating authentic meeting ID and join URL.

### P6-A-02 — Additive Collaboration Migration 0005 & Party Quest Constraints
- **Lane**: Lane A
- **Goal**: Author migration 0005 creating `study_group_invitations`, `party_quests`, and `party_quest_progress`, and linking foreign key from `encounters.party_quest_id` to `party_quests(id)`.
- **Target Paths**: `supabase/migrations/20261022000005_spark_collaboration.sql`
- **Dependencies**: `P6-A-01`, `P1-A-06`
- **Consumed / Produced Contracts**: Produces 3 collaboration extension tables (bringing total application tables to 28) and enables Encounter party source foreign key.
- **Implementation Instructions**: Author SQL migration creating tables, constraints, foreign keys, and indexes. Add foreign key from `encounters.party_quest_id` to `party_quests(id)`.
- **Invariant / Error Cases**: Ensure cascading deletes and strict relational integrity; check that `(party_quest_id, student_id, concept_id)` is unique.
- **Fixture Path**: Local Docker PostgreSQL.
- **Prerequisites & State**: Migration 0004 applied.

#### CP-P6-A-02 — Collaboration Extension Schema Verification
- **Command**: `npm test tests/integration/lane-a/party-schema.test.ts`
- **Expected State**: Tables created cleanly; encounters foreign key verified.

---

### P6-B-05 — Collaborative Party Quests, Candidate Invitations & Reward Distribution
- **Lane**: Lane B
- **Goal**: Implement candidate invitation queries, party quest lifecycle, independent peer completion tracking, and bilateral 60 XP award.
- **Target Paths**: `src/server/study-groups/party-quest-service.ts`, `src/server/study-groups/invitations-service.ts`
- **Dependencies**: `P6-A-02`, `P6-B-01`, `P6-B-02`, `P6-B-03`, `P5-C-06`
- **Consumed / Produced Contracts**: Implements `StudyGroupService.getCandidates`, `sendInvitation`, `respondToInvitation`, `createPartyQuest`, `getPartyQuests`.
- **Implementation Instructions**: Query opted-in pool candidates with gap $\ge 0.30$; label reciprocal vs mentor fit ($fit = \min(99, \text{round}(100 \times gap))$); create and accept invitations with 5-minute pool expiration; track individual peer quiz progress for 1–3 shared concepts; award 60 XP to each peer in `xp_events` upon bilateral completion; emit `party:quest-updated`.
- **Invariant / Error Cases**: Invitations to expired pool entries return `409 INVITATION_EXPIRED`; party quest requires bilateral completion before awarding XP; party attendance or chat never grants mastery confidence directly.
- **Fixture Path**: Mock study group match and party quest progress.
- **Prerequisites & State**: Study group services and encounter service ready.

#### CP-P6-B-05 — Party Quests Verification
- **Command**: `npm test tests/integration/lane-b/party-quests.test.ts`
- **Expected State**: Candidates return with fit labels; bilateral quiz completion marks party quest completed and awards 60 XP each.

---

### P6-C-01 — Extended StudyGroupFeature with Invitations, Fit Badges & Party Goals
- **Lane**: Lane C
- **Goal**: Extend `StudyGroupFeature` with candidate invitations list, fit badges, and collaborative Party Quest progress tracking.
- **Target Paths**: `src/features/study-groups/party-quest-panel.tsx`, `src/features/study-groups/candidate-invites.tsx`, `src/features/study-groups/study-group-feature.tsx`
- **Dependencies**: `P5-C-05`, `P6-B-05`
- **Consumed / Produced Contracts**: Consumes `party_quests` and `invitations` state; exports extended `StudyGroupFeature`.
- **Implementation Instructions**: Render candidate cards with fit badges (e.g., "92% Fit — Reciprocal Strengths"); provide "Send Invite" button; render Party Quest card with progress checkboxes for both peers; retain existing peer chat and Zoom meeting buttons.
- **Invariant / Error Cases**: Ensure unconsenting classmates cannot be invited; disable invite buttons when pool entry expires.
- **Fixture Path**: Mock extended study group props.
- **Prerequisites & State**: Base study group feature and party quest service ready.

#### CP-P6-C-01 — Extended Study Group UI Verification
- **Command**: `npm test tests/unit/lane-c/party-feature.test.ts`
- **Expected State**: Candidate cards render with fit score; party quest progress displays dual-student checkmarks.

---

### P6-D-01 — Peer Study Group Route Shell & Chat Interface
- **Lane**: Lane D
- **Goal**: Mount extended `StudyGroupFeature` on `/student/[studentId]/study-group` with real-time chat, availability picker, Zoom join button, candidate invitations, and party quests.
- **Target Paths**: `src/app/student/[studentId]/study-group/page.tsx`
- **Dependencies**: `P1-D-01`, `P5-C-05`, `P6-B-02`, `P6-C-01`
- **Consumed / Produced Contracts**: Mounts Lane C extended `StudyGroupFeature`.
- **Implementation Instructions**: Render pool opt-in card, candidate invitations, availability calendar selector, in-app messaging feed, collaborative Party Quest panel, and Zoom meeting card.
- **Invariant / Error Cases**: Display clear waiting state while peer match is pending.
- **Fixture Path**: Mock peer match data.
- **Prerequisites & State**: Route shells ready.

#### CP-P6-D-01 — Peer Study Group UI Verification
- **Command**: `npm test tests/unit/lane-d/study-group-route.test.ts`
- **Expected State**: Student views chat feed, sends message, sees party quest progress, and sees Zoom button upon meeting creation.

---

## Phase 7: Deployment, Verification & Final Acceptance

### P7-A-01 — Persistent Server Composition Root & Production Containerization
- **Lane**: Lane A
- **Goal**: Assemble composition root in `server/index.ts`, author `Dockerfile`, and configure Render deploy pipeline.
- **Target Paths**: `server/index.ts`, `Dockerfile`, `render.yaml`
- **Dependencies**: `P1-A-01`, `P3-B-01`, `P6-B-04`, `P5-C-01`, `P5-A-02`, `P5-C-06`, `P6-B-05`
- **Consumed / Produced Contracts**: Wires all services via constructor dependency injection; mounts Express and Next.js.
- **Implementation Instructions**: Build production server startup sequence; attach health check probe `GET /api/health`; configure graceful shutdown handlers (`SIGTERM`, `SIGINT`).
- **Invariant / Error Cases**: Ensure custom server handles both `/api/*` and Next page requests without port conflicts.
- **Fixture Path**: Local production build test.
- **Prerequisites & State**: All backend services implemented.

#### CP-P7-A-01 — Production Composition Verification
- **Command**: `npm run build && npm run doctor`
- **Expected State**: Clean production build; doctor script verifies all configuration schemas and port bindings.

---

### P7-A-02 — Deterministic 33-Node CS229 Database Seed & Demo Script
- **Lane**: Lane A
- **Goal**: Author deterministic database seed script, fast reset utility, and DemoToolbar helper for live demonstrations and video recording.
- **Target Paths**: `scripts/seed.ts`, `scripts/demo.ts`, `scripts/reset-demo.ts`, `src/components/demo/demo-toolbar.tsx`
- **Dependencies**: `P2-A-02`, `P1-A-03`, `P7-A-01`, `P6-A-02`
- **Consumed / Produced Contracts**: Populates canonical demo dataset defined in `docs/13-demo-and-acceptance.md` and provides `npm run demo:reset`.
- **Implementation Instructions**: Insert CS229 course; insert 33 concepts and 34 edges; insert Prof. Chen, Hari, Rahul, Praj, Vamshi; insert 132 `student_mastery` rows with baseline confidence values. Add deterministic labeled game fixtures (Daily Quest records, XP ledger rows, party quest seeds). Implement `npm run demo:reset` to truncate transient demo rows and restore baseline in under 2 seconds. Implement floating `DemoToolbar` in `src/components/demo/demo-toolbar.tsx` providing one-click persona switching (Prof. Chen / Hari / Rahul), simulated speech stepping, scripted poll answer injection, and instant peer matching. Document all five migration targets (0001–0005).
- **Invariant / Error Cases**: Script execution is idempotent; running twice leaves counts unchanged. Demo endpoints and toolbar are disabled in `NODE_ENV=production`.
- **Fixture Path**: Local Supabase database.
- **Prerequisites & State**: Migrations 0001–0005 applied.

#### CP-P7-A-02 — Database Seed Verification
- **Command**: `npm run db:seed`
- **Expected State**: Database asserts exactly 33 concepts, 34 edges, 4 students, and 132 mastery rows.

---

### P7-B-01 — Live Zoom RTMS & Webhook Production Verification
- **Lane**: Lane B
- **Goal**: Verify authentic Zoom RTMS speech streaming and webhook HMAC signature handling in live mode.
- **Target Paths**: `tests/integration/lane-b/zoom-live.test.ts`
- **Dependencies**: `P3-B-04`, `P6-B-04`
- **Consumed / Produced Contracts**: Validates live Zoom adapter against provider API.
- **Implementation Instructions**: Execute live verification test gated by `ZOOM_CLIENT_ID`; assert HMAC verification with secret token; assert meeting creation returns real Zoom URL.
- **Invariant / Error Cases**: Missing credentials fail explicitly with `503 Service Unavailable`.
- **Fixture Path**: Explicit live gate test.
- **Prerequisites & State**: Zoom credentials configured in environment.

#### CP-P7-B-01 — Live Zoom Verification
- **Command**: `npm run test:integration -- -t "ZoomLive"`
- **Expected State**: Live Zoom API call creates authentic meeting or reports explicit missing-credential error.

---

### P7-C-01 — Live OpenRouter Production Verification (Anthropic & Perplexity Models)
- **Lane**: Lane C
- **Goal**: Verify live OpenRouter pipelines for deep reasoning, fast evaluation, and Perplexity search against real OpenRouter API.
- **Target Paths**: `tests/integration/lane-c/ai-live.test.ts`
- **Dependencies**: `P4-C-01`, `P4-C-02`, `P5-C-04`
- **Consumed / Produced Contracts**: Validates live AI pipelines.
- **Implementation Instructions**: Execute live verification tests gated by `OPENROUTER_API_KEY`; assert schema validation on live model output and verify 3-tier hints generation in quiz pipeline.
- **Invariant / Error Cases**: Provider rate limits or missing keys fail loudly with typed status codes.
- **Fixture Path**: Explicit live gate test.
- **Prerequisites & State**: API keys configured in environment.

#### CP-P7-C-01 — Live AI Verification
- **Command**: `npm run test:integration -- -t "AiLive"`
- **Expected State**: Live OpenRouter calls return valid structured outputs passing Zod schemas.

---

### P7-D-01 — Multi-Browser End-to-End Playwright Journey Suite
- **Lane**: Lane D
- **Goal**: Execute full automated Playwright test suite validating user journeys J01 through J08.
- **Target Paths**: `tests/e2e/j01-to-j08.spec.ts`
- **Dependencies**: `P7-A-02`, `P3-D-01`, `P4-D-02`, `P6-D-01`
- **Consumed / Produced Contracts**: End-to-end multi-browser test harness.
- **Implementation Instructions**: Run Playwright suite with 3 isolated browser contexts (Teacher, Hari, Rahul). Exercise syllabus upload, live lecture, poll submission, evaluation, and peer chat/meeting creation.
- **Invariant / Error Cases**: Assert that Hari never sees Rahul's private evaluation.
- **Fixture Path**: Executed against local custom server in fixture mode.
- **Prerequisites & State**: Server and database running.

#### CP-P7-D-01 — E2E Journey Suite Verification
- **Command**: `npm run test:e2e`
- **Expected State**: All 8 user journeys J01–J08 pass completely with green assertions.

### P7-D-04 — Journeys J09–J11 Playwright End-to-End Test Suite
- **Lane**: Lane D
- **Goal**: Execute automated multi-browser Playwright test suite validating user journeys J09, J10, and J11.
- **Target Paths**: `tests/e2e/j09-to-j11.spec.ts`
- **Dependencies**: `P7-A-02`, `P5-D-03`, `P4-D-03`, `P6-D-01`
- **Consumed / Produced Contracts**: End-to-end game progression, mascot, encounter, party quest, and Class Sky test harness.
- **Implementation Instructions**: Run Playwright suite testing Daily Quest review clear, sequential 3-tier hints and XP discounting, streak increment, Eclipse pressure computation and exam countdown, Spark mascot form evolution, bilateral Party quest completion and 60 XP award, and instructor Class Sky mean confidence and effort roster quadrant (`high_effort_low_mastery` flag).
- **Invariant / Error Cases**: Assert hints cannot be unlocked out of sequence; assert duplicate practice on same date awards 0 XP; assert party quest awards XP only upon bilateral completion; assert no public student leaderboards exist.
- **Fixture Path**: Executed against local custom server in fixture mode.
- **Prerequisites & State**: Server and database running with seed data.

#### CP-P7-D-04 — J09–J11 E2E Journey Suite Verification
- **Command**: `npx playwright test tests/e2e/j09-to-j11.spec.ts`
- **Expected State**: All 3 journeys J09, J10, J11 pass completely with verified assertions.

---

### P7-D-02 — Responsive Layout & Accessibility Audit Verification
- **Lane**: Lane D
- **Goal**: Execute automated axe-core accessibility audits and responsive viewport tests across all page routes.
- **Target Paths**: `tests/e2e/a11y-audit.spec.ts`
- **Dependencies**: `P7-D-01`, `P7-D-04`
- **Consumed / Produced Contracts**: Accessibility and visual regression test suite.
- **Implementation Instructions**: Run axe-core checks on `/`, `/professor/dashboard`, `/student/[studentId]`, and `/student/[studentId]/concepts/[conceptId]`. Audit all pages including Class Sky, Daily Quest, and Encounter drawer at 400px and 1360px viewports with reduced motion checks. Assert zero WCAG 2.1 AA violations.
- **Invariant / Error Cases**: Check that mastery colors provide text alternatives and reduced-motion stops physics.
- **Fixture Path**: Headless Playwright run.
- **Prerequisites & State**: Frontend pages running.

#### CP-P7-D-02 — Accessibility Audit Verification
- **Command**: `npx playwright test tests/e2e/a11y-audit.spec.ts`
- **Expected State**: Zero critical/serious accessibility violations across all pages.

---

### P7-D-03 — Final Classroom Milestone & Complete Product Acceptance
- **Lane**: Lane D
- **Goal**: Execute final comprehensive demonstration runbook and verify all acceptance criteria across journeys J01 through J11.
- **Target Paths**: `docs/13-demo-and-acceptance.md`
- **Dependencies**: `P7-A-01` through `P7-D-02`, `P7-D-04`
- **Consumed / Produced Contracts**: Final verification signoff covering all eleven journeys (J01–J11).
- **Implementation Instructions**: Run `npm run check` and `npm run demo -- --mode=fixture --seed=42`. Verify that all full-product capabilities (classroom streaming, formative polls, Socratic tutoring, peer collaboration, Zoom meetings, Spark mascot, Daily Quests, encounters with tiered hints, Eclipse, and Class Sky) function cleanly.
- **Invariant / Error Cases**: Ensure no fake live claims or unverified fallbacks exist.
- **Fixture Path**: Full application stack.
- **Prerequisites & State**: Complete system deployed locally.

#### CP-P7-D-03 — Final Acceptance Signoff
- **Command**: `npm run check && npm run demo -- --mode=fixture --seed=42`
- **Expected State**: All typechecks, linters, unit tests, contract checks, and demo runbooks pass with zero errors.
---


