# Spark Technical Doc

Status: design-stage spec. The only running code is the single-file prototype `spark.html`. Everything marked **Inherited** exists in the Preree repo (`jasonyi33/prereq`). Everything marked **New** is proposed for Spark. Items marked **Verify** were not read in detail and should be checked before relying on them.
Companion: `SPARK_DESIGN.md` (product, UX, mascot, motion, voice).

---

## 1. Overview and architecture

Spark keeps Preree's pipeline end to end and adds a game engine, a mascot system and a few tables.

```
                  Zoom meeting (live lecture)
                          |  RTMS audio / transcript
                          v
┌──────────────────────────────────────────────┐        ┌───────────────────────────┐
│ frontend/ (Next.js + Express + Socket.IO)    │  HTTP  │ api/ (Flask, Python)      │
│  - pages: student map, professor Class Sky,  │───────>│  - courses, concepts      │
│    party                                     │        │  - PDF -> concept graph   │
│  - server/: RTMS listener, transcript route, │<───────│  - mastery rules (single  │
│    poll routes, intervention route, socket   │        │    writer of mastery)     │
│  - src/lib/prompts: Claude prompts           │        │  - heatmap aggregation    │
│  - NEW: game engine client lib, mascot       │        │  - study groups           │
│    system, quest + eclipse UI                │        │  - NEW: quests, XP, parties│
└───────────────┬──────────────────────────────┘        └─────────────┬─────────────┘
                │                                                      │
                └───────────────┬──────────────────────────────────────┘
                                v
                        Supabase (Postgres)
                                ^
        Anthropic Claude (Sonnet / Haiku)   Perplexity Sonar (resources)
```

### What is inherited versus new

| Area | Inherited from Preree | New in Spark |
| --- | --- | --- |
| Concept graph from PDF | Claude document API extraction, importance score | Lane assignment from `category`, gate flag from importance |
| Mastery | `student_mastery.confidence` 0 to 1 with three update modes | Rescaled 0 to 100 presentation, new thresholds, decay, spaced review |
| Lecture | RTMS, transcript chunks, concept detection, polls, interventions | Poll arrives as an Encounter, mascot reactions |
| Practice | Concept learning page, concept quiz, tutoring chat | Daily Quest queue, Encounters with hint tiers, Eclipse |
| Social | Study group pool, complementarity matching, Zoom link | Parties with scheduled slots and shared quest |
| Professor | Heatmap, student list, poll controls, interventions | Class Sky restyle, XP versus mastery, effort flags |
| UI | Next.js, Tailwind, shadcn UI primitives | Spark design system, mascot, map renderer |

---

## 2. Preree baseline (what is in the repo)

Facts below come from reading the repo (`CLAUDE.md`, `api/API_DOCUMENTATION.md`, `scripts/add_learning_tables.sql`, `frontend/server/*`, `frontend/src/lib/*`, `api/src/routes/*`).

### 2.1 Repo structure

```
prereq/
  CLAUDE.md                      shared dev guide, schema, contracts
  tasks/prd-prereq.md            PRD (927 lines)
  render.yaml                    Render deployment
  scripts/add_learning_tables.sql
  api/                           Flask
    app.py
    src/
      db.py, cache.py            Supabase client, cache helper
      middleware/auth.py         optional_auth (Verify details)
      routes/                    auth, concepts, courses, create, graph, heatmap,
                                 lectures, pages, polls, students, study_groups,
                                 transcripts, tutoring
      services/create_kg.py      Claude document API, parse_kg, importance
      services/generate_content.py   learning pages and quizzes
    scripts/seed_study_pool.py, clear_sam.py
    API_DOCUMENTATION.md
  frontend/                      Next.js 15 style app router, custom Express server
    server/                      index.ts, socket.ts, socket-helpers.ts, rtms.ts,
                                 transcript-route.ts, poll-*-route.ts,
                                 intervention-route.ts, chat-route.ts,
                                 simulator.ts, auto-responder.ts, db.ts
    src/app/                     pages and API routes
    src/components/              graph, student, dashboard, study-group, tutor, ui
    src/lib/                     prompts/, colors.ts, graph.ts, socket.ts, flask.ts,
                                 redis.ts, concept-cache.ts, auth-context.tsx
```

### 2.2 Services and responsibilities

- **Flask API (port 5000):** owns courses, concept nodes and edges, students, and `student_mastery`. It is the single writer of mastery, so every confidence rule lives in one place. Also owns heatmap aggregation, study groups, learning pages and quizzes.
- **Next.js plus Express (port 3000):** owns lectures, transcript chunks, concept links, polls, tutoring, interventions. A custom Express server hosts Socket.IO and the Zoom RTMS webhooks, which is why it cannot deploy on Vercel.
- **Supabase:** shared Postgres. No ORM. Flask uses `supabase-py`; Node uses `@supabase/supabase-js`.
- **Claude:** Sonnet for extraction, question generation, tutoring, interventions, learning pages, quizzes. Haiku for concept detection, response evaluation and understanding checks.
- **Perplexity Sonar:** resource search with hardcoded fallback resources.
- **Deploy:** frontend on Render, Flask on Cloud Run, DB on Supabase.

