-- Migration: 20261022000004_study_groups.sql
-- Description: Add student availability, study group messages, and atomic match creation RPC

BEGIN;

-- ============================================================================
-- 1. Student Availability
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.student_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at >= starts_at + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_availability_student 
    ON public.student_availability(student_id, starts_at);

-- ============================================================================
-- 2. Study Group Messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.study_group_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.study_group_matches(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_group_messages_match 
    ON public.study_group_messages(match_id, created_at);

-- ============================================================================
-- 3. Row Level Security & Access Privileges for Tables
-- ============================================================================

ALTER TABLE public.student_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_availability FROM PUBLIC;
REVOKE ALL ON TABLE public.student_availability FROM anon;
REVOKE ALL ON TABLE public.student_availability FROM authenticated;
REVOKE ALL ON TABLE public.student_availability FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_availability TO service_role;

ALTER TABLE public.study_group_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.study_group_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.study_group_messages FROM anon;
REVOKE ALL ON TABLE public.study_group_messages FROM authenticated;
REVOKE ALL ON TABLE public.study_group_messages FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.study_group_messages TO service_role;

-- ============================================================================
-- 4. Atomic Claim and Match Creation RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_and_create_match(
    p_course_id UUID,
    p_student_a UUID,
    p_student_b UUID,
    p_concept_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_s1 UUID;
    v_s2 UUID;
    v_match_id UUID;
    v_locked_count INT;
    v_now TIMESTAMPTZ;
    v_p1_concepts UUID[];
    v_p2_concepts UUID[];
    v_course_concept_count INT;
BEGIN
    -- 1. Input validation
    IF p_course_id IS NULL OR p_student_a IS NULL OR p_student_b IS NULL OR p_student_a = p_student_b THEN
        RAISE EXCEPTION 'Invalid match parameters' USING ERRCODE = '22023';
    END IF;

    IF p_concept_ids IS NULL
       OR cardinality(p_concept_ids) IS NULL
       OR cardinality(p_concept_ids) < 1
       OR cardinality(p_concept_ids) > 3
       OR array_position(p_concept_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid match parameters' USING ERRCODE = '22023';
    END IF;

    IF (SELECT count(DISTINCT c) FROM unnest(p_concept_ids) AS c) <> cardinality(p_concept_ids) THEN
        RAISE EXCEPTION 'Invalid match parameters' USING ERRCODE = '22023';
    END IF;

    -- Canonical ordering: v_s1 < v_s2
    IF p_student_a < p_student_b THEN
        v_s1 := p_student_a;
        v_s2 := p_student_b;
    ELSE
        v_s1 := p_student_b;
        v_s2 := p_student_a;
    END IF;

    -- 2. Lock both pool rows in canonical order without pre-filtering on status or expiry
    PERFORM 1
    FROM public.study_group_pool
    WHERE course_id = p_course_id
      AND student_id IN (v_s1, v_s2)
    ORDER BY student_id
    FOR UPDATE;

    GET DIAGNOSTICS v_locked_count = ROW_COUNT;
    IF v_locked_count <> 2 THEN
        RAISE EXCEPTION 'Pool entries are not both waiting and unexpired' USING ERRCODE = '55000';
    END IF;

    -- 3. Capture timestamp only after lock acquisition
    v_now := clock_timestamp();

    -- Verify first student's pool entry is waiting, unexpired, and student is enrolled in p_course_id
    SELECT p.concept_ids
    INTO v_p1_concepts
    FROM public.study_group_pool p
    JOIN public.students s ON s.id = p.student_id AND s.course_id = p_course_id
    WHERE p.course_id = p_course_id
      AND p.student_id = v_s1
      AND p.status = 'waiting'
      AND p.expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool entries are not both waiting and unexpired' USING ERRCODE = '55000';
    END IF;

    -- Verify second student's pool entry is waiting, unexpired, and student is enrolled in p_course_id
    SELECT p.concept_ids
    INTO v_p2_concepts
    FROM public.study_group_pool p
    JOIN public.students s ON s.id = p.student_id AND s.course_id = p_course_id
    WHERE p.course_id = p_course_id
      AND p.student_id = v_s2
      AND p.status = 'waiting'
      AND p.expires_at >= v_now;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pool entries are not both waiting and unexpired' USING ERRCODE = '55000';
    END IF;

    -- 4. Verify concepts: must occur in both students' requested pool concepts
    IF NOT (p_concept_ids <@ v_p1_concepts AND p_concept_ids <@ v_p2_concepts) THEN
        RAISE EXCEPTION 'Match concepts must be requested by both students in the course' USING ERRCODE = '22023';
    END IF;

    -- Verify concepts: must belong to public.concept_nodes in p_course_id
    SELECT count(DISTINCT id)
    INTO v_course_concept_count
    FROM public.concept_nodes
    WHERE course_id = p_course_id
      AND id = ANY(p_concept_ids);

    IF v_course_concept_count <> cardinality(p_concept_ids) THEN
        RAISE EXCEPTION 'Match concepts must be requested by both students in the course' USING ERRCODE = '22023';
    END IF;

    -- 5. Transition pool rows to 'matched' and insert match
    UPDATE public.study_group_pool
    SET status = 'matched'
    WHERE course_id = p_course_id
      AND student_id IN (v_s1, v_s2);

    INSERT INTO public.study_group_matches (
        course_id,
        student1_id,
        student2_id,
        concept_ids,
        status
    ) VALUES (
        p_course_id,
        v_s1,
        v_s2,
        p_concept_ids,
        'active'
    )
    RETURNING id INTO v_match_id;

    RETURN v_match_id;
END;
$$;

-- ============================================================================
-- 5. RPC Privileges
-- ============================================================================

REVOKE ALL ON FUNCTION public.claim_and_create_match(UUID, UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_and_create_match(UUID, UUID, UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.claim_and_create_match(UUID, UUID, UUID, UUID[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_and_create_match(UUID, UUID, UUID, UUID[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.claim_and_create_match(UUID, UUID, UUID, UUID[]) TO service_role;

-- ============================================================================
-- 6. Schema Cache Reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
