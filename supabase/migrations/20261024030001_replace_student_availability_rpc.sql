-- Migration: 20261024030001_replace_student_availability_rpc.sql
-- Description: Lane A approved atomic replace_student_availability RPC (SCR for Lane B)

BEGIN;

CREATE OR REPLACE FUNCTION public.replace_student_availability(
    p_actor_auth_id UUID,
    p_student_id UUID,
    p_course_id UUID,
    p_intervals JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_student_auth_id UUID;
    v_student_course_id UUID;
    v_item JSONB;
    v_starts_at TIMESTAMPTZ;
    v_ends_at TIMESTAMPTZ;
BEGIN
    -- 1. Input parameter non-null checks
    IF p_actor_auth_id IS NULL OR p_student_id IS NULL OR p_course_id IS NULL OR p_intervals IS NULL THEN
        RAISE EXCEPTION 'Invalid parameters for replace_student_availability' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(p_intervals) <> 'array' THEN
        RAISE EXCEPTION 'p_intervals must be a JSON array' USING ERRCODE = '22023';
    END IF;

    -- 2. Lock owning students row and verify ownership and course enrollment
    SELECT auth_id, course_id
      INTO v_student_auth_id, v_student_course_id
      FROM public.students
     WHERE id = p_student_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_student_auth_id <> p_actor_auth_id OR v_student_course_id <> p_course_id THEN
        RAISE EXCEPTION 'Actor is not authorized for student in course' USING ERRCODE = '42501';
    END IF;

    -- 3. Validate every interval before modifying any rows
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_intervals)
    LOOP
        IF jsonb_typeof(v_item) <> 'object' OR
           NOT (v_item ? 'start' AND v_item ? 'end') THEN
            RAISE EXCEPTION 'Each interval must be an object with start and end' USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_starts_at := (v_item->>'start')::TIMESTAMPTZ;
            v_ends_at := (v_item->>'end')::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid ISO timestamp in intervals' USING ERRCODE = '22007';
        END;

        IF v_starts_at IS NULL OR v_ends_at IS NULL THEN
            RAISE EXCEPTION 'Null timestamp in interval' USING ERRCODE = '22004';
        END IF;

        IF v_ends_at < v_starts_at + INTERVAL '30 minutes' THEN
            RAISE EXCEPTION 'Interval duration must be at least 30 minutes' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- 4. Delete existing availability for this student/course
    DELETE FROM public.student_availability
     WHERE student_id = p_student_id
       AND course_id = p_course_id;

    -- 5. Insert new availability intervals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_intervals)
    LOOP
        v_starts_at := (v_item->>'start')::TIMESTAMPTZ;
        v_ends_at := (v_item->>'end')::TIMESTAMPTZ;

        INSERT INTO public.student_availability (
            id,
            student_id,
            course_id,
            starts_at,
            ends_at,
            created_at
        ) VALUES (
            gen_random_uuid(),
            p_student_id,
            p_course_id,
            v_starts_at,
            v_ends_at,
            NOW()
        );
    END LOOP;
END;
$$;

-- Revoke all, grant service_role only
REVOKE ALL ON FUNCTION public.replace_student_availability(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_student_availability(UUID, UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.replace_student_availability(UUID, UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_student_availability(UUID, UUID, UUID, JSONB) TO service_role;

COMMIT;