### 2.3 Preree data model (as documented)

Core: `courses`, `concept_nodes(label, description, category, difficulty, x, y)`, `concept_edges(source_id, target_id, relationship)`, `students`, `student_mastery(confidence, attempts, last_updated)`.
Lecture: `lecture_sessions`, `transcript_chunks`, `transcript_concepts`, `poll_questions`, `poll_responses(evaluation JSONB)`.
Tutoring: `tutoring_sessions`, `tutoring_messages`.
Learning content: `concept_learning_pages`, `concept_quiz_questions`, plus (per the API doc) `learning_pages`, `practice_quizzes`, `quiz_questions`, `quiz_responses`, `pdf_cache`.
Study groups: `study_group_pool`, `study_group_matches`, and a study-group chat route (**Verify** exact columns in `api/src/routes/study_groups.py` and migrations).

### 2.4 Preree mastery rules (single source of truth: Flask)

- `confidence` is a float 0.0 to 1.0. Display color is derived, never stored.
- Colors: 0 gray, 0.01 to 0.39 red, 0.40 to 0.69 yellow, 0.70 to 1.0 green.
- `PUT /api/students/:id/mastery/:concept_id` takes one of: `{confidence}` absolute, `{eval_result}` (`correct` sets `max(current, 0.85)`, `partial` sets `max(current, 0.50)`, `wrong` sets `min(current, 0.20)` and lifts a 0.0 to 0.20, attempts +1), or `{delta}` relative and clamped.
- `POST /api/mastery/attendance-boost` adds +0.05 per mentioned concept, capped so passive boosts never exceed 0.30.
- Quiz submit maps score to confidence (>=0.8 gives 0.85, >=0.6 gives 0.60, else 0.30) and only ever raises mastery.
- Eager rows: creating a student inserts a mastery row (0.0) for every concept, and uploading a PDF inserts rows for every existing student.
- Importance: in-degree style score passed through a sigmoid (`calculate_importance` in `create_kg.py`).

### 2.5 Preree real-time flow

1. Professor starts a lecture (`lecture_sessions`, status live). Students and professor join Socket.IO rooms (`lecture:{id}`, `professor:{id}`, `student:{id}`).
2. Zoom RTMS (or `simulator.ts`) delivers transcript text. `POST /api/lectures/:id/transcript` stores a chunk, runs Haiku concept detection against the course's concept labels, links `transcript_concepts`, calls attendance-boost for present students, then emits `transcript:chunk` and `lecture:concept-detected`.
3. Professor generates a poll (Sonnet, concept plus last transcript chunks), activates it (`poll:new-question` to students), students answer free text, Haiku evaluates to `correct|partial|wrong`, Flask applies the mastery rule, server emits `mastery:updated` to the student and `heatmap:updated` to the professor.
4. Professor closes the poll (distribution and a misconception summary), and can request interventions (Sonnet teaching suggestions).
5. After lecture: tutoring chat (Socratic, Haiku understanding check gives +0.2 delta), learning pages, quizzes, study groups.

### 2.6 Preree frontend notes (visual baseline Spark inherits)

- Light gray-50 page, white bordered rounded panels, serif wordmark with a live dot, action buttons in the header.
- Student page: graph (about 60 percent) plus tabbed side panel (about 40 percent) with underline tabs, a dynamic selected-concept tab, and a floating mastery pill over the graph.
- Selecting a node highlights its ancestor chain.
- Professor dashboard: concept heatmap, timeline, interventions, poll controls, student list, transcript feed.
- Study group: concept selector, waiting card, matched card with side-by-side confidence.

---

## 3. Target stack and repo layout for Spark

### 3.1 Decision: evolve Preree, do not fork the architecture

Keep the two-service layout and the single-writer mastery rule. The game engine is new logic added to Flask (authoritative) and mirrored in a small TypeScript library (for optimistic UI and tests). Do not create a third backend.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js (app router), TypeScript, Tailwind, Socket.IO client | Inherited, working |
| Realtime | Express custom server + Socket.IO | Inherited, required for RTMS |
| Backend | Flask + `supabase-py` | Inherited, owns mastery |
| DB | Supabase Postgres | Inherited |
| AI | Anthropic Claude (Sonnet for generation, Haiku for fast classification) | Inherited |
| Mascot and map rendering | Hand-authored SVG in React components, no canvas, no heavy animation library | The prototype proves it works; CSS and Web Animations API cover it |
| Fonts | Baloo 2 and Nunito via `next/font` | Matches prototype (see design doc 5.3 for the open question) |
| Tests | `pytest` (Flask), `vitest` (TS) | Inherited |

### 3.2 Proposed layout (additions in bold)

