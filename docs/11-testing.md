# Testing Strategy & Quality Assurance

This document defines the testing methodology, suite structure, boundary verification rules, and automated regression scenarios for Spark.

---

## 1. Testing Pyramid & Suite Layout

The test architecture is structured into four distinct layers executed via Vitest and Playwright:

```text
tests/
├── unit/                       # Fast, isolated unit tests (Vitest)
│   ├── lane-a/                 # Mastery formulas, DAG cycle checks, importance math
│   ├── lane-b/                 # State machines (poll, lecture), matching scoring
│   ├── lane-c/                 # Prompt formatting, Zod schema parsing, quiz scoring
│   └── lane-d/                 # Visual token mapping, graph layout helpers
├── contracts/                  # Public interface and schema compliance tests (Vitest)
│   ├── service-ports.test.ts   # Asserts all service methods match contract definitions
│   └── boundary-rules.test.ts  # Static analysis preventing illegal cross-lane imports
├── integration/                # Real PostgreSQL & HTTP integration tests (Vitest)
│   ├── mastery-rpc.test.ts     # Concurrent mastery updates and transactional locks
│   ├── auth-gateway.test.ts    # Token verification and RBAC matrix enforcement
│   └── peer-matching.test.ts   # Concurrency tests for study group pool claiming
└── e2e/                        # Multi-browser end-to-end journey tests (Playwright)
    ├── j01-to-j08.spec.ts      # Core journeys (setup, lecture, polls, tutoring, peer match)
    ├── j09-to-j11.spec.ts      # Spark journeys (daily quest, hints, eclipse, party quest, Class Sky)
    └── a11y-audit.spec.ts      # Automated axe-core and viewport tests
```

---

## 2. Test Execution Commands & Environment Matrix

- `npm test`: Runs all unit and contract tests in memory (`INTEGRATION_MODE=fixture`).
- `npm run test:contracts`: Validates TypeScript service ports and Zod schemas against JSON fixtures.
- `npm run test:integration`: Executes integration tests against a running local Docker Supabase instance.
- `npm run test:e2e`: Runs Playwright end-to-end user journeys using multiple isolated browser contexts.
- `npm run check`: Unified offline preflight: runs typecheck, lint, unit tests, and contract checks.

---

## 3. Boundary & Architectural Verification

The `tests/contracts/boundary-rules.test.ts` suite enforces hard architectural boundaries via static AST analysis:
1. **No Direct Client Database Access**: Client-side files (`src/features/*`, `src/lib/client/*`, `src/app/*`) MUST NOT import `@supabase/supabase-js` or database repositories directly.
2. **No Sibling Internal Imports**: Modules in `src/server/<domain>/` MUST import external domain capabilities strictly through their public index file (`src/server/<domain>/index.ts`) or `src/contracts/`.
3. **No Private Service Mutations**: UI components and AI prompt pipelines MUST NOT execute direct SQL updates on `student_mastery`; all confidence updates must pass through `MasteryService.applyEvidence()`.

---

## 4. Canonical Behavioral Regression Scenarios

All implementations must formally pass the following regression scenarios:

### 4.1 Mastery & Calculation Scenarios
- **SC-01: Discrete Boundary Mapping**: Input array `[0.0, 0.3999, 0.40, 0.6999, 0.70, 1.0]` maps exactly to `["gray", "red", "yellow", "yellow", "green", "green"]`. Out-of-bounds numbers and `NaN` are rejected.
- **SC-02: Attendance Ceiling**: A student with confidence $0.28$ receiving attendance evidence advances to $0.30$. A student with confidence $0.60$ receiving attendance remains at $0.60$.
- **SC-03: Socratic Tutoring Boost & Clamping**: Tutoring evidence at $0.30$ advances confidence to $0.50$. Replaying the same tutoring message evidence leaves confidence at $0.50$ (idempotent). Confidence at $0.90$ is clamped at $1.0$.
- **SC-04: Poll Outcome Invariant**: Correct poll evaluation on $0.10$ advances confidence to $0.85$ and increments `attempts` by 1. Submitting the identical answer returns the existing evaluation without incrementing `attempts`.

