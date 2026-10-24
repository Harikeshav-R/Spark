-- Migration: 20261021000003_spark_learning.sql
-- Description: Additive Spark Learning relational schema (Daily Quests, Encounters, Quiz Attempts, XP Events, Exam Date, Hints)

BEGIN;

-- ============================================================================
-- 1. Column Extensions to Existing Tables
-- ============================================================================

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS exam_at TIMESTAMPTZ;

ALTER TABLE public.concept_quiz_questions ADD COLUMN IF NOT EXISTS hints JSONB CONSTRAINT concept_quiz_questions_hints_check CHECK (
  hints IS NULL OR CASE
    WHEN jsonb_typeof(hints) = 'array' THEN
      jsonb_array_length(hints) = 3
      AND jsonb_typeof(hints -> 0) = 'string'
      AND jsonb_typeof(hints -> 1) = 'string'
      AND jsonb_typeof(hints -> 2) = 'string'
    ELSE FALSE
  END
);

-- ============================================================================
-- 2. Daily Quests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.daily_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    quest_date DATE NOT NULL,
    concept_ids UUID[] NOT NULL,
    completed_ids UUID[] NOT NULL DEFAULT '{}',
    cleared_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, quest_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_quests_student_date ON public.daily_quests(student_id, quest_date);

-- ============================================================================
-- 3. Encounters
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.encounters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES public.concept_nodes(id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL CHECK (source IN ('star', 'daily', 'eclipse', 'party')),
    quest_id UUID REFERENCES public.daily_quests(id) ON DELETE SET NULL,
    party_quest_id UUID, -- Foreign key to party_quests(id) added in Phase 6 migration 0005
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    question_ids UUID[] NOT NULL,
    option_permutations JSONB NOT NULL,
    hints_used JSONB NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encounters_student ON public.encounters(student_id);
CREATE INDEX IF NOT EXISTS idx_encounters_concept ON public.encounters(concept_id);
CREATE INDEX IF NOT EXISTS idx_encounters_status ON public.encounters(status);
CREATE INDEX IF NOT EXISTS idx_encounters_quest ON public.encounters(quest_id);

-- ============================================================================
-- 4. Quiz Attempts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES public.concept_nodes(id) ON DELETE CASCADE,
    score FLOAT NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
    correct_count INT NOT NULL,
    total_questions INT NOT NULL DEFAULT 5,
    submitted_answers JSONB NOT NULL,
    encounter_id UUID UNIQUE REFERENCES public.encounters(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS encounter_id UUID UNIQUE REFERENCES public.encounters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_concept ON public.quiz_attempts(student_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_concept ON public.quiz_attempts(concept_id);

-- ============================================================================
-- 5. XP Events Ledger
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.xp_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    amount INT NOT NULL CHECK (amount > 0),
    reason VARCHAR(32) NOT NULL CHECK (reason IN ('encounter', 'quest_cleared', 'party')),
    source_id UUID NOT NULL,
    award_date DATE NOT NULL,
    concept_id UUID REFERENCES public.concept_nodes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, reason, source_id, award_date)
);

CREATE INDEX IF NOT EXISTS idx_xp_events_student ON public.xp_events(student_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_concept ON public.xp_events(concept_id);

-- INV-XP06 exact-once constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_daily_practice
  ON public.xp_events(student_id, concept_id, award_date)
  WHERE reason = 'encounter';

CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_quest_clear
  ON public.xp_events(student_id, award_date)
  WHERE reason = 'quest_cleared';

CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_party_clear
  ON public.xp_events(student_id, source_id)
  WHERE reason = 'party';

-- ============================================================================
-- 6. Row Level Security & Access Privileges
-- ============================================================================

ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily_quests FROM PUBLIC;
REVOKE ALL ON TABLE public.daily_quests FROM anon;
REVOKE ALL ON TABLE public.daily_quests FROM authenticated;
REVOKE ALL ON TABLE public.daily_quests FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_quests TO service_role;

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.encounters FROM PUBLIC;
REVOKE ALL ON TABLE public.encounters FROM anon;
REVOKE ALL ON TABLE public.encounters FROM authenticated;
REVOKE ALL ON TABLE public.encounters FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.encounters TO service_role;

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiz_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.quiz_attempts FROM anon;
REVOKE ALL ON TABLE public.quiz_attempts FROM authenticated;
REVOKE ALL ON TABLE public.quiz_attempts FROM service_role;
GRANT SELECT, INSERT ON TABLE public.quiz_attempts TO service_role;

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.xp_events FROM PUBLIC;
REVOKE ALL ON TABLE public.xp_events FROM anon;
REVOKE ALL ON TABLE public.xp_events FROM authenticated;
REVOKE ALL ON TABLE public.xp_events FROM service_role;
GRANT SELECT, INSERT ON TABLE public.xp_events TO service_role;

-- ============================================================================
-- 7. Schema Cache Reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
