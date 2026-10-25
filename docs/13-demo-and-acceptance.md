# Seed Data, Demo Mode & Acceptance Protocols: CS229 Live Demonstration

This document defines the canonical seed dataset, student confidence baseline, comprehensive Demo Mode implementation, runbooks for live video recording, and complete product acceptance protocols.

---

## 1. Canonical CS229 Seed Dataset

The seed curriculum replicates the machine learning foundations course (CS229), comprising **exactly 33 concept nodes** and **34 prerequisite edges**.

### 1.1 Concept Nodes (33 Topics across 9 Categories)
1. **Linear Algebra**: `Vectors` (Diff 1), `Matrices` (Diff 2), `Eigenvalues` (Diff 4), `Matrix Multiplication` (Diff 2)
2. **Calculus**: `Derivatives` (Diff 2), `Partial Derivatives` (Diff 3), `Chain Rule` (Diff 3), `Gradients` (Diff 3)
3. **Probability**: `Bayes' Theorem` (Diff 3), `Distributions` (Diff 2), `Conditional Probability` (Diff 2)
4. **ML Foundations**: `Loss Functions` (Diff 3), `MSE` (Diff 2), `Cross-Entropy` (Diff 4), `Optimization` (Diff 3)
5. **Gradient Descent**: `Gradient Descent` (Diff 3), `Learning Rate` (Diff 2), `Convergence` (Diff 3), `SGD` (Diff 3)
6. **Neural Networks**: `Perceptron` (Diff 2), `Activation Functions` (Diff 3), `Forward Pass` (Diff 2), `Layers` (Diff 2)
7. **Backpropagation**: `Backpropagation` (Diff 4), `Computational Graphs` (Diff 3), `Weight Updates` (Diff 3)
8. **Regularization**: `Overfitting` (Diff 2), `L1 Regularization` (Diff 3), `L2 Regularization` (Diff 3), `Dropout` (Diff 3)
9. **Evaluation**: `Train/Val/Test Split` (Diff 1), `Cross-Validation` (Diff 3), `Bias-Variance Tradeoff` (Diff 4)

### 1.2 Prerequisite Edges (34 Directed Edges: Prerequisite $\to$ Dependent)
```text
Vectors -> Matrices
Matrices -> Matrix Multiplication
Matrices -> Eigenvalues
Derivatives -> Partial Derivatives
Partial Derivatives -> Gradients
Derivatives -> Chain Rule
Chain Rule -> Backpropagation
Gradients -> Gradient Descent
Conditional Probability -> Bayes' Theorem
Distributions -> Conditional Probability
Loss Functions -> MSE
Loss Functions -> Cross-Entropy
Loss Functions -> Optimization
Optimization -> Gradient Descent
Gradient Descent -> Learning Rate
Gradient Descent -> Convergence
Gradient Descent -> SGD
Perceptron -> Activation Functions
Perceptron -> Layers
Activation Functions -> Forward Pass
Layers -> Forward Pass
Forward Pass -> Backpropagation
Backpropagation -> Computational Graphs
Backpropagation -> Weight Updates
Weight Updates -> Gradient Descent
Overfitting -> L1 Regularization
Overfitting -> L2 Regularization
Overfitting -> Dropout
Train/Val/Test Split -> Cross-Validation
Cross-Validation -> Bias-Variance Tradeoff
Gradients -> Backpropagation
Matrix Multiplication -> Forward Pass
Distributions -> Loss Functions
Bayes' Theorem -> Cross-Entropy
```

---

## 2. Seed Personas & Baseline Mastery Matrix

The seed script creates **1 teacher** and **4 enrolled students**, producing exactly $4 \times 33 = \mathbf{132}$ initial `student_mastery` rows.