```
frontend/src/
  app/
    student/[studentId]/page.tsx         map + side panel (Spark, Encounter, Transcript)
    student/[studentId]/party/page.tsx   party flow
    professor/dashboard/page.tsx         Class Sky + Students + Poll + Suggestions
  components/
    map/QuestMap.tsx, Star.tsx, Lane.tsx, Edge.tsx, MasteryPill.tsx    (replaces graph/)
    spark/SparkMascot.tsx, SparkToken.tsx, SparkBubble.tsx, useSpark.ts
    panel/SparkTab.tsx, EncounterTab.tsx, TranscriptTab.tsx, StarTab.tsx
    quest/DailyQuest.tsx, Eclipse.tsx, RewardCard.tsx
    professor/ClassSky.tsx, StudentsTab.tsx, PollTab.tsx, SuggestionsTab.tsx
    party/StarPicker.tsx, MatchList.tsx, SlotPicker.tsx
  lib/
    engine/mastery.ts, xp.ts, quest.ts, eclipse.ts, stage.ts   (pure, tested)
    tokens.css                                                   (design tokens)
    spark-copy.ts                                                (all mascot lines)
api/src/
  routes/quests.py, xp.py, parties.py
  services/mastery_engine.py, quest_builder.py, eclipse.py, decay.py
```

---

## 4. Data model

Spark reuses Preree's tables and adds the following. Types are Postgres.

### 4.1 Changes to existing tables

| Table | Change | Reason |
| --- | --- | --- |
| `concept_nodes` | add `lane TEXT`, `is_gate BOOLEAN DEFAULT false`, `importance FLOAT`, `order_in_lane INT` | Map layout and gate rings. Keep `category` as the source for `lane` and `x, y` as optional layout hints |
| `student_mastery` | add `last_correct_at TIMESTAMP`, `last_practiced_at TIMESTAMP`, `streak_correct INT DEFAULT 0`, `ease FLOAT DEFAULT 2.0`, `next_review_at TIMESTAMP` | Fading, spaced review |
| `students` | add `xp INT DEFAULT 0`, `streak_days INT DEFAULT 0`, `last_streak_date DATE` | Header chips |
| `poll_responses` | add `hints_used INT DEFAULT 0` (optional, for polls) | Parity with Encounters |

Mastery storage stays as `confidence FLOAT 0..1`. The UI shows `round(confidence * 100)`. This avoids a data migration and keeps Preree's endpoints valid.

### 4.2 New tables

```sql
-- One Encounter = a short question session on one star
CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  concept_id UUID REFERENCES concept_nodes(id) ON DELETE CASCADE,
  source VARCHAR(20) NOT NULL,        -- 'daily' | 'poll' | 'eclipse' | 'star' | 'party'
  quest_id UUID,                      -- daily_quests.id when source = 'daily'
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE encounter_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID REFERENCES encounters(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,          -- concept_quiz_questions.id or poll_questions.id
  chosen_index INT,
  correct BOOLEAN,
  wrong_attempts INT DEFAULT 0,
  hints_used INT DEFAULT 0,           -- 0..3
  mastery_before FLOAT,
  mastery_after FLOAT,
  xp_awarded INT,
  answered_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE daily_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  quest_date DATE NOT NULL,
  concept_ids UUID[] NOT NULL,        -- the three stars
  completed_ids UUID[] DEFAULT '{}',
  cleared_at TIMESTAMP,
  UNIQUE(student_id, quest_date)
);

CREATE TABLE xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  amount INT NOT NULL,
  reason VARCHAR(40) NOT NULL,        -- 'encounter' | 'quest_cleared' | 'party' | 'streak'
  ref_id UUID,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Existing Preree tables for study groups are reused. Parties add scheduling:
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  match_id UUID,                      -- study_group_matches.id (Verify name)
  concept_ids UUID[] NOT NULL,
  slot TIMESTAMP,
  zoom_link TEXT,
  status VARCHAR(20) DEFAULT 'proposed',   -- 'proposed' | 'scheduled' | 'done' | 'cancelled'
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE party_members (
  party_id UUID REFERENCES parties(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'invited',    -- 'invited' | 'accepted' | 'declined'
  PRIMARY KEY (party_id, student_id)
);

-- Optional: snapshot so the professor can see change over time
CREATE TABLE class_sky_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  taken_at TIMESTAMP DEFAULT NOW(),
  payload JSONB NOT NULL              -- same shape as heatmap response
);
```

### 4.3 Write ownership (keep Preree's rule: one writer per table)

| Table | Writer |
| --- | --- |
| `courses`, `concept_nodes`, `concept_edges`, `students`, `student_mastery` | Flask |
| `encounters`, `encounter_answers`, `daily_quests`, `xp_events`, `parties`, `party_members`, `class_sky_snapshots` | Flask |
| `lecture_sessions`, `transcript_chunks`, `transcript_concepts`, `poll_questions`, `poll_responses`, `tutoring_*` | Next.js server |

The mastery engine is in Flask only, so Next.js never computes mastery. It sends an event ("answer submitted") and receives the result.

---

## 5. Game engine algorithms

All numbers below match the prototype and are the starting values, to be tuned with real data. Put them in one config module so they can be changed without touching logic. Mastery is shown as 0 to 100.

