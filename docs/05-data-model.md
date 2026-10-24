# Data Model & Relational Schema: 28 Application Tables

This document defines the complete relational database schema for Spark. The database is hosted on Supabase PostgreSQL (PostgreSQL 15+) and managed through ordered migrations in `supabase/migrations/`.

---

## 1. Schema Overview & Relational Architecture

The data model consists of **28 application tables** partitioned into six logical domains:
1. **Core & Membership (5 tables)**: `teachers`, `courses`, `students`, `concept_nodes`, `concept_edges`
2. **Mastery & Ingestion (4 tables)**: `student_mastery`, `mastery_evidence`, `pdf_cache`, `quiz_attempts`
3. **Classroom & Formative Assessment (6 tables)**: `lecture_sessions`, `transcript_chunks`, `transcript_concepts`, `poll_questions`, `poll_responses`, `concept_quiz_questions`
4. **Spark Learning & Autonomous Practice (5 tables)**: `tutoring_sessions`, `tutoring_messages`, `concept_learning_pages`, `encounters`, `daily_quests`
5. **Effort Ledger (1 table)**: `xp_events`
6. **Peer Collaboration & Party Goals (7 tables)**: `study_group_pool`, `study_group_matches`, `student_availability`, `study_group_messages`, `study_group_invitations`, `party_quests`, `party_quest_progress`
---

## 2. Comprehensive Table Definitions

### 2.1 Core & Membership Tables

#### `teachers`
Represents verified instructors who own courses.
```sql
CREATE TABLE teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    zoom_client_id TEXT,             -- Encrypted at rest
    zoom_client_secret TEXT,         -- Encrypted at rest
    zoom_refresh_token TEXT,         -- Encrypted at rest
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_teachers_auth_id ON teachers(auth_id);
```

#### `courses`
Academic courses serving as the root organizational boundary.
```sql
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    join_code VARCHAR(8) UNIQUE NOT NULL,
    pdf_cache_hash VARCHAR(64),
    exam_at TIMESTAMPTZ,             -- Optional teacher-managed upcoming exam date
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_courses_join_code ON courses(join_code);
CREATE INDEX idx_courses_teacher_id ON courses(teacher_id);
```

#### `students`
Represents an authenticated user's enrollment in a course.
```sql
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(auth_id, course_id)
);
CREATE INDEX idx_students_course_id ON students(course_id);
CREATE INDEX idx_students_auth_id ON students(auth_id);
```

#### `concept_nodes`
Curriculum topics composing the course knowledge graph.
```sql
CREATE TABLE concept_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    difficulty INT NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    x FLOAT,
    y FLOAT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course_id, label)
);
CREATE INDEX idx_concept_nodes_course_id ON concept_nodes(course_id);
```

#### `concept_edges`
Directed prerequisite links between concepts (`source` is prerequisite to `target`).
```sql
CREATE TABLE concept_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    relationship VARCHAR(50) NOT NULL DEFAULT 'prerequisite',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_id != target_id),
    UNIQUE(source_id, target_id)
);
CREATE INDEX idx_concept_edges_course_id ON concept_edges(course_id);
CREATE INDEX idx_concept_edges_target ON concept_edges(target_id);
```

---

### 2.2 Mastery & Evidence Tables

#### `student_mastery`
Current aggregated confidence state for each student and concept.
```sql
CREATE TABLE student_mastery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    confidence FLOAT NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    version INT NOT NULL DEFAULT 1,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, concept_id)
);
CREATE INDEX idx_student_mastery_student ON student_mastery(student_id);
CREATE INDEX idx_student_mastery_concept ON student_mastery(concept_id);
```

#### `mastery_evidence` (Deliberate Addition 1)
Immutable audit trail of all events that mutated student confidence.
```sql
CREATE TABLE mastery_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    evidence_type VARCHAR(20) NOT NULL CHECK (evidence_type IN ('poll', 'tutor', 'quiz', 'attendance')),
    source_id UUID NOT NULL, -- references poll_responses, tutoring_messages, quiz_attempts, or transcript_chunks
    prior_confidence FLOAT NOT NULL,
    new_confidence FLOAT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(evidence_type, source_id, student_id, concept_id)
);
CREATE INDEX idx_mastery_evidence_student_concept ON mastery_evidence(student_id, concept_id);
```

#### `pdf_cache`
Deduplication cache for syllabus extraction results.
```sql
CREATE TABLE pdf_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_hash VARCHAR(64) UNIQUE NOT NULL,
    filename VARCHAR(255) NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pdf_cache_hash ON pdf_cache(file_hash);
```