### 2.1 Demo Accounts (All use password: `DemoPass123!`)
- **Teacher**: Prof. Sarah Chen (`sarah.chen@example.test`)
- **Student 1 (Hari)**: `hari@example.test` (High mastery profile / Peer tutor)
- **Student 2 (Rahul)**: `rahul@example.test` (Struggling profile / Peer tutee)
- **Student 3 (Praj)**: `praj@example.test` (Developing profile)
- **Student 4 (Vamshi)**: `vamshi@example.test` (Unassessed / Fresh profile)

### 2.2 Baseline Confidence Matrix (Complete 132-Row Specification)
All 33 concepts default to student base levels before 6 specific foundational overrides:
- Default: Hari 0.81, Rahul 0.40, Praj 0.65, Vamshi 0.00

| Concept | Hari | Rahul | Praj | Vamshi |
|---|---|---|---|---|
| **Default (27 topics)** | 0.81 (`green`) | 0.40 (`yellow`) | 0.65 (`yellow`) | 0.00 (`gray`) |
| **Matrices** | 0.84 (`green`) | 0.39 (`red`) | 0.80 (`green`) | 0.00 (`gray`) |
| **Vectors** | 0.95 (`green`) | 0.45 (`yellow`) | 0.80 (`green`) | 0.00 (`gray`) |
| **Derivatives** | 0.90 (`green`) | 0.35 (`red`) | 0.75 (`green`) | 0.00 (`gray`) |
| **Gradients** | 0.85 (`green`) | 0.20 (`red`) | 0.65 (`yellow`) | 0.00 (`gray`) |
| **Gradient Descent**| 0.85 (`green`) | 0.20 (`red`) | 0.50 (`yellow`) | 0.00 (`gray`) |
| **Backpropagation** | 0.80 (`green`) | 0.15 (`red`) | 0.40 (`yellow`) | 0.00 (`gray`) |

*Mean Confidence*: Hari = 0.82 (`nova`), Rahul = 0.38 (`spark`), Praj = 0.65 (`glow`), Vamshi = 0.00 (`ember`).

*Complementary Match Check*: Hari ($0.80$) and Rahul ($0.15$) on Backpropagation have gap $|0.80 - 0.15| = 0.65 \ge 0.30$, making them an ideal complementary study pair.

### 2.3 Baseline Game Progression & Effort Seed State
| Persona | Baseline XP | Streak | Sky Brightness | Mascot Form | Intervention Flag |
|---|---|---|---|---|---|
| **Hari** | 620 | 4 Days | 0.82 | `nova` | None |
| **Rahul** | 508 | 3 Days | 0.38 | `spark` | None (XP percentile = 67 < 75) |
| **Praj** | 320 | 2 Days | 0.65 | `glow` | None |
| **Vamshi** | 0 | 0 Days | 0.00 | `ember` | None (Unassessed) |

*Rahul Daily Quest Seed*: 3 ready concepts selected by the DAG scheduler: "Derivatives" (unreviewed root, $c=0.35$), "Distributions" (overdue at D-4, $c=0.40$), "Perceptron" (current at D-1, $c=0.40$). Backpropagation is NOT ready in canonical baseline because its prerequisites (Gradients=0.20) are not mastered ($< 0.70$).

---

## 3. Demo Mode Implementation & Local Runbook

Demo Mode is a dedicated, production-isolated operational mode designed for high-stakes live demonstrations, hackathon presentations, and video recording. It eliminates presenter friction (such as switching tabs to type passwords or waiting for 5-minute matchmaking windows) while executing the authentic application stack.

### 3.1 Local Prerequisites & Execution Order
Before running demo commands or browser tests:
1. **Node.js**: Version >= 24 (verified on v26.12.1).
2. **Local Supabase / PostgreSQL**: Running via Docker container `supabase_db_HackOHIO-2026` at `http://127.0.0.1:54321`.
3. **Database Migrations Applied**: All 13 migrations must exist in the database (verified through `20261024040001_party_quest_lifecycle.sql`).
   > *Note on `npm run db:migrate`*: The script entry in `package.json` points at `scripts/migrate.ts` which is not present. Do not run `npm run db:migrate`. If migrations are absent on a new workstation, route migration execution to Lane A.