### 5.1 Star state

```
isUnlocked(star) = every prerequisite p has mastery(p) >= 60
state(star):
  not unlocked      -> locked
  mastery >= 85     -> shining
  mastery >= 60     -> lit
  else              -> dim
```

Preree thresholds were green at 0.70 and above. Spark moves the "understood" line to 60 and "solid" to 85 on the 0 to 100 scale. If Preree's data is reused, apply the new thresholds in the shared helper and update `confidence_to_color` in both services (it is duplicated in Python and TypeScript, which is a known sync risk).

### 5.2 Mastery update on an answer

Replace Preree's `max/min` rules for Encounters with a gain model, while keeping them for polls (see 5.3).

```
hintsGain = [26, 18, 11, 6][hints_used]     # 0..3 hints
gain      = max(4, hintsGain - 3 * wrong_attempts)
mastery'  = min(100, mastery + gain)        # correct answers only
```

A wrong answer does not reduce mastery in an Encounter (the student can retry the same question); it only reduces the gain. This is deliberate: Spark never scolds. Mastery can still go down through decay (5.6).

### 5.3 Polls (live lecture)

Polls are free-text in Preree and evaluated by Haiku as `correct|partial|wrong`. For Spark, keep free-text for polls but adopt a gain model so the stars fill smoothly:

| eval_result | Effect |
| --- | --- |
| correct | `max(mastery, 85)` if the star was lit or shining; otherwise `mastery + 26` |
| partial | `mastery + 10`, capped at 70 |
| wrong | `max(mastery, 20)` if the star was at 0 (so the answer shows as engaged), otherwise unchanged |

This keeps Preree's idea that a wrong answer can never lower the score while avoiding a single answer jumping a star from dim to shining on a lucky guess. **Open question:** do polls move mastery the same amount as Encounters? Recommended: polls count a little less (live answers are lower stakes and faster).

### 5.4 XP

```
xp = max(8, 30 - 6 * hints_used - 3 * wrong_attempts)    # per correct Encounter answer
quest_cleared_bonus = 25
party_quest_bonus   = 60  (each member)
```

XP never changes mastery and mastery never changes XP. XP is stored as events (`xp_events`) with a running total on `students.xp`.

### 5.5 Streak

A day counts when the Daily Quest is cleared. `streak_days` increments if `last_streak_date` is yesterday, resets to 1 if older, and does nothing if already today. A single missed day resets quietly; the UI never shames. (Optional later: a streak freeze item.)

### 5.6 Decay and spaced review (New)

Goal: a star that has not been practiced slowly fades, and the next review time is scheduled.

```
on correct answer:
  streak_correct += 1
  ease = min(2.8, ease + 0.1 * (hints_used == 0 ? 1 : 0))
  interval_days = [1, 3, 7, 14, 30][min(streak_correct - 1, 4)] * (ease / 2.0)
  next_review_at = now + interval_days
on wrong answer:
  streak_correct = max(0, streak_correct - 1); ease = max(1.3, ease - 0.2)

fading(star) = now > next_review_at and mastery >= 30
decay (daily job):
  for each star where now > next_review_at + 3 days:
      mastery -= 2   (floor at 30% of the peak, and never below 0)
```

Fading stars sort first in the Daily Quest. Decay is intentionally slow so the student is never blindsided. **Open question:** whether to decay numbers at all or only flag fading (see design doc section 11).

### 5.7 Daily Quest builder

```
candidates = stars where isUnlocked and (mastery < 85 or fading)
sort by:
   1. fading first
   2. lower mastery first
   3. higher importance (gate stars) first
quest = first 3 candidates
```

One quest row per student per date (`daily_quests`). Reopening the app the same day returns the same three. Clearing all three awards `quest_cleared_bonus` and updates the streak.

### 5.8 Eclipse

```
w = the 3 lowest-mastery unlocked stars
gap_i = max(0, 85 - mastery_i)
strength = round( sum(gap_i) / (3 * 85) * 100 )          # 0..100
```

Shown as a bar. Zero means the three dimmest stars are all shining. Because the three weakest change as the student improves, the bar can rise when a new weakest star appears; the UI explains this ("It feeds on your dimmest stars"). Optionally tie to an exam date for the "Midterm in N days" label (`courses.exam_date` or a separate `course_events` table, New).

### 5.9 Spark form

```
sky = average(mastery) over all stars in the course
form = Nova if sky >= 75; Glow if >= 55; Spark if >= 25; else Ember
```

Evolution is detected client side by comparing form before and after a mastery update, and server side by returning `form_before` and `form_after` in the answer response.

### 5.10 Class Sky (professor)

For each star: `class_avg = average mastery over students`, `distribution = counts of dim, lit, shining, locked per student`. State bands: solid at 75 and above, mixed 50 to 74, dim below 50, upcoming if the star has not been taught (no `transcript_concepts` rows for the course yet). Attention ring when taught and under 50.

### 5.11 Effort versus mastery flag

