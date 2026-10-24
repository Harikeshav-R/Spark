# Seed Data, Demo Mode & Acceptance Protocols: CS229 Live Demonstration

This document defines the canonical seed dataset, student confidence baseline, comprehensive Demo Mode implementation, and runbooks for live video recording and feature validation.

---

## 1. Canonical CS229 Seed Dataset

The seed curriculum replicates the machine learning foundations course (CS229), comprising **exactly 33 concept nodes** and **34 prerequisite edges**.

### 1.1 Concept Nodes (33 Topics across 8 Categories)
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

### 2.2 Baseline Confidence Matrix (Selected Core Concepts)
| Concept | Hari | Rahul | Praj | Vamshi |
|---|---|---|---|---|
| **Vectors** | 0.95 (`green`) | 0.45 (`yellow`) | 0.80 (`green`) | 0.00 (`gray`) |
| **Derivatives** | 0.90 (`green`) | 0.35 (`red`) | 0.75 (`green`) | 0.00 (`gray`) |
| **Gradients** | 0.85 (`green`) | 0.20 (`red`) | 0.65 (`yellow`) | 0.00 (`gray`) |
| **Gradient Descent**| 0.85 (`green`) | 0.20 (`red`) | 0.50 (`yellow`) | 0.00 (`gray`) |
| **Backpropagation** | 0.80 (`green`) | 0.15 (`red`) | 0.40 (`yellow`) | 0.00 (`gray`) |

*Complementary Match Check*: Hari ($0.80$) and Rahul ($0.15$) on Backpropagation have gap $|0.80 - 0.15| = 0.65 \ge 0.30$, making them an ideal complementary study pair.


### 2.3 Baseline Game Progression & Effort Seed State
| Persona | Baseline XP | Streak | Sky Brightness | Mascot Form | Intervention Flag |
|---|---|---|---|---|---|
| **Hari** | 620 | 4 Days | 0.82 | `nova` | None |
| **Rahul** | 508 | 3 Days | 0.38 | `spark` | `high_effort_low_mastery` |
| **Praj** | 320 | 2 Days | 0.65 | `glow` | None |
| **Vamshi** | 0 | 0 Days | 0.00 | `ember` | None (Unassessed) |

*Rahul Daily Quest Seed*: 3 ready concepts: "Backpropagation" (overdue), "Derivatives" (unreviewed), "Computational Graphs" (current).
---

## 3. Demo Mode Implementation Architecture

Demo Mode is a dedicated, production-isolated operational mode designed for high-stakes live demonstrations, hackathon presentations, and video recording. It eliminates presenter friction (such as switching tabs to type passwords or waiting for 5-minute matchmaking windows) while executing the authentic application stack.

### 3.1 Enabling Demo Mode
Demo Mode is enabled via environment variable or CLI flag:
```bash
# In .env.local or runtime environment
DEMO_MODE=true
DEMO_AUTO_RESPOND=true
DEMO_TICK_RATE_MS=4000
```
When `DEMO_MODE=true`:
1. The server exposes privileged demo helper endpoints under `/api/demo/*` (restricted to non-production environments).
2. The frontend mounts a floating `DemoToolbar` at the top of the viewport.
3. Matchmaking pool expiration and speech ticker speeds can be accelerated on demand.

### 3.2 UI Demo Toolbar (`DemoToolbar`)
Mounted in `src/components/demo/demo-toolbar.tsx`, the toolbar provides floating quick-actions:
- **Instant Persona Switcher**:
  - `[Prof. Chen]` button: Immediately switches active JWT session to Sarah Chen and redirects to `/professor/dashboard`.
  - `[Hari]` button: Immediately switches session to Hari and redirects to `/student/[hariId]`.
  - `[Rahul]` button: Immediately switches session to Rahul and redirects to `/student/[rahulId]`.
  - *No password typing or manual logout/login required during a live talk or recording.*
- **Lecture Stream Controller**:
  - `[Play / Pause]`: Starts/stops simulated lecture speech chunks.
  - `[Step Chunk]`: Manually emits the next scripted transcript chunk on demand.
  - `[Speed: 1x / 2x / 5x]`: Accelerates speech chunk frequency.
