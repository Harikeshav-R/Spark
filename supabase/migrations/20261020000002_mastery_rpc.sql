-- Migration: 20261020000002_mastery_rpc.sql
-- Description: Audit table and atomic mastery RPCs with row locking

-- ============================================================================
-- 1. Mastery Evidence Audit Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mastery_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES public.concept_nodes(id) ON DELETE CASCADE,
    evidence_type VARCHAR(20) NOT NULL CHECK (evidence_type IN ('poll', 'tutor', 'quiz', 'attendance')),
    source_id UUID NOT NULL,
    prior_confidence DOUBLE PRECISION NOT NULL CHECK (prior_confidence >= 0.0 AND prior_confidence <= 1.0),
    new_confidence DOUBLE PRECISION NOT NULL CHECK (new_confidence >= 0.0 AND new_confidence <= 1.0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(evidence_type, source_id, student_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_mastery_evidence_student_concept ON public.mastery_evidence(student_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_mastery_evidence_created ON public.mastery_evidence(created_at);

-- Security: Immutable audit ledger. Only service_role can SELECT and INSERT; NO UPDATE/DELETE.
ALTER TABLE public.mastery_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mastery_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.mastery_evidence FROM anon;
REVOKE ALL ON TABLE public.mastery_evidence FROM authenticated;
REVOKE ALL ON TABLE public.mastery_evidence FROM service_role;
GRANT SELECT, INSERT ON TABLE public.mastery_evidence TO service_role;

-- ============================================================================
-- 2. Apply Mastery Evidence RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_mastery_evidence(
    p_actor_auth_id UUID,
    p_student_id UUID,
    p_concept_id UUID,
    p_evidence JSONB
)
RETURNS TABLE (
    new_confidence DOUBLE PRECISION,
    new_attempts INTEGER,
    new_version INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_type TEXT;
    v_source_id_text TEXT;
    v_source_id UUID;
    v_outcome TEXT;
    v_score DOUBLE PRECISION;
    v_course_id UUID;
    v_student_auth_id UUID;
    v_is_teacher BOOLEAN;
    v_concept_exists BOOLEAN;
    v_concept_in_course BOOLEAN;
    v_mastery_id UUID;
    v_cur_confidence DOUBLE PRECISION;
    v_cur_attempts INTEGER;
    v_cur_version INTEGER;
    v_already_applied BOOLEAN;
    v_calc_confidence DOUBLE PRECISION;
    v_next_attempts INTEGER;
BEGIN
    IF p_actor_auth_id IS NULL OR p_student_id IS NULL OR p_concept_id IS NULL OR p_evidence IS NULL THEN
        RAISE EXCEPTION 'All parameters (actor_auth_id, student_id, concept_id, evidence) are required'
            USING ERRCODE = '22023';
    END IF;

    -- Validate JSON structure
    IF jsonb_typeof(p_evidence) != 'object' THEN
        RAISE EXCEPTION 'Evidence must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    v_type := p_evidence->>'type';
    IF v_type IS NULL OR v_type NOT IN ('poll', 'tutor', 'quiz', 'attendance') THEN
        RAISE EXCEPTION 'Invalid or missing evidence type: %', v_type
            USING ERRCODE = '22023';
    END IF;

    v_source_id_text := p_evidence->>'sourceId';
    IF v_source_id_text IS NULL THEN
        RAISE EXCEPTION 'Missing evidence sourceId'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_source_id := v_source_id_text::UUID;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid UUID for sourceId: %', v_source_id_text
            USING ERRCODE = '22P02';
    END;

    IF v_type = 'poll' THEN
        v_outcome := p_evidence->>'outcome';
        IF v_outcome IS NULL OR v_outcome NOT IN ('correct', 'partial', 'wrong') THEN
            RAISE EXCEPTION 'Invalid or missing poll outcome: %', v_outcome
                USING ERRCODE = '22023';
        END IF;
    ELSIF v_type = 'quiz' THEN
        IF p_evidence->'score' IS NULL OR jsonb_typeof(p_evidence->'score') != 'number' THEN
            RAISE EXCEPTION 'Missing or non-numeric quiz score'
                USING ERRCODE = '22023';
        END IF;
        v_score := (p_evidence->>'score')::DOUBLE PRECISION;
        IF v_score < 0.0 OR v_score > 1.0 THEN
            RAISE EXCEPTION 'Quiz score must be between 0.0 and 1.0, got: %', v_score
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Resolve target student and owning course
    SELECT s.course_id, s.auth_id
    INTO v_course_id, v_student_auth_id
    FROM public.students s
    WHERE s.id = p_student_id;

    IF v_course_id IS NULL THEN
        RAISE EXCEPTION 'Student % not found', p_student_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Verify actor authorization: must be either target student or course teacher
    IF p_actor_auth_id != v_student_auth_id THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.courses c
            JOIN public.teachers t ON c.teacher_id = t.id
            WHERE c.id = v_course_id AND t.auth_id = p_actor_auth_id
        ) INTO v_is_teacher;

        IF NOT v_is_teacher THEN
            RAISE EXCEPTION 'Actor % not authorized for student %', p_actor_auth_id, p_student_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Verify concept node exists and belongs to target course
    SELECT EXISTS (
        SELECT 1
        FROM public.concept_nodes cn
        WHERE cn.id = p_concept_id
    ) INTO v_concept_exists;

    IF NOT v_concept_exists THEN
        RAISE EXCEPTION 'Concept % not found', p_concept_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.concept_nodes cn
        WHERE cn.id = p_concept_id AND cn.course_id = v_course_id
    ) INTO v_concept_in_course;

    IF NOT v_concept_in_course THEN
        RAISE EXCEPTION 'Concept % belongs to a different course', p_concept_id
            USING ERRCODE = '42501';
    END IF;

    -- Acquire row lock on student_mastery
    SELECT sm.id, sm.confidence, sm.attempts, sm.version
    INTO v_mastery_id, v_cur_confidence, v_cur_attempts, v_cur_version
    FROM public.student_mastery sm
    WHERE sm.student_id = p_student_id AND sm.concept_id = p_concept_id
    FOR UPDATE;

    IF v_mastery_id IS NULL THEN
        RAISE EXCEPTION 'Student mastery row not found for student % and concept %', p_student_id, p_concept_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Check for idempotency replay
    SELECT EXISTS (
        SELECT 1
        FROM public.mastery_evidence me
        WHERE me.evidence_type = v_type
          AND me.source_id = v_source_id
          AND me.student_id = p_student_id
          AND me.concept_id = p_concept_id
    ) INTO v_already_applied;

    IF v_already_applied THEN
        -- Replay: return current locked mastery state unchanged without version/attempts increment
        new_confidence := v_cur_confidence;
        new_attempts := v_cur_attempts;
        new_version := v_cur_version;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Apply evidence mutation formulas
    IF v_type = 'poll' THEN
        IF v_outcome = 'correct' THEN
            v_calc_confidence := GREATEST(v_cur_confidence, 0.85);
        ELSIF v_outcome = 'partial' THEN
            v_calc_confidence := GREATEST(v_cur_confidence, 0.50);
        ELSE
            IF v_cur_confidence = 0.0 THEN
                v_calc_confidence := 0.20;
            ELSE
                v_calc_confidence := LEAST(v_cur_confidence, 0.20);
            END IF;
        END IF;
    ELSIF v_type = 'tutor' THEN
        v_calc_confidence := LEAST(v_cur_confidence + 0.20, 1.0);
    ELSIF v_type = 'quiz' THEN
        IF v_score >= 0.80 THEN
            v_calc_confidence := LEAST(v_cur_confidence + 0.15, 1.0);
        ELSIF v_score >= 0.60 THEN
            v_calc_confidence := LEAST(v_cur_confidence + 0.10, 1.0);
        ELSIF v_score >= 0.40 THEN
            v_calc_confidence := LEAST(v_cur_confidence + 0.05, 1.0);
        ELSE
            v_calc_confidence := LEAST(v_cur_confidence + 0.02, 1.0);
        END IF;
    ELSIF v_type = 'attendance' THEN
        IF v_cur_confidence < 0.30 THEN
            v_calc_confidence := LEAST(v_cur_confidence + 0.05, 0.30);
        ELSE
            v_calc_confidence := v_cur_confidence;
        END IF;
    END IF;

    -- Round to 3 decimal places
    v_calc_confidence := (round(v_calc_confidence::numeric, 3))::DOUBLE PRECISION;

    -- Only poll evidence increments attempts
    IF v_type = 'poll' THEN
        v_next_attempts := v_cur_attempts + 1;
    ELSE
        v_next_attempts := v_cur_attempts;
    END IF;

    -- Record immutable audit log
    INSERT INTO public.mastery_evidence (
        student_id,
        concept_id,
        evidence_type,
        source_id,
        prior_confidence,
        new_confidence
    ) VALUES (
        p_student_id,
        p_concept_id,
        v_type,
        v_source_id,
        v_cur_confidence,
        v_calc_confidence
    );

    -- Update student_mastery state
    UPDATE public.student_mastery
    SET
        confidence = v_calc_confidence,
        attempts = v_next_attempts,
        version = v_cur_version + 1,
        last_updated = NOW()
    WHERE id = v_mastery_id;

    new_confidence := v_calc_confidence;
    new_attempts := v_next_attempts;
    new_version := v_cur_version + 1;
    RETURN NEXT;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mastery_evidence(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_mastery_evidence(UUID, UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.apply_mastery_evidence(UUID, UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mastery_evidence(UUID, UUID, UUID, JSONB) TO service_role;

-- ============================================================================
-- 3. Get Student Mastery Read RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_student_mastery(
    p_actor_auth_id UUID,
    p_student_id UUID
)
RETURNS SETOF public.student_mastery
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_course_id UUID;
    v_student_auth_id UUID;
    v_is_teacher BOOLEAN;
BEGIN
    IF p_actor_auth_id IS NULL OR p_student_id IS NULL THEN
        RAISE EXCEPTION 'Both actor_auth_id and student_id are required'
            USING ERRCODE = '22023';
    END IF;

    -- Resolve student
    SELECT s.course_id, s.auth_id
    INTO v_course_id, v_student_auth_id
    FROM public.students s
    WHERE s.id = p_student_id;

    IF v_course_id IS NULL THEN
        RAISE EXCEPTION 'Student % not found', p_student_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Check actor authorization
    IF p_actor_auth_id != v_student_auth_id THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.courses c
            JOIN public.teachers t ON c.teacher_id = t.id
            WHERE c.id = v_course_id AND t.auth_id = p_actor_auth_id
        ) INTO v_is_teacher;

        IF NOT v_is_teacher THEN
            RAISE EXCEPTION 'Actor % not authorized to read mastery for student %', p_actor_auth_id, p_student_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN QUERY
    SELECT *
    FROM public.student_mastery sm
    WHERE sm.student_id = p_student_id
    ORDER BY sm.concept_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_mastery(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_mastery(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_student_mastery(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_mastery(UUID, UUID) TO service_role;