```
high_effort_low_mastery = xp_percentile >= 75 and avg_mastery_percentile <= 40
check_in = avg_mastery < 50
on_track = avg_mastery >= 85
```

Computed per course on demand. Always presented to the professor as information, never as a grade.

### 5.12 Party matching (Inherited, tweaked)

Preree: `complementarity = mean(|conf_a - conf_b|)` across the chosen concepts. Pool entries per course; if nobody is waiting, a demo fallback picks any other student. Spark keeps the metric and adds:

- A mutual-benefit constraint: for at least one chosen star, A is at 70 or above and B is below 50, and for at least one other, the reverse. Otherwise the pair is a mentor-student pairing and is labeled as such.
- Fit percent shown to the user is `round(complementarity * 100)` clamped to 99.
- Preree's demo fallback (instant match with a random classmate, and a hardcoded Zoom link in code) must be removed or feature-flagged off in production.

---

## 6. Realtime pipeline

Inherited and kept. Spark's additions are in bold.

### 6.1 Rooms and presence

`lecture:join { lectureId, role, studentId? }` puts the socket in `lecture:{id}`, plus `professor:{id}` or `student:{id}`. The server keeps an in-memory map of lecture to present students (`globalThis` so Next route modules share it).

**Caveat:** in-memory presence breaks with more than one server instance. For production, move presence to Redis (there is already `lib/redis.ts`) or Socket.IO's Redis adapter.

### 6.2 Transcript to concept detection

- Source: Zoom RTMS audio transcribed (Deepgram per the env file), or `simulator.ts` for demos.
- Detection: Haiku call with the transcript chunk and the list of known concept labels, returning `{ "detected_concepts": [...] }`. Latency target under 1 second. Labels are mapped to ids via a per-lecture cache.
- Output: rows in `transcript_chunks` and `transcript_concepts`, then socket events.

### 6.3 Poll lifecycle

`draft` to `active` to `closed`. Generate (Sonnet) with concept plus recent transcript, activate (emits `poll:new-question`), respond (Haiku evaluates, Flask updates mastery), close (distribution, misconception summary).

### 6.4 Events

| Event | Direction | Payload | Spark use |
| --- | --- | --- | --- |
| `lecture:join` | client to server | `{ lectureId, role, studentId? }` | unchanged |
| `transcript:chunk` | server to lecture room | `{ text, timestamp, detectedConcepts[] }` | Transcript tab line |
| `lecture:concept-detected` | server to lecture room | `{ conceptId, label }` | Spark hops to the star, concept chip pulses |
| `poll:new-question` | server to students | `{ pollId, question, conceptLabel }` | Encounter tab dot, toast, Spark thinks |
| `poll:closed` | server to lecture room | `{ pollId, results }` | professor result card |
| `mastery:updated` | server to one student | `{ studentId, conceptId, oldColor, newColor, confidence }` | **extend to** `{ conceptId, before, after, stateBefore, stateAfter, unlocked[], form }` |
| `heatmap:updated` | server to professor | `{ conceptId }` | Class Sky refetch |
| **`spark:nudge`** | server to one student | `{ kind, conceptId?, text }` | optional mascot nudge (new concept started, quest reminder) |
| **`party:update`** | server to party members | `{ partyId, status, slot? }` | party status |

All new payloads are versioned with a `v` field so older clients can ignore them.

---

## 7. AI components

All prompts live in `frontend/src/lib/prompts/` and follow Preree's rules: define input format, exact output JSON, edge cases and model before writing a prompt, test the parser not the prose, and fall back safely on parse errors.

### 7.1 Inherited prompts

| Prompt | Model | Input | Output |
| --- | --- | --- | --- |
| Concept extraction | Sonnet | PDF (first 10 pages as base64 via document API) | `{concepts[], edges[]}` (labels, descriptions, category, difficulty) |
| Concept detection | Haiku | chunk plus labels | `{detected_concepts[]}` |
| Question generation | Sonnet | concept plus last 5 chunks plus class distribution | `{question, expected_answer}` |
| Response evaluation | Haiku | question, expected, student answer | `{eval_result, feedback, reasoning}` (parse failure defaults to partial) |
| Tutoring | Sonnet | system prompt with weak concepts and transcript excerpts, full history | message |
| Understanding check | Haiku | student message | `{understood, concept_label}` |
| Intervention | Sonnet | struggling concepts plus distribution | `{suggestions[]}` |
| Misconception summary, lecture summary | Sonnet | responses, transcript | text |

### 7.2 New or changed for Spark

**Encounter question set (multiple choice, with three hints).** Today `concept_quiz_questions` is four-option multiple choice with an explanation. Spark needs three-option questions with tiered hints.

- Model: Sonnet, generated offline per concept (not in the live path), cached in the DB.
- Output schema:
  ```json
  {
    "questions": [
      {
        "prompt": "string, under 140 chars",
        "options": ["string", "string", "string"],
        "answer_index": 0,
        "hints": ["nudge", "bigger hint", "walkthrough"],
        "explanation": "string, under 240 chars",
        "difficulty": 1
      }
    ]
  }
  ```