4. **Environment Variables**: Configure `.env` with nonsecret local values:
   ```env
   NODE_ENV=development
   INTEGRATION_MODE=fixture
   LECTURE_SOURCE=simulator
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   SUPABASE_DB_CONTAINER=supabase_db_HackOHIO-2026
   CREDENTIAL_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   PORT=3000
   APP_ORIGIN=http://localhost:3000
   DEMO_MODE=false
   DEMO_AUTO_RESPOND=false
   ```
5. **Preflight Verification**: Run `npm run doctor` to confirm port availability, database reachability, and key configurations.

### 3.2 Finite API Smoke vs. Full Browser Journeys
Running `npm run demo -- --mode=fixture --seed=42` executes a **finite API smoke check**:
- Seeds the 33-concept, 34-edge curriculum.
- Verifies 5 persona logins and game progression baselines.
- Tests one simulated speech step, poll response submission, response idempotency, instant matchmaking, and sub-100ms reset.
- Exits cleanly with JSON summary.

**What `npm run demo` DOES NOT prove**:
- Does not render browser DOM, React component lifecycles, or Next.js routing.
- Does not exercise D3 force simulations or responsive wide/mobile grid breakpoints.
- Does not run automated WCAG 2.1 AA accessibility scans.
- Does not exercise live OpenRouter models or live Zoom OAuth/RTMS endpoints.
- Does not verify hosted deployment persistence across infrastructure restarts.

Full-product behavioral acceptance requires running the end-to-end journey suites (`j01-to-j08.spec.ts`, `j09-to-j11.spec.ts`) and accessibility audit suite (`a11y-audit.spec.ts`).

### 3.3 Fixture Provenance & Authenticity Boundaries
When operating in `INTEGRATION_MODE=fixture`:
- **Simulated Speech**: Transcript chunks are emitted by an offline simulator loaded from `src/server/classroom/simulator.ts` and test fixtures.
- **Fixture AI**: Prerequisite extraction, poll synthesis, poll evaluation, and Socratic hints are generated by deterministic local fixture generators (`src/server/ai/fixtures/`).
- **Fixture Zoom Meeting**: J07 and demo matchmaking register mock Zoom meeting ID `9876543210` with join URL `https://zoom.us/j/9876543210`. This is a fixture placeholder, not an authentic Zoom video room. Authentic Zoom operations require `INTEGRATION_MODE=live` with valid OAuth credentials.

### 3.4 UI Demo Toolbar (`DemoToolbar`)
Mounted in `src/components/demo/demo-toolbar.tsx` when `DEMO_MODE=true`:
- **Instant Persona Switcher**:
  - `[Prof. Chen]` button: Switches active session to Sarah Chen and redirects to `/professor/dashboard`.
  - `[Hari]` button: Switches session to Hari and redirects to `/student/[hariId]`.
  - `[Rahul]` button: Switches session to Rahul and redirects to `/student/[rahulId]`.
- **Lecture Stream Controller**:
  - `[Play / Pause]`: Starts/stops simulated lecture speech chunks.
  - `[Step Chunk]`: Manually emits the next scripted transcript chunk.
  - `[Speed: 1x / 2x / 5x]`: Accelerates speech chunk frequency.
- **Poll Simulation Trigger**:
  - `[Auto-Submit Responses]`: Injects pre-scripted responses for Hari and Rahul.
- **Fast-Forward Peer Matchmaker**:
  - `[Instant Match]`: Immediately matches Rahul and Hari for "Backpropagation".