### 4.2 Security & Authorization Scenarios
- **SC-05: Unverified Token Rejection**: Request with forged or unverified JWT receives immediate `401 Unauthorized`.
- **SC-06: Cross-Student Mastery Isolation**: Student A querying `/api/students/:studentBId/mastery` receives `403 Forbidden`.
- **SC-07: Teacher Room Protection**: Student socket attempting to join `professor:<lectureId>` receives `{ success: false, error: "FORBIDDEN" }`.
- **SC-08: Expected Answer Concealment**: Emitted `poll:new-question` event payload does not contain `expectedAnswer` or rubric fields.

### 4.3 Ingestion & Topology Scenarios
- **SC-09: Syllabus Truncation**: Uploading an 11-page PDF returns `totalPages: 11`, `processedPages: 10`, `truncated: true`.
- **SC-10: Cyclic Graph Rejection**: Attempting to commit a cyclic graph (A $\to$ B $\to$ C $\to$ A) returns `422 Unprocessable` and writes zero rows to `concept_nodes`.
- **SC-11: Graph Immutability**: Committing a graph to a course that already has committed nodes returns `409 GRAPH_ALREADY_EXISTS`.

### 4.4 Real-Time & Concurrency Scenarios
- **SC-12: Multi-Tab Attendance Reference Counting**: Student connects two tabs to a lecture. Closing Tab 1 leaves attendance active. Closing Tab 2 terminates attendance tracking after the 30-second grace window.
- **SC-13: Reconnect State Hydration**: Disconnecting and reconnecting client calls `GET /api/lectures/:id/snapshot` and recovers the active poll and recent transcript chunks.
- **SC-14: Atomic Study Group Claiming**: Two concurrent matchmaker workers attempting to pair Student A and Student B with Student C result in exactly one successful match; no student is placed in two active matches.

### 4.5 External Provider & Failure Scenarios
- **SC-15: AI Evaluation Timeout**: When the AI evaluation pipeline exceeds 8 seconds, the response status is saved as `pending_evaluation`, confidence is not mutated, and the teacher receives an evaluation failure notice.
- **SC-16: Live Mode Credential Gate**: In `INTEGRATION_MODE=live`, missing `OPENROUTER_API_KEY` causes `/api/lectures/:id/poll/generate` to return `503 SERVICE_UNAVAILABLE` rather than falling back to fixture data.
- **SC-17: Server-Side Quiz Grading**: Student submits practice quiz answers `[0, 2, 1, 3, 0]`. Server calculates score ($4/5 = 80\%$) and awards $+0.15$ delta. Client-submitted score deltas are ignored.

### 4.6 Spark Progression, Encounter & Habit Scenarios
- **SC-18: Hint Sequencing & Out-of-Sequence Rejection**: Requesting Level 1 hint returns text. Requesting Level 3 directly without Level 2 returns `409 HINT_OUT_OF_SEQUENCE`. Requesting level outside $\{1, 2, 3\}$ returns `400 INVALID_HINT_LEVEL`. Requesting hint after submission returns `409 ENCOUNTER_ALREADY_SUBMITTED`.
- **SC-19: Practice Encounter Scoring & XP Discount**: 5 correct answers with 0 hints awards 150 XP ($5 \times 30$). 5 correct answers with 3 hints each awards 60 XP ($5 \times \max(8, 30 - 18) = 5 \times 12 = 60$). 5 incorrect answers awards 40 XP ($5 \times 8$). Repeating quiz on same concept on the same UTC date awards 0 XP while updating mastery confidence via canonical quiz formulas.
- **SC-20: Daily Quest Clearing & Streak Evaluation**: Clearing all nonempty items in Daily Quest sets `cleared_at`, awards 25 XP, and increments streak. Empty quest clear displays "No review needed", awards 0 XP bonus, and leaves streak untouched.
- **SC-21: Eclipse Review Pressure Calculation**: With 1 target at $c=0.0$, $\text{strength} = 100\%$. With 1 target at $c=0.35$, $\text{strength} = 50\%$. With all targets $\ge 0.70$, $\text{strength} = 0\%$. Empty targets returns 0% with "Clear skies".
- **SC-22: Bilateral Party Quest Completion**: In a 2-student match, student 1 completes all concepts; party quest remains `active` (0 XP). When student 2 completes all concepts, party quest transitions to `completed` and awards 60 XP to each student's `xp_events` ledger.