- Rules: exactly three options, one correct, plausible distractors that reflect real misconceptions, hint 1 does not mention the answer, hint 3 may state the reasoning but not the letter, no trick questions, uses terms from the course's own notes.
- Validation in code: three options, `answer_index` in range, three hints, no option identical to another, hints do not contain the exact correct option text (soft check).
- Add `option_*` columns or move to a JSONB `options` column and `hints` JSONB on `concept_quiz_questions` (or a new `encounter_questions` table).

**Mascot lines.** All reaction lines are deterministic strings from `spark-copy.ts` with a few variants each (no LLM in the path). Optional later: a Haiku call that personalizes the Daily Quest greeting from yesterday's work, with a strict length cap and a fallback to the static line.

**Concept lane assignment.** At PDF extraction time, ask Sonnet to also return a `category` per concept (Preree already does) and map categories to lanes in code. Gate stars come from the importance score, not from the model.

### 7.3 Guardrails

- Never put a student's name or email into any prompt unless required; use ids.
- Cap prompt context (transcript excerpts) and set max tokens on every call.
- Parse strictly; on failure, use a safe default (partial for evaluation, a stored question for generation) and log it.
- Do not let free-text student answers or transcript text be treated as instructions (prompt-injection hygiene: wrap them in clearly delimited data sections and tell the model to treat them as data).
- Cache generated content (questions, hints, resources) so identical requests are free and consistent.

---

## 8. API and socket contract

Existing Preree endpoints stay. Additions (all JSON, errors as `{ "error": "message" }`, snake_case in the database and API, camelCase in the TypeScript client layer).

### 8.1 Quest and Encounter (Flask)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET` | `/api/students/:id/daily-quest` | none | `{ date, concept_ids[], completed_ids[], cleared, streak_days }` (creates today's quest if missing) |
| `POST` | `/api/students/:id/encounters` | `{ concept_id, source, quest_id? }` | `{ encounter_id, question: { id, prompt, options[] } }` (answer and hints not included) |
| `POST` | `/api/encounters/:id/hint` | `{ question_id }` | `{ hint_level, text }` (server counts hints; max 3) |
| `POST` | `/api/encounters/:id/answer` | `{ question_id, chosen_index }` | see below |
| `GET` | `/api/students/:id/eclipse` | none | `{ strength, stars: [{ concept_id, mastery }], exam_date? }` |
| `GET` | `/api/students/:id/summary` | none | `{ xp, streak_days, sky, form, form_progress }` |

Answer response:

```json
{
  "correct": true,
  "mastery": { "before": 35, "after": 61, "state_before": "dim", "state_after": "lit" },
  "xp_awarded": 30,
  "unlocked": ["concept-uuid"],
  "form": { "before": "Spark", "after": "Glow" },
  "quest": { "completed_ids": ["..."], "cleared": false },
  "explanation": "string"
}
```

On a wrong answer the response is `{ correct: false, wrong_attempts: n, can_retry: true }` and no mastery change. The correct index is never sent before the question is answered correctly or abandoned (prevents reading it from the network tab).

### 8.2 Map and class views

| Method | Path | Notes |
| --- | --- | --- |
| `GET /api/courses/:id/graph?student_id=` | Inherited. Extend each node with `lane`, `is_gate`, `mastery` (0..100), `state`, `fading`, and each edge with `met` |
| `GET /api/courses/:id/heatmap` | Inherited. Extend with `class_avg` per concept, `taught` boolean, `state` |
| `GET /api/courses/:id/students/effort` | New. `[{ student_id, name, xp, avg_mastery, flag }]` for the professor only |