### 3.5 Instant Reset & Rehearsal (`npm run demo:reset`)
Between demo takes or video rehearsals, running `npm run demo:reset` wipes demo state and restores baseline data in under 2 seconds (measured: 65–75ms):
```bash
npm run demo:reset
```
What it executes in a single SQL transaction:
1. Truncates transient lecture sessions, transcript chunks, polls, and messages created during the demo.
2. Resets `student_mastery` back to the exact baseline confidence matrix (Hari at $0.80$, Rahul at $0.15$ on Backpropagation).
3. Clears active study group pool entries and matches.
4. Restores CS229 course join code to `CS229-8F`.
5. Invalidates cached Class Sky heatmap snapshots.

---

## 4. Video Recording Runbook & Storyboard (3 to 5 Minutes)

### Screen Layout Recommendation
- **Option A (Dual Window Split)**:
  - Left Half (50% screen): Chrome window logged in as **Prof. Sarah Chen** (`/professor/dashboard`).
  - Right Half (50% screen): Chrome window logged in as **Rahul** (`/student/[rahulId]`).
- **Option B (Single Window with Demo Toolbar)**:
  - Record full 1080p browser window; use the Demo Toolbar persona buttons to switch perspectives smoothly.

### Scene-by-Scene Script

#### Scene 1: The Disconnect & Prerequisite Graph (0:00 – 1:00)
- **Visual**: Start on `/professor/upload`.
- **Narration**: *"In technical courses like machine learning, students struggle when foundational prerequisites are shaky. Instructors have no real-time visibility into confusion until it's too late. Spark bridges this gap."*
- **Action**:
  1. Upload syllabus PDF (`main_notes.pdf`).
  2. Show the instant extraction preview: 33 concepts, 34 edges, with clear notice that the first 10 pages were processed.
  3. Click "Confirm Graph".
  4. Switch view to **Rahul** (`/student/[rahulId]`): Show the interactive D3 knowledge graph. Click on "Backpropagation" to highlight its true prerequisite ancestors (**Chain Rule**, **Derivatives**, **Gradients**). Note that **Computational Graphs** is an outgoing dependent of Backpropagation in the canonical graph. Show that Rahul is struggling with red confidence ($0.15$).

#### Scene 2: Live Lecture & Real-Time Concept Detection (1:00 – 2:00)
- **Visual**: Side-by-side view (Prof. Chen left, Rahul right).
- **Action**:
  1. Prof. Chen clicks "Start Lecture: Backpropagation Foundations".
  2. Rahul's screen immediately displays the active lecture feed connection.
  3. Start the speech stream: Transcript chunks appear in real time on the teacher's dashboard.
  4. Ingest chunk mentioning gradients and chain rule: The "Backpropagation" and "Chain Rule" nodes on Rahul's graph pulse with illuminated active amber rings.

#### Scene 3: Formative Socratic Polls & AI Interventions (2:00 – 3:15)
- **Visual**: Prof. Chen generates poll; Rahul responds.
- **Action**:
  1. Prof. Chen clicks "Generate Poll". Claude synthesizes an open-ended question based on the lecture speech.
  2. Prof. Chen clicks "Activate Poll".
  3. A modal pops up on Rahul's screen with trapped keyboard focus.
  4. Rahul submits misconception answer: *"To make inference faster."*
  5. Hari's answer is auto-submitted: *"For computing gradients via the chain rule."*
  6. Server evaluates instantly: Rahul receives private red card with constructive feedback; Hari's node turns green.
  7. On Prof. Chen's dashboard, the class heatmap updates showing the confusion cluster.
  8. Prof. Chen clicks "Suggest Interventions": Claude analyzes the error patterns and gives two specific pedagogical actions to explain intermediate activation storage.

#### Scene 4: Socratic Tutoring & Practice Quizzes (3:15 – 4:00)
- **Visual**: Rahul opens `/student/[rahulId]/tutor`.
- **Action**:
  1. Rahul selects Backpropagation in the concept radio group.
  2. Rahul asks: *"Why do we need activations for backprop?"*
  3. Claude responds Socratically, asking Rahul about the derivative of $x^2$.
  4. Rahul replies correctly: *"Oh, the gradient depends on the value of $x$ at that point!"*
  5. Tutor recognizes breakthrough: Rahul's confidence advances $+0.20$ within the red / Dim band ($0.15 \to 0.35$).
  6. Rahul opens the generated concept learning page and completes a 5-question practice quiz ($4/5 \to +0.15$ delta), advancing confidence to $0.50$ in the yellow / Developing band.