- **Poll Simulation Trigger**:
  - `[Auto-Submit Responses]`: When the teacher activates a poll, clicking this button injects pre-scripted responses for Hari and Rahul:
    - Hari submits: `"The chain rule requires intermediate activations computed during the forward pass to evaluate the local gradients for parameter updates."` (Evaluates `correct` $\to$ green).
    - Rahul submits: `"To make the network run faster during inference."` (Evaluates `wrong` $\to$ red).
- **Fast-Forward Peer Matchmaker**:
  - `[Instant Match]`: Immediately matches Rahul and Hari for "Backpropagation", skipping the 5-minute pool waiting timeout and creating the match with pre-computed availability.

### 3.3 Instant Reset & Rehearsal (`npm run demo:reset`)
Between demo takes or video rehearsals, running `npm run demo:reset` wipes demo state and restores baseline data in under 2 seconds:
```bash
npm run demo:reset
```
What it executes:
1. Truncates transient lecture sessions, transcript chunks, polls, and messages created during the demo.
2. Resets `student_mastery` back to the exact baseline confidence matrix (Hari at $0.80$, Rahul at $0.15$ on Backpropagation).
3. Clears active study group pool entries and matches.
4. Restores CS229 course join code to `CS229-8F`.

---

## 4. Video Recording Runbook & Storyboard (3 to 5 Minutes)

Use this step-by-step storyboard for recording a demo video or delivering a presentation.

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
  4. Switch view to **Rahul** (`/student/[rahulId]`): Show the interactive D3 knowledge graph. Click on "Backpropagation" to highlight its prerequisite ancestors ("Chain Rule", "Computational Graphs"). Show that Rahul is struggling with red confidence ($0.15$).

#### Scene 2: Live Lecture & Real-Time Concept Detection (1:00 – 2:00)
- **Visual**: Side-by-side view (Prof. Chen left, Rahul right).
- **Action**:
  1. Prof. Chen clicks "Start Lecture: Backpropagation & Computational Graphs".
  2. Rahul's screen immediately displays the active lecture banner.
  3. Start the speech stream: Transcript chunks appear in real time on the teacher's dashboard.
  4. Ingest chunk mentioning computational graphs and chain rule: Point out that the "Backpropagation" and "Chain Rule" nodes on Rahul's graph pulse with an illuminated amber ring.
- **Narration**: *"As the professor lectures, real-time speech streaming analyzes the transcript and highlights active concepts directly on students' personal knowledge graphs."*

#### Scene 3: Formative Socratic Polls & AI Interventions (2:00 – 3:15)
- **Visual**: Prof. Chen generates poll; Rahul responds.
- **Action**:
  1. Prof. Chen clicks "Generate Poll". Claude synthesizes an open-ended question based on the last 2 minutes of speech.
  2. Prof. Chen clicks "Activate Poll".
  3. A modal pops up on Rahul's screen.
  4. Rahul submits misconception answer: *"To make inference faster."*
  5. Hari's answer is auto-submitted: *"For computing gradients via the chain rule."*
  6. Server evaluates instantly: Rahul receives private red card with constructive feedback; Hari's node turns green.
  7. On Prof. Chen's dashboard, the class heatmap updates showing the confusion cluster.
  8. Prof. Chen clicks "Suggest Interventions": Claude analyzes the error patterns and gives two specific pedagogical actions to explain intermediate activation storage.
- **Narration**: *"No multiple-choice guessing. Formative checks are open-ended, server-graded with Socratic rubrics, and immediately inform instructor teaching."*

#### Scene 4: Socratic Tutoring & Practice Quizzes (3:15 – 4:00)
- **Visual**: Rahul opens `/student/[rahulId]/tutor`.
- **Action**:
  1. Rahul clicks "Ask Tutor" on Backpropagation.
  2. Rahul asks: *"Why do we need activations for backprop?"*
  3. Claude responds Socratically, asking Rahul about the derivative of $x^2$.
  4. Rahul replies correctly: *"Oh, the gradient depends on the value of $x$ at that point!"*
  5. Tutor recognizes breakthrough: Rahul's confidence advances $+0.20$ within the red / Dim band ($0.15 \to 0.35$).
  6. Rahul opens the generated concept learning page and completes a 5-question practice quiz ($4/5 \to +0.15$ delta), advancing confidence to $0.50$ in the yellow / Developing band.