#### `quiz_attempts` (Deliberate Addition 2)
Tracks practice quiz submissions and scores independently of poll attempts.
```sql
CREATE TABLE quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    score FLOAT NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
    correct_count INT NOT NULL,
    total_questions INT NOT NULL DEFAULT 5,
    submitted_answers JSONB NOT NULL,
    encounter_id UUID UNIQUE REFERENCES encounters(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quiz_attempts_student_concept ON quiz_attempts(student_id, concept_id);
```

---

### 2.3 Classroom & Formative Assessment Tables

#### `lecture_sessions`
Live or completed class lecture periods.
```sql
CREATE TABLE lecture_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'completed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_lectures_course_status ON lecture_sessions(course_id, status);
```

#### `transcript_chunks`
Timestamped chunks of transcribed lecture speech.
```sql
CREATE TABLE transcript_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    timestamp_sec FLOAT NOT NULL CHECK (timestamp_sec >= 0.0),
    speaker_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transcript_chunks_lecture ON transcript_chunks(lecture_id, timestamp_sec);
```

#### `transcript_concepts`
Junction table linking speech chunks to detected concepts.
```sql
CREATE TABLE transcript_concepts (
    transcript_chunk_id UUID NOT NULL REFERENCES transcript_chunks(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (transcript_chunk_id, concept_id)
);
CREATE INDEX idx_transcript_concepts_concept ON transcript_concepts(concept_id);
```

#### `poll_questions`
Formative assessment questions generated during lecture.
```sql
CREATE TABLE poll_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    expected_answer TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);
CREATE INDEX idx_poll_questions_lecture ON poll_questions(lecture_id, status);
```

#### `poll_responses`
Student answers and AI evaluations for lecture polls.
```sql
CREATE TABLE poll_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES poll_questions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    answer TEXT NOT NULL,
    evaluation JSONB, -- { outcome: 'correct'|'partial'|'wrong', feedback: string }
    status VARCHAR(20) NOT NULL DEFAULT 'evaluated' CHECK (status IN ('pending', 'evaluated', 'failed')),
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(question_id, student_id)
);
CREATE INDEX idx_poll_responses_question ON poll_responses(question_id);
CREATE INDEX idx_poll_responses_student ON poll_responses(student_id);
```

#### `concept_quiz_questions`
Precomputed multiple-choice question bank for student practice quizzes.
```sql
CREATE TABLE concept_quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_answer INT NOT NULL CHECK (correct_answer BETWEEN 0 AND 3),
    explanation TEXT NOT NULL,
    hints JSONB CHECK (hints IS NULL OR jsonb_array_length(hints) = 3), -- [nudge, bigger_hint, walkthrough]
    question_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quiz_questions_concept ON concept_quiz_questions(concept_id);
```

---

### 2.4 Learning & Peer Collaboration Tables

#### `tutoring_sessions`
Interactive Socratic tutoring sessions.
```sql
CREATE TABLE tutoring_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    target_concepts UUID[] NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_tutoring_sessions_student ON tutoring_sessions(student_id);
```

#### `tutoring_messages`
Multi-turn message history for Socratic tutoring.
```sql
CREATE TABLE tutoring_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES tutoring_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    concept_id UUID REFERENCES concept_nodes(id) ON DELETE SET NULL,
    understanding_detected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tutoring_messages_session ON tutoring_messages(session_id, created_at);
```

#### `concept_learning_pages`
Precomputed structured markdown learning guides for concepts.
```sql
CREATE TABLE concept_learning_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID UNIQUE NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_learning_pages_concept ON concept_learning_pages(concept_id);
```

#### `study_group_pool`
Ephemeral 5-minute matchmaking queue for peer study.
```sql
CREATE TABLE study_group_pool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'expired', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    UNIQUE(student_id, course_id)
);
CREATE INDEX idx_pool_course_status ON study_group_pool(course_id, status);
CREATE INDEX idx_pool_student ON study_group_pool(student_id);
```

#### `study_group_matches`
Consensual pairs of matched peers.
```sql
CREATE TABLE study_group_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student1_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student2_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    scheduling_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (scheduling_status IN ('pending', 'proposed', 'accepted', 'no-overlap')),
    proposed_start TIMESTAMPTZ,
    proposed_end TIMESTAMPTZ,
    student1_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    student2_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    zoom_meeting_id VARCHAR(100),
    zoom_link VARCHAR(500),
    meeting_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (meeting_status IN ('pending', 'created', 'unavailable')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (student1_id < student2_id)
);
CREATE INDEX idx_matches_students ON study_group_matches(student1_id, student2_id);
CREATE INDEX idx_matches_course ON study_group_matches(course_id);
```

#### `student_availability` (Deliberate Addition 3)
Tracks future availability intervals for peer scheduling.
```sql
CREATE TABLE student_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at >= starts_at + INTERVAL '30 minutes')
);
CREATE INDEX idx_availability_student ON student_availability(student_id, starts_at);
```

#### `study_group_messages` (Deliberate Addition 4)
Authentic peer-to-peer text messages between matched students.
```sql
CREATE TABLE study_group_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES study_group_matches(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_study_group_messages_match ON study_group_messages(match_id, created_at);
```

#### `study_group_invitations` (Deliberate Addition 5)
Direct invitations sent between opted-in eligible candidates in the study pool.
```sql
CREATE TABLE study_group_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    inviter_student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    invitee_student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    resulting_match_id UUID REFERENCES study_group_matches(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invitations_course ON study_group_invitations(course_id);
CREATE INDEX idx_invitations_invitee ON study_group_invitations(invitee_student_id);
```

#### `party_quests` (Deliberate Addition 6)
Collaborative practice goals undertaken by matched study-group peers targeting 1–3 shared concepts.
```sql
CREATE TABLE party_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES study_group_matches(id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_party_quests_match ON party_quests(match_id);
```

#### `party_quest_progress` (Deliberate Addition 7)
Tracks individual peer verification for each concept in a shared party quest.
```sql
CREATE TABLE party_quest_progress (
    party_quest_id UUID NOT NULL REFERENCES party_quests(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    quiz_attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE RESTRICT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (party_quest_id, student_id, concept_id)
);
CREATE INDEX idx_party_progress_student ON party_quest_progress(student_id);
```

---

### 2.5 Spark Learning & Progression Tables

#### `encounters` (Deliberate Addition 8)
Orchestrates five-question practice quiz encounters with Spark reactions and server-controlled hints.
```sql
CREATE TABLE encounters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL CHECK (source IN ('star', 'daily', 'eclipse', 'party')),
    quest_id UUID REFERENCES daily_quests(id) ON DELETE SET NULL,
    party_quest_id UUID, -- Foreign key to party_quests(id) added in Phase 6 migration 0005
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    question_ids UUID[] NOT NULL,
    option_permutations JSONB NOT NULL,
    hints_used JSONB NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_encounters_student ON encounters(student_id);
CREATE INDEX idx_encounters_concept ON encounters(concept_id);
CREATE INDEX idx_encounters_status ON encounters(status);
```
*Note*: `party_quest_id` is created nullable without a foreign key in Phase 1 migration 0003; Phase 6 migration 0005 adds the foreign key constraint once `party_quests` exists. Prior to Phase 6, requests with `source = 'party'` are rejected with `503 SERVICE_UNAVAILABLE`.

#### `daily_quests` (Deliberate Addition 9)
Persistent daily review queue (0–3 ready concepts) generated per student per UTC date.
```sql
CREATE TABLE daily_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    quest_date DATE NOT NULL,
    concept_ids UUID[] NOT NULL,
    completed_ids UUID[] NOT NULL DEFAULT '{}',
    cleared_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, quest_date)
);
CREATE INDEX idx_daily_quests_student_date ON daily_quests(student_id, quest_date);
```

#### `xp_events` (Deliberate Addition 10)
Append-only server-authoritative ledger recording student effort points.
```sql
CREATE TABLE xp_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount INT NOT NULL CHECK (amount > 0),
    reason VARCHAR(32) NOT NULL CHECK (reason IN ('encounter', 'quest_cleared', 'party')),
    source_id UUID NOT NULL,
    award_date DATE NOT NULL,
    concept_id UUID REFERENCES concept_nodes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, reason, source_id, award_date)
);
CREATE UNIQUE INDEX idx_xp_daily_practice ON xp_events(student_id, concept_id, award_date) WHERE reason = 'encounter';
CREATE INDEX idx_xp_events_student ON xp_events(student_id);
```

---

## 3. Transactional Stored Procedures (RPCs)

The database exposes privileged PostgreSQL functions callable exclusively by the backend service-role:

### 3.1 `apply_mastery_evidence`
Atomically records evidence and updates confidence and version in `student_mastery`:
```sql
CREATE OR REPLACE FUNCTION apply_mastery_evidence(
    p_student_id UUID,
    p_concept_id UUID,
    p_evidence_type VARCHAR(20),
    p_source_id UUID,
    p_new_confidence FLOAT,
    p_increment_attempt BOOLEAN
)
RETURNS TABLE (new_confidence FLOAT, new_attempts INT, new_version INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_conf FLOAT := 0.0;
    v_old_attempts INT := 0;
    v_old_version INT := 1;
BEGIN
    -- Select with row lock
    SELECT confidence, attempts, version 
    INTO v_old_conf, v_old_attempts, v_old_version
    FROM student_mastery
    WHERE student_id = p_student_id AND concept_id = p_concept_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mastery record not found for student % and concept %', p_student_id, p_concept_id;
    END IF;

    -- Record immutable evidence
    INSERT INTO mastery_evidence (
        student_id, concept_id, evidence_type, source_id, prior_confidence, new_confidence
    ) VALUES (
        p_student_id, p_concept_id, p_evidence_type, p_source_id, v_old_conf, p_new_confidence
    );

    -- Update mastery state
    UPDATE student_mastery
    SET confidence = p_new_confidence,
        attempts = v_old_attempts + (CASE WHEN p_increment_attempt THEN 1 ELSE 0 END),
        version = v_old_version + 1,
        last_updated = NOW()
    WHERE student_id = p_student_id AND concept_id = p_concept_id
    RETURNING confidence, attempts, version INTO new_confidence, new_attempts, new_version;

    RETURN NEXT;
END;
$$;
```

### 3.2 `claim_and_create_match`
Atomically claims two waiting pool entries and creates a canonically ordered match:
```sql
CREATE OR REPLACE FUNCTION claim_and_create_match(
    p_course_id UUID,
    p_student_a UUID,
    p_student_b UUID,
    p_concept_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_s1 UUID;
    v_s2 UUID;
    v_match_id UUID;
BEGIN
    -- Canonical ordering
    IF p_student_a < p_student_b THEN
        v_s1 := p_student_a;
        v_s2 := p_student_b;
    ELSE
        v_s1 := p_student_b;
        v_s2 := p_student_a;
    END IF;

    -- Lock both pool rows
    PERFORM 1 FROM study_group_pool
    WHERE course_id = p_course_id AND student_id IN (v_s1, v_s2) AND status = 'waiting'
    FOR UPDATE;

    -- Update pool status
    UPDATE study_group_pool
    SET status = 'matched'
    WHERE course_id = p_course_id AND student_id IN (v_s1, v_s2);

    -- Insert match
    INSERT INTO study_group_matches (
        course_id, student1_id, student2_id, concept_ids, status
    ) VALUES (
        p_course_id, v_s1, v_s2, p_concept_ids, 'active'
    )
    RETURNING id INTO v_match_id;

    RETURN v_match_id;
END;
$$;
```

---

## 4. Authorization & Security Boundaries

1. **No Anonymous Client Access**: Public (`anon`) table access is revoked for all 28 tables. All reads and writes must pass through the Express backend.
2. **Explicit Course/Role Check**: Because the backend uses `SUPABASE_SERVICE_ROLE_KEY` (which bypasses RLS), every repository query MUST enforce ownership filters:
   - Teachers can only access courses where `teacher_id` matches their verified teacher ID.
   - Students can only access courses where an active `students` row exists for their verified `auth_id`.
3. **Encrypted Zoom Credentials**: Teacher Zoom credentials (`zoom_client_id`, `zoom_client_secret`, `zoom_refresh_token`) are encrypted with AES-256-GCM using `CREDENTIAL_ENCRYPTION_KEY` before insertion and decrypted only within `src/server/zoom/`.

---

## 5. Chronological Database Migrations Roadmap

All relational changes follow a strict chronological, single-writer migration sequence:

1. **`20261020000001_initial_schema.sql`** (Phase 0 — *Completed History*):
   - Creates initial 18 base tables, constraints, foreign keys, and indexes.
2. **`20261020000002_mastery_rpc.sql`** (Phase 1 — *Target*):
   - Implements atomic `apply_mastery_evidence` PostgreSQL stored procedure with row-level locks.
3. **`20261021000003_spark_learning.sql`** (Phase 1 — *Target*):
   - Creates `encounters`, `daily_quests`, and `xp_events` tables.
   - Adds `courses.exam_at` (TIMESTAMPTZ NULL).
   - Adds `concept_quiz_questions.hints` (JSONB NULL) with 3-element length validation.
   - Adds `quiz_attempts.encounter_id` (UUID NULL UNIQUE REFERENCES `encounters(id)`).
4. **`20261022000004_study_groups.sql`** (Phase 6 — *Target*, rescheduled from old 0003):
   - Creates base collaboration tables: `study_group_pool`, `study_group_matches`, `student_availability`, `study_group_messages`.
   - Implements atomic `claim_and_create_match` stored procedure.
5. **`20261022000005_spark_collaboration.sql`** (Phase 6 — *Target*):
   - Creates `study_group_invitations`, `party_quests`, and `party_quest_progress` tables.
   - Adds foreign key constraint from `encounters.party_quest_id` to `party_quests(id)`.