#### Scene 5: Consensual Peer Matching & Zoom Scheduling (4:00 – 5:00)
- **Visual**: Rahul and Hari peer collaboration.
- **Action**:
  1. Rahul opts into the peer study pool for "Backpropagation".
  2. Switch to **Hari**: Hari opts into the pool.
  3. The system calculates complementary knowledge gap ($|0.80 - 0.15| = 0.65 \ge 0.30$) and matches them.
  4. Both screens open the peer chat view and exchange a real-time message over Socket.IO.
  5. System detects mutual 30-minute availability tomorrow at 15:00 UTC.
  6. Rahul clicks "Accept proposed time"; Hari clicks "Accept proposed time".
  7. The system registers the confirmed meeting and renders the Zoom join link.

#### Scene 6: Isolated J09 Rehearsal (Daily Quests, 3-Tier Hints & Streak Advancement)
To rehearse or record Scene 6 independently with deterministic outcomes, execute the headed Playwright scenario:
```bash
npx playwright test tests/e2e/j09-to-j11.spec.ts --project=chromium --grep "J09:" --headed
```
- **Scenario Structure (`setupJ09Scenario`)**:
  - Uses an isolated 3-root DAG: `Backpropagation`, `Derivatives`, and `Computational Graphs`, each initialized with Rahul at $0.20$ confidence.
  - The DAG scheduler orders ready concepts by UUID ascending; Rahul's daily queue loads these 3 items.
- **Encounter Execution**:
  1. Rahul launches the practice encounter for the first UUID-ordered ready concept.
  2. The slide-over `EncounterDrawer` opens with keyboard focus trapped on the close button.
  3. Question 1: Rahul unlocks Hint 1 (Nudge), then Hint 2 (Approach), and selects the correct option $\to$ earns **18 XP** (30 base - 12 hint discount).
  4. Questions 2–4: Rahul answers correctly without hints $\to$ earns **90 XP** (30 each).
  5. Question 5: Rahul unlocks all 3 hints and answers incorrectly $\to$ earns **8 XP** (20 incorrect baseline - 12 hint discount).
  6. Total Encounter XP: $18 + 90 + 8 = \mathbf{116\text{ XP}}$.
  7. Rahul completes the remaining two concepts with perfect scores $\to$ earns $2 \times 150 = \mathbf{300\text{ XP}}$.
  8. Clearing all daily quests awards the $+25\text{ XP}$ Daily Clear Bonus $\to$ total daily gain is $\mathbf{441\text{ XP}}$.
  9. Rahul's streak advances from **2 to 3 days**.
  > *Note on canonical baseline vs. J09 scenario*: Untouched CS229 baseline has Rahul at 508 XP with a 3-day streak and a different queue of ready concepts (Derivatives, Distributions, Perceptron). J09 executes in its dedicated test course to isolate hint progression and streak increments.

#### Special States in J10 and J11 (`setupJ10Scenario`, `setupJ11Scenario`)
- **J10 (Eclipse Review Diagnostic & Mascot Evolution)**:
  - Uses `setupJ10Scenario` to arrange an upcoming exam date ($D+10$), 39% decay pressure, and `glow` mascot form.
  - Completing review encounters clears the eclipse, returning sky brightness to clear and evolving Mascot Spark to `nova`.
- **J11 (Collaborative Party Quests & Class Sky Effort)**:
  - Uses `setupJ11Scenario` to seed historical practice on $D-5$, ensuring Rahul's effort score triggers the `high_effort_low_mastery` badge on Prof. Chen's roster.
  - Requires bilateral participation: both peers must complete their encounters before the $60\text{ XP}$ party bonus is disbursed.

---

## 5. End-to-End Acceptance Matrix (J01 – J11 & Accessibility Audits)

| ID | Suite / Surface | Spec File | Persona(s) | Observed Multi-Browser Results | Fixture vs. Live/Hosted Provenance |
|---|---|---|---|---|---|
| **J01** | Syllabus Ingestion & Graph Generation | `tests/e2e/j01-to-j08.spec.ts` | Prof. Chen | **Chromium**: Passed (32.9s)<br>**WebKit**: Passed (36.2s)<br>**Firefox**: OS-blocked (TCC) | Fixture AI heuristic parsing; 10-page truncation alert; 33 nodes / 34 edges committed. |
| **J02** | Student Join Code Enrollment & Star Graph | `tests/e2e/j01-to-j08.spec.ts` | Hari | **Chromium**: Passed (3.4s)<br>**WebKit**: Passed (4.5s)<br>**Firefox**: OS-blocked (TCC) | Real PostgreSQL enrollment RPC; 33 gray nodes; ancestor path lighting. |
| **J03** | Live Lecture & Real-Time Attendance | `tests/e2e/j01-to-j08.spec.ts` | Hari, Rahul, Prof. Chen | **Chromium**: Passed (4.4s)<br>**WebKit**: Passed (5.8s)<br>**Firefox**: OS-blocked (TCC) | Simulated speech streaming; Socket.IO chunk broadcast; attendance confidence cap $\le 0.30$. |
| **J04** | Formative Poll Generation & Evaluation | `tests/e2e/j01-to-j08.spec.ts` | Hari, Rahul, Prof. Chen | **Chromium**: Passed (5.0s)<br>**WebKit**: Passed (5.7s)<br>**Firefox**: OS-blocked (TCC) | Fixture poll generation; Socratic evaluation; atomic mastery updates; heatmap refresh. |
| **J05** | Pedagogical Interventions & Summary | `tests/e2e/j01-to-j08.spec.ts` | Prof. Chen, Hari | **Chromium**: Passed (4.6s)<br>**WebKit**: Passed (5.2s)<br>**Firefox**: OS-blocked (TCC) | Fixture misconception clustering; 2 actionable teaching prompts; summary persistence across reload. |
| **J06** | Socratic Tutoring, Guides & Citations | `tests/e2e/j01-to-j08.spec.ts` | Rahul | **Chromium**: Passed (8.4s)<br>**WebKit**: Passed (9.1s)<br>**Firefox**: OS-blocked (TCC) | Multi-turn dialogue; understanding breakthrough $+0.20$; server quiz grading; academic citation links. |
| **J07** | Consensual Peer Matching & Scheduling | `tests/e2e/j01-to-j08.spec.ts` | Hari, Rahul | **Chromium**: Passed (9.6s)<br>**WebKit**: Passed (10.4s)<br>**Firefox**: OS-blocked (TCC) | Mutual concept opt-in; gap $\ge 0.30$; private socket chat; mutual slot agreement; **fixture Zoom ID `9876543210`**. |
| **J08** | Platform Resilience & Restart Recovery | `tests/e2e/j01-to-j08.spec.ts` | Administrator | **Chromium**: Passed (3.2s)<br>**WebKit**: Passed (3.8s)<br>**Firefox**: OS-blocked (TCC) | Preflight `doctor` probe; standalone child process restart; state recovery verified locally. |
| **J09** | Daily Review Quest, Hints & Streak | `tests/e2e/j09-to-j11.spec.ts` | Rahul | **Chromium**: Passed (4.5s)<br>**WebKit**: Passed (5.2s)<br>**Firefox**: OS-blocked (TCC) | 3-item daily queue; 3-tier progressive hints; XP hint discount (116 XP); streak advances 2 to 3. |
| **J10** | Eclipse Review Diagnostic & Mascot | `tests/e2e/j09-to-j11.spec.ts` | Hari, Spark | **Chromium**: Passed (3.8s)<br>**WebKit**: Passed (4.4s)<br>**Firefox**: OS-blocked (TCC) | 39% decay pressure; 10-day exam countdown; mascot evolution (Ember $\to$ Nova) upon mastery. |
| **J11** | Party Quest & Class Sky Visibility | `tests/e2e/j09-to-j11.spec.ts` | Hari, Rahul, Prof. Chen | **Chromium**: Passed (4.4s)<br>**WebKit**: Passed (4.9s)<br>**Firefox**: OS-blocked (TCC) | Bilateral encounter completion; 60 XP each; Class Sky mean stars; `high_effort_low_mastery` badge. |
| **A11Y**| Responsive Layout & WCAG 2.1 AA Audit | `tests/e2e/a11y-audit.spec.ts` | All Personas | **Chromium**: 16/16 Passed<br>**WebKit**: 16/16 Passed<br>**Firefox**: OS-blocked (TCC) | 12 application surfaces at 400px and 1360px under `no-preference` and `reduce`; zero axe violations; focus traps and skip links verified. |