#### Scene 5: Consensual Peer Matching & Authentic Zoom Meeting (4:00 – 5:00)
- **Visual**: Rahul and Hari peer collaboration.
- **Action**:
  1. Rahul opts into the peer study pool for "Backpropagation".
  2. Switch to **Hari**: Hari opts into the pool.
  3. The system calculates complementary knowledge gap ($|0.80 - 0.15| = 0.65 \ge 0.30$) and matches them.
  4. Both screens open the peer view and exchange a real-time message.
  5. System detects mutual 30-minute availability tomorrow at 15:00 UTC.
  6. Rahul clicks "Accept"; Hari clicks "Accept".
  7. The system connects to Zoom OAuth and generates a genuine Zoom meeting with an authentic join URL.
- **Narration**: *"Consensual, complementary peer learning with authentic Zoom integration. Students who know the material teach students who need help, scheduled frictionlessly."*

---

## 5. Automated Headless Demo (`npm run demo:record`)

For generating video files without manual screen recording:
```bash
# Runs Playwright in headed or headless mode with video capture enabled
npm run demo:record
```
- Produces a timestamped video file in `recordings/demo-walkthrough.webm` (1080p, 60fps) with automated mouse cursors, typing animations, and timed scene transitions.

#### Scene 6: Spark Mascot, Daily Quests & Collaborative Party Goals (5:00 – 6:00)
- **Visual**: Rahul dashboard with Spark mascot, Encounter drawer, and collaborative party quest.
- **Action**:
  1. Rahul views summary pill: 508 XP, 3-day streak, Mascot Spark in `think` mood.
  2. Rahul clicks "Daily Quest": launches Encounter for Backpropagation.
  3. Rahul requests Hint 1 (Nudge), then Hint 2 (Bigger hint); submits 5 answers.
  4. Encounter feedback card awards 88 XP (discounted by hints), updates confidence, and triggers Mascot Spark bounce hop into `cheer` mood.
  5. Rahul completes quest; receives +25 XP Daily Bonus; streak increments to 4.
  6. Switch to **Prof. Chen**: Prof. Chen opens Class Sky on `/professor/dashboard`.
  7. Class Sky displays concept stars colored by class mean confidence with attention rings on taught concepts below 0.40.
  8. Roster highlights Rahul with `high_effort_low_mastery` warning badge.

---

## 6. End-to-End Journey Acceptance Protocols (J01 – J11)

| Journey ID | Journey Name | Persona | Primary Verification Assertion |
|---|---|---|---|
| **J01** | Course Creation & Syllabus Ingestion | Prof. Chen | 10-page truncation disclosure; 33 concepts & 34 edges committed. |
| **J02** | Student Onboarding & Prerequisite Navigation | Hari | Idempotent enrollment; 33 `gray` nodes; ancestor path lighting. |
| **J03** | Live Lecture & Real-Time Attendance | Hari, Rahul, Prof. Chen | Speech streaming; chunk persistence; attendance evidence boost $\le 0.30$. |
| **J04** | Formative Socratic Poll Cycle | Hari, Rahul, Prof. Chen | Open-ended question; server grading; atomic mastery update; heatmap refresh. |
| **J05** | Mid-Lecture Pedagogical Interventions | Prof. Chen | OpenRouter misconception clustering; 2 concrete instructional actions. |
| **J06** | Socratic Tutoring & Autonomous Review | Rahul | Socratic dialogue; breakthrough $+0.20$; server quiz grading; cited OpenRouter academic search. |
| **J07** | Consensual Peer Matching & Zoom Scheduling | Hari, Rahul | Opt-in pool; gap $\ge 0.30$; in-app chat; mutual slot; authentic Zoom meeting. |
| **J08** | Seeded Demonstration & Deployment | System Administrator | 33 concepts/34 edges/132 mastery rows; zero-cost fixture run; Render persistence. |
| **J09** | Daily Review Quest, Hints & Effort Streak | Rahul | 3-item daily quest; sequential 3-tier hints; XP discount; streak increments upon clear. |
| **J10** | Eclipse Review Diagnostic & Mascot Evolution | Hari, Spark | Eclipse strength calculation; exam countdown; mascot evolution (Ember $\to$ Nova). |
| **J11** | Collaborative Party Quest & Class Sky Visibility | Hari, Rahul, Prof. Chen | Bilateral party quest completion; 60 XP each; Class Sky mean stars; effort roster flag. |
