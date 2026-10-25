-- Migration: 20261022000005_spark_collaboration.sql
-- Description: Add study group invitations, party quests, party quest progress, and encounter party foreign key

BEGIN;

-- ============================================================================
-- 1. Study Group Invitations
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.study_group_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    inviter_student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    invitee_student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    resulting_match_id UUID REFERENCES public.study_group_matches(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_course 
    ON public.study_group_invitations(course_id);

CREATE INDEX IF NOT EXISTS idx_invitations_invitee 
    ON public.study_group_invitations(invitee_student_id);

CREATE INDEX IF NOT EXISTS idx_invitations_inviter 
    ON public.study_group_invitations(inviter_student_id);

CREATE INDEX IF NOT EXISTS idx_invitations_resulting_match 
    ON public.study_group_invitations(resulting_match_id);

-- ============================================================================
-- 2. Party Quests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.party_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.study_group_matches(id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_party_quests_match 
    ON public.party_quests(match_id);

-- ============================================================================
-- 3. Party Quest Progress
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.party_quest_progress (
    party_quest_id UUID NOT NULL REFERENCES public.party_quests(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES public.concept_nodes(id) ON DELETE CASCADE,
    quiz_attempt_id UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE RESTRICT,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (party_quest_id, student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_party_progress_student 
    ON public.party_quest_progress(student_id);

CREATE INDEX IF NOT EXISTS idx_party_progress_concept 
    ON public.party_quest_progress(concept_id);

CREATE INDEX IF NOT EXISTS idx_party_progress_quiz_attempt 
    ON public.party_quest_progress(quiz_attempt_id);

-- ============================================================================
-- 4. Row Level Security & Access Privileges
-- ============================================================================

ALTER TABLE public.study_group_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.study_group_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.study_group_invitations FROM anon;
REVOKE ALL ON TABLE public.study_group_invitations FROM authenticated;
REVOKE ALL ON TABLE public.study_group_invitations FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.study_group_invitations TO service_role;

ALTER TABLE public.party_quests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.party_quests FROM PUBLIC;
REVOKE ALL ON TABLE public.party_quests FROM anon;
REVOKE ALL ON TABLE public.party_quests FROM authenticated;
REVOKE ALL ON TABLE public.party_quests FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_quests TO service_role;

ALTER TABLE public.party_quest_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.party_quest_progress FROM PUBLIC;
REVOKE ALL ON TABLE public.party_quest_progress FROM anon;
REVOKE ALL ON TABLE public.party_quest_progress FROM authenticated;
REVOKE ALL ON TABLE public.party_quest_progress FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_quest_progress TO service_role;

-- ============================================================================
-- 5. Foreign Key from Encounters to Party Quests
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.encounters'::regclass
          AND conname = 'encounters_party_quest_id_fkey'
    ) THEN
        ALTER TABLE public.encounters
            ADD CONSTRAINT encounters_party_quest_id_fkey
            FOREIGN KEY (party_quest_id)
            REFERENCES public.party_quests(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_encounters_party_quest 
    ON public.encounters(party_quest_id);

-- ============================================================================
-- 6. Schema Cache Reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