### 8.3 Parties

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/students/:id/party-search` | `{ concept_ids[] }` | `{ matches: [{ student_id, name, fit, strong_in[], can_help_with[] }] }` |
| `POST` | `/api/parties` | `{ concept_ids[], invitee_ids[] }` | party |
| `PUT` | `/api/parties/:id/slot` | `{ slot }` | party |
| `POST` | `/api/parties/:id/respond` | `{ student_id, status }` | party |

### 8.4 Authentication

Preree has a Flask auth route and an `optional_auth` middleware, and the frontend has an auth context (**Verify** the exact scheme, whether it verifies tokens and how roles are stored). For Spark production, every Flask endpoint should require auth, derive the acting student from the token (never trust `:id` in the path), and require a professor role for class-wide endpoints.

---

## 9. Frontend architecture

### 9.1 State model

One store per page, derived data computed from a single source of truth.

```ts
type Star = {
  id: string; name: string; short: string; lane: string; isGate: boolean;
  req: string[]; mastery: number;        // 0..100
  fading: boolean; taught: boolean; x: number; y: number;
};
type StudentState = {
  stars: Record<string, Star>;
  xp: number; streakDays: number;
  daily: { conceptIds: string[]; completed: Record<string, boolean> };
  at: string;                             // star Spark is standing on
  selected: string | null;
  mood: "calm" | "think" | "cheer" | "oops" | "sleepy";
  say: string;                            // current speech bubble line
  encounter: EncounterState | null;
};
```

Derived (pure functions in `lib/engine`): `isUnlocked`, `stateOf`, `stageOf`, `sky`, `eclipseStrength`, `weakest`. The prototype's functions of the same names are the reference implementation.

Use React state plus a small reducer or Zustand. Server responses are applied through one `applyAnswerResult()` so every view updates together (stars, header chips, Spark tab, bubble).

### 9.2 Mapping from the prototype (`spark.html`)

| Prototype piece | Production component |
| --- | --- |
| `NODES`, `LANES` | server data (`concept_nodes`, lanes from `category`) |
| `starPath`, `starNode` (clipPath fill, rays, lock) | `Star.tsx` |
| `mapSVG` (lanes, edges, token) | `QuestMap.tsx`, `Lane.tsx`, `Edge.tsx`, `SparkToken.tsx` |
| `mascotInner(mood, stage, mini)` | `SparkMascot.tsx` (props: `mood`, `form`, `size`) |
| `react(kind)`, `burst`, `hopToken` | `useSpark()` hook (animations through Web Animations API) |
| cursor tracking `--lx/--ly` | `useCursorLook()` with one `pointermove` listener, shared |
| `bump()` idle timer | `useIdleNudge(30_000)` |
| `tabSpark/tabEncounter/tabTranscript/tabStar` | `panel/*Tab.tsx` |
| `startDaily/choose/contEnc` | engine calls to `/daily-quest`, `/encounters`, `/answer` plus the reward card |
| party view, professor tabs | `party/*`, `professor/*` |

The prototype is one file with global CSS. In production: design tokens in CSS variables (`tokens.css`), Tailwind configured to use them, components styled with Tailwind plus a few component-level CSS for the star and mascot keyframes.

### 9.3 Map rendering

- One `<svg>` with a viewBox sized to the lanes (the prototype uses 1100 by 580). Positions come from `lane` and `order_in_lane`, not hard-coded x and y; add a small layout function (lane index gives y band, order gives x, gate stars sit in the Core lane). Allow manual overrides from `x, y`.
- Stars fill via a `clipPath` rectangle whose height tracks mastery.
- Each star is a keyboard-focusable `<g role="button" tabindex="0">` with an aria label.
- Edges are cubic curves with mid-point control. Class names express state so the CSS handles color.
- For very large graphs (over about 80 stars) switch to virtualization or collapse lanes. Preree's PRD targets 27 to 35 concepts, which SVG handles easily.

### 9.4 Mascot system

- `SparkMascot` takes `mood` and `form` and renders the SVG layers described in the design doc (aura, shadow, body, face, ticks).
- Reactions are triggered by a small event bus (`spark.react("hop" | "shake" | "think" | "spin")`), not by prop changes, so animations play even if state does not change.
- Respect `prefers-reduced-motion` in JavaScript too: skip the token hop and sparkle burst.
- Mascot lines live in `spark-copy.ts` as typed functions (`copy.starSelected(star)`), unit-tested for length and for banned words.

### 9.4.1 Performance

Keep ambient animations on the compositor (transform and opacity). Use one `requestAnimationFrame` for pupil tracking. Avoid layout-triggering properties in animations. Target 60 fps on a mid-range laptop with the map showing 35 stars and one mascot token.

### 9.5 Accessibility implementation notes

See the design doc, section 10. Concretely: `aria-live="polite"` on the bubble, `role="tablist"` and `role="tab"` with `aria-selected` on tabs, arrow-key navigation within the tablist (not done in the prototype), focus returned to the star after closing its tab, and a visible skip link.

---

## 10. Privacy, security, fairness and integrity

### 10.1 Privacy

- Mastery maps are sensitive learning data. A student sees only their own. A professor sees class aggregates and individual rows for their own course only.
- Parties expose only the chosen stars' mastery bands (dim, lit, shining), not the raw map or names beyond what the student agreed to.
- Lecture transcripts may include student speech. Treat transcripts as course data, retain only as long as the course requires, and give a way to delete.
- Store the minimum PII (name, email). Avoid sending PII to AI providers.
- Be clear in the UI when Spark is AI-generated (questions, hints, suggestions).
- FERPA-type obligations apply in the US for education records. Spark is formative, not a gradebook, but the data is still sensitive. Get institutional review before pilots.

### 10.2 Security

- Authenticate every endpoint; derive identity from the token. Preree's API doc lists "Auth: None" on almost all endpoints, which is fine for a hackathon demo and not for production.
- Authorize by role and course membership. Professor-only endpoints include class-wide heatmap, effort and polls.
- Rate-limit AI-backed endpoints (poll generation, hints, evaluation).
- Never ship the correct answer index to the client before it is needed. Never expose `expected_answer` for polls to students.
- Remove hardcoded secrets and personal links (Preree has a hardcoded personal Zoom link in `study_groups.py`) and the `MOCK_MODE` and demo fallbacks from production builds.
- Validate all inputs; use parameterized Supabase calls only.
- Keep `.env` out of the repo; rotate any keys that were ever committed.

### 10.3 Fairness and integrity

- **No pay-to-win and no streak shaming.** The streak is a habit helper, not a punishment.
- **Anti-gaming:** repeated guessing is limited by lowering gain per wrong attempt and by cooldowns on the same question (rotate questions, never show the same item twice in a row, track `question_id` history).
- **Question bank rotation:** at least three questions per star; Encounters use unseen ones first.
- **Collusion in parties:** parties are for learning, mastery only changes through individual Encounters, not through party attendance.
- **Bias in AI evaluation:** log `reasoning` for free-text evaluations and let a professor review disputed ones. Default to "partial" on parse errors, not "wrong".
- **Accessibility as fairness:** keyboard-only and reduced-motion paths must produce the same learning outcomes.

---

## 11. Testing, milestones and agent working agreements

### 11.1 What must have tests first (TDD, as in Preree)

- `mastery_engine`: gain model (hints and wrong attempts), unlock computation, state thresholds, decay, spaced intervals.
- `quest_builder`: ordering, locked stars excluded, same-day idempotence.
- `eclipse`: strength math, edge cases (fewer than three open stars).
- `xp` and streak: day boundaries, time zones (use the student's local date), one increment per day.
- Prompt parsers: evaluation, encounter question validation, detection label parsing.
- Confidence and state mapping shared between Python and TypeScript (golden table tests in both).

Skip tests for pure presentation and for the mascot's visuals. Do visual checks by screenshot at 400 px and 1360 px.

### 11.2 Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Prototype v2 reviewed | Design and technical docs agreed, open questions in design doc section 11 answered |
| M1 | Engine and data | New tables migrated, engine module with tests, `/daily-quest`, `/encounters`, `/answer` working with seeded CS229 data |
| M2 | Student map | `QuestMap`, `Star`, `SparkMascot`, Spark tab, Encounter tab driven by the API, accessibility pass |
| M3 | Live lecture | Transcript tab, concept hop, poll as Encounter, mastery events over Socket.IO, simulator-driven demo |
| M4 | Professor | Class Sky, Students (XP versus mastery), Poll controls, Suggestions |
| M5 | Parties | Matching, invites, slot picking, Zoom link generated per party (no hardcoded link) |
| M6 | Hardening | Auth and roles, rate limits, Redis presence, privacy review, load test |
| M7 | Pilot | One real course, one real lecture, measure the questions in 11.4 |

### 11.3 Working agreements for agents and contributors

1. Read `SPARK_DESIGN.md` before touching UI. Read this doc before touching data or the engine.
2. Keep the single-writer rule for mastery. Never compute or write mastery outside the engine.
3. Never let XP change a star. Never let mastery come from anything but a graded answer.
4. Keep game volume at medium. Do not add confetti, sound, popups or timers without a design decision.
5. Spark never scolds. Any new copy goes through the voice rules in design doc section 8.
6. No eyebrow labels, identical card grids, glow, glass, gradient text, emoji icons or modals-by-reflex (design doc 9.2).
7. Label sample data as sample data. Do not invent statistics, testimonials or claims.
8. Put tunable numbers in one config module. Do not scatter magic numbers.
9. Write tests first for engine logic and parsers.
10. KISS and YAGNI, as in Preree's own guide. Do not build what is not in the milestone.
11. When something here conflicts with the prototype, this doc wins unless the user says otherwise.

### 11.4 Success measures for a pilot

- **Return rate:** share of students who open Spark on a day without a lecture.
- **Daily Quest clear rate** and median time to clear.
- **Calibration:** correlation between star mastery and performance on an independent quiz or exam item for the same concept (the honesty test: do lit stars mean understanding?).
- **Gaming signal:** share of Encounters answered with zero hints and zero time (suspicious).
- **Professor value:** number of times a professor changed what they taught or reviewed because of Class Sky, collected by short survey.
- **Effort versus mastery divergence:** count of "High effort, low mastery" flags that led to a check-in.

### 11.5 Known risks and open technical questions

| Risk or question | Notes |
| --- | --- |
| Presence and sockets are in memory | Move to Redis adapter before more than one instance |
| Duplicate confidence-to-color logic in Python and TypeScript | Share a golden test table, or expose state from the API only |
| Free-text poll evaluation cost and latency | Haiku target under 2 s; cache; fallback to partial |
| Question bank quality | Needs human spot-checks per course; add a professor review screen |
| Zoom RTMS access | Requires Zoom approval; keep the simulator path for demos and development |
| Decay vs fading | Decide with the product owner (design doc section 11) |
| Auth scheme details | **Verify** `api/src/routes/auth.py` and `middleware/auth.py` before building on them |
| Study group tables | **Verify** exact schema in `study_groups.py` and migrations before writing `parties` joins |
| PRD non-goals | `tasks/prd-prereq.md` lists non-goals for the hackathon; re-read it and decide which still apply |