-- HackOHIO-2026: Migration 0001 - Foundation 18 Base Tables
-- Reference: docs/05-data-model.md & docs/03-invariants.md
-- Lane: Lane A (Platform & Core)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. Core & Membership Tables
-- ============================================================================

-- Teachers: Verified instructors who own courses
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

-- Courses: Academic courses serving as root organizational boundaries
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    join_code VARCHAR(8) UNIQUE NOT NULL,
    pdf_cache_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_courses_join_code ON courses(join_code);
CREATE INDEX idx_courses_teacher_id ON courses(teacher_id);

-- Students: Authenticated user enrollments in courses
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

-- Concept Nodes: Curriculum topics composing the course knowledge graph
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

-- Concept Edges: Directed prerequisite links between concepts
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

-- ============================================================================
-- 2. Mastery & Ingestion Tables
-- ============================================================================

-- Student Mastery: Current aggregated confidence state per student and concept
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

-- PDF Cache: Deduplication cache for syllabus extraction results
CREATE TABLE pdf_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_hash VARCHAR(64) UNIQUE NOT NULL,
    filename VARCHAR(255) NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pdf_cache_hash ON pdf_cache(file_hash);

-- ============================================================================
-- 3. Classroom & Formative Assessment Tables
-- ============================================================================

-- Lecture Sessions: Live or completed class lecture periods
CREATE TABLE lecture_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'completed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_lectures_course_status ON lecture_sessions(course_id, status);

-- Transcript Chunks: Timestamped speech chunks from live lectures
CREATE TABLE transcript_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    timestamp_sec FLOAT NOT NULL CHECK (timestamp_sec >= 0.0),
    speaker_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transcript_chunks_lecture ON transcript_chunks(lecture_id, timestamp_sec);

-- Transcript Concepts: Junction linking speech chunks to detected concepts
CREATE TABLE transcript_concepts (
    transcript_chunk_id UUID NOT NULL REFERENCES transcript_chunks(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (transcript_chunk_id, concept_id)
);
CREATE INDEX idx_transcript_concepts_concept ON transcript_concepts(concept_id);

-- Poll Questions: Formative assessment questions generated during lecture
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

-- Poll Responses: Student answers and AI evaluations for lecture polls
CREATE TABLE poll_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES poll_questions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    answer TEXT NOT NULL,
    evaluation JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'evaluated' CHECK (status IN ('pending', 'evaluated', 'failed')),
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(question_id, student_id)
);
CREATE INDEX idx_poll_responses_question ON poll_responses(question_id);
CREATE INDEX idx_poll_responses_student ON poll_responses(student_id);

-- Concept Quiz Questions: Multiple-choice question bank for practice quizzes
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
    question_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quiz_questions_concept ON concept_quiz_questions(concept_id);

-- ============================================================================
-- 4. Learning & Peer Collaboration Tables
-- ============================================================================

-- Tutoring Sessions: Interactive Socratic tutoring dialogues
CREATE TABLE tutoring_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    target_concepts UUID[] NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_tutoring_sessions_student ON tutoring_sessions(student_id);

-- Tutoring Messages: Multi-turn message history for tutoring sessions
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

-- Concept Learning Pages: Structured markdown learning guides for concepts
CREATE TABLE concept_learning_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID UNIQUE NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_learning_pages_concept ON concept_learning_pages(concept_id);

-- Study Group Pool: Ephemeral 5-minute matchmaking queue for peer study
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

-- Study Group Matches: Consensual pairs of matched peers
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

-- ============================================================================
-- 5. Security & Access Control
-- ============================================================================

-- Revoke direct anonymous client access; all mutations route through backend
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