---

## 6. Measured Final Checkpoint Record

- **Audit Date**: 2026-10-25
- **Git Commit**: `3563841ad56123edb06c6c6efb449d3c0a179915` (Branch: `test/lane-d-p7-d-02-a11y-audit`, PR #164)
- **Runtime Environment**:
  - OS: Darwin 27.0.0 (macOS Sequoia 15.x / Apple Silicon arm64)
  - Node.js: `v26.12.1`
  - Playwright: `1.64.1`
  - Browsers: Chromium 134.0.6998.35, WebKit 18.4, Firefox Nightly 136.0a1
  - PostgreSQL Container: `supabase_db_HackOHIO-2026` (Local Supabase v1.200.3)
- **Interactive Visual Artifacts Captured**:
  - `docs/artifacts/class-sky.png`: Class Sky analytics, 33-star mean confidence graph, and effort roster.
  - `docs/artifacts/student-workspace-1360.png`: 3-rail desktop workspace (Companion rail, D3 graph, live stream).
  - `docs/artifacts/student-workspace-400-quests.png`: 400px mobile segmented view displaying daily quest panel.
  - `docs/artifacts/encounter-hint-drawer.png`: Slide-over practice encounter drawer with unlocked progressive hints.

### 6.1 Checkpoint Verification Outputs

#### Preflight Diagnostic (`npm run doctor`)
```text
> spark@0.1.0 doctor
> tsx scripts/doctor.ts

[doctor] Node.js version v26.12.1 OK
[doctor] Server configuration (NODE_ENV: development, PORT: 3000, APP_ORIGIN: http://localhost:3000) OK
[doctor] Credential encryption key OK
[doctor] Supabase configuration OK
[doctor] AI configuration (mode: fixture) OK
[doctor] Speech source configuration (source: simulator) OK
[doctor] Port 3000 availability probe OK
[doctor] Supabase auth and REST reachability probes OK
[doctor] All checks passed successfully.
```

#### Codebase Integrity Check (`npm run check`)
```text
> spark@0.1.0 check
> npm run typecheck && npm run lint && npm test && npm run test:contracts

> spark@0.1.0 typecheck
> tsc --noEmit (Exit code: 0)

> spark@0.1.0 lint
> eslint . (Exit code: 0)

> spark@0.1.0 test
> vitest run
 Test Files  100 passed | 8 skipped (108)
      Tests  1392 passed | 45 skipped (1437)
   Duration  9.01s

> spark@0.1.0 test:contracts
> vitest run tests/contracts
 Test Files  8 passed (8)
      Tests  151 passed (151)
   Duration  456ms
```

#### Demo Mode Finite Smoke (`npm run demo -- --mode=fixture --seed=42`)
```json
{
  "status": "ok",
  "mode": "fixture",
  "seed": 42,
  "assertions": {
    "personasVerified": 5,
    "concepts": 33,
    "edges": 34,
    "students": 4,
    "masteryRows": 132,
    "gameBaselines": true,
    "speechStep": true,
    "pollResponses": [
      "hari",
      "rahul"
    ],
    "instantMatchId": "7ff44b3c-349b-46cd-abd2-0a6716db126b",
    "resetDurationMs": 74
  }
}
```

#### Accessibility & Responsive Audit (`npx playwright test tests/e2e/a11y-audit.spec.ts --project=chromium --project=webkit`)
```text
Running 32 tests using 1 worker
  32 passed (3.6m)
```
- **Violations**: 0 across all 32 test runs.
- **Surfaces Evaluated**: 12 surfaces at 400px and 1360px viewports with `no-preference` and `reduce` motion settings.
- **Overflow Checks**: Document `scrollWidth <= clientWidth + 1` asserted and passed on all pages and drawers.

#### User Journey Suites (J01 – J11)
```text
$ npx playwright test tests/e2e/j01-to-j08.spec.ts --project=chromium --project=webkit
  16 passed (3.5m)

$ npx playwright test tests/e2e/j09-to-j11.spec.ts --project=chromium --project=webkit
  6 passed (27.2s)
```

---

## 7. Product Acceptance Disposition & Hard Architectural Gates

Autonomous verification evaluates all four engineering gates truthfully based on observed runtime execution:

### 7.1 Category Dispositions

1. **Fixture-Mode Acceptance**: **ACCEPTED**
   - All 11 user journeys (J01–J11) pass completely in Chromium and WebKit with zero failures and zero skipped tests.
   - All 12 primary application surfaces satisfy WCAG 2.1 AA accessibility scans with zero axe violations.
   - Responsive layout verified at 400px (mobile segmented rails) and 1360px (three simultaneous columns).
   - Reduced motion stability confirmed: D3 simulation bypassed, deterministic level coordinates verified ($y=0$ for Vectors, $y=120$ for Matrices), steady active overlay rings, and ambient mascot animations suppressed.
   - *Firefox Status*: Blocked at OS level on macOS Darwin 27.0.0 due to macOS Sequoia TCC sandbox protections (`~/Library/Application Support/Firefox: Operation not permitted`). Chromium and WebKit provide multi-engine browser proof.

2. **Live OpenRouter Integration**: **PENDING LIVE CREDENTIALS (SKIPPED)**
   - Offline fallback and credential guard verified: when `INTEGRATION_MODE=live` without credentials, system cleanly rejects with 503 SERVICE_UNAVAILABLE (GATE 6).
   - Authentic live OpenRouter execution was skipped because `OPENROUTER_API_KEY` was not configured in the host environment.

3. **Live Zoom / RTMS Integration**: **PENDING LIVE CREDENTIALS (SKIPPED)**
   - Offline HMAC signature verification and credential guard verified (`tests/integration/lane-b/zoom-live.test.ts`: 7 passed, 246 skipped).
   - Authentic provider meeting creation and signed WebSocket audio ingestion were skipped because live Zoom OAuth credentials (`ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, etc.) were not configured.

4. **Hosted Deployment & Persistence**: **PENDING HOSTED INFRASTRUCTURE (BLOCKED)**
   - Local persistence and restart resilience verified via owned-server restart tests in J08.
   - Remote hosted HTTPS/WSS verification is blocked because no external deployment URL (`DEPLOYMENT_URL`) or hosting environment was authorized or supplied.

### 7.2 Final Product Acceptance Verdict
> **VERDICT: PARTIALLY ACCEPTED (FIXTURE & UI COMPLETE; LIVE & HOSTED GATES PENDING CREDENTIALS)**
> In strict accordance with GATE 6 ("No Fake Live Integrations") and repository engineering standards, fixture acceptance is 100% verified and complete. Live third-party provider acceptance and hosted deployment persistence remain pending configuration of authentic production credentials and hosted infrastructure.
