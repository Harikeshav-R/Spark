-- Migration: 20261021000001_enrollment_rpc.sql
-- Description: Transactional student enrollment and mastery initialization RPCs

-- ============================================================================
-- 1. Initialize Student Mastery
-- ============================================================================

CREATE OR REPLACE FUNCTION public.initialize_student_mastery(
    p_student_id UUID,
    p_course_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_course_exists BOOLEAN;
    v_inserted INTEGER := 0;
BEGIN
    IF p_student_id IS NULL OR p_course_id IS NULL THEN
        RAISE EXCEPTION 'Student ID and Course ID must not be null'
            USING ERRCODE = '22023';
    END IF;

    -- Verify the student belongs to the specified course
    SELECT EXISTS (
        SELECT 1
        FROM public.students
        WHERE id = p_student_id AND course_id = p_course_id
    ) INTO v_course_exists;

    IF NOT v_course_exists THEN
        RAISE EXCEPTION 'Student % not enrolled in course %', p_student_id, p_course_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Insert student_mastery rows for all concepts in the course
    INSERT INTO public.student_mastery (
        student_id,
        concept_id,
        confidence,
        attempts,
        version
    )
    SELECT
        p_student_id,
        cn.id,
        0.0,
        0,
        1
    FROM public.concept_nodes cn
    WHERE cn.course_id = p_course_id
    ON CONFLICT (student_id, concept_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- Revoke execute from public/anon/authenticated; grant exclusively to service_role
REVOKE ALL ON FUNCTION public.initialize_student_mastery(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_student_mastery(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.initialize_student_mastery(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_student_mastery(UUID, UUID) TO service_role;

-- ============================================================================
-- 2. Enroll Student
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enroll_student(
    p_auth_id UUID,
    p_join_code TEXT,
    p_name TEXT,
    p_email TEXT
)
RETURNS SETOF public.students
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_course_id UUID;
    v_student public.students%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_join_code IS NULL OR p_name IS NULL OR p_email IS NULL THEN
        RAISE EXCEPTION 'All parameters (auth_id, join_code, name, email) are required'
            USING ERRCODE = '22023';
    END IF;

    IF length(trim(p_name)) = 0 OR length(trim(p_email)) = 0 OR length(trim(p_join_code)) = 0 THEN
        RAISE EXCEPTION 'Arguments must not be empty or blank'
            USING ERRCODE = '22023';
    END IF;

    -- Resolve course by exact join code and acquire SHARE lock to prevent concurrent course deletion
    SELECT id INTO v_course_id
    FROM public.courses
    WHERE join_code = p_join_code
    FOR SHARE;

    IF v_course_id IS NULL THEN
        RAISE EXCEPTION 'Course not found for join code %', p_join_code
            USING ERRCODE = 'P0002';
    END IF;

    -- Insert student or skip on existing enrollment
    INSERT INTO public.students (
        auth_id,
        course_id,
        name,
        email
    ) VALUES (
        p_auth_id,
        v_course_id,
        p_name,
        p_email
    )
    ON CONFLICT (auth_id, course_id) DO NOTHING
    RETURNING * INTO v_student;

    -- If student already enrolled, lock existing row FOR UPDATE
    IF v_student.id IS NULL THEN
        SELECT * INTO v_student
        FROM public.students
        WHERE auth_id = p_auth_id AND course_id = v_course_id
        FOR UPDATE;
    END IF;

    -- Ensure all course concepts have student_mastery records (idempotent repair)
    PERFORM public.initialize_student_mastery(v_student.id, v_course_id);

    RETURN NEXT v_student;
    RETURN;
END;
$$;

-- Revoke execute from public/anon/authenticated; grant exclusively to service_role
REVOKE ALL ON FUNCTION public.enroll_student(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_student(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.enroll_student(UUID, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_student(UUID, TEXT, TEXT, TEXT) TO service_role;
