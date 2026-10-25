-- Migration: 20261023200008_poll_lifecycle_guards.sql
-- Description: Enforce atomic poll lifecycle transitions, single-active poll constraint, and response admission.

-- 1. Ensure no existing duplicate active polls exist before creating partial unique index
DO $$
DECLARE
  v_dup_lecture_id uuid;
BEGIN
  SELECT lecture_id INTO v_dup_lecture_id
  FROM public.poll_questions
  WHERE status = 'active'
  GROUP BY lecture_id
  HAVING count(*) > 1
  LIMIT 1;

  IF v_dup_lecture_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create unique index: lecture % has multiple active polls', v_dup_lecture_id;
  END IF;
END $$;

CREATE UNIQUE INDEX idx_poll_questions_single_active
ON public.poll_questions (lecture_id)
WHERE status = 'active';

-- 2. Transition Poll RPC
CREATE OR REPLACE FUNCTION public.transition_poll(
  p_actor_auth_id uuid,
  p_poll_id uuid,
  p_target_status text,
  p_occurred_at timestamptz
)
RETURNS SETOF public.poll_questions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_poll public.poll_questions%ROWTYPE;
  v_lecture public.lecture_sessions%ROWTYPE;
  v_lecture_id uuid;
  v_course_id uuid;
  v_active_poll_id uuid;
BEGIN
  -- Validate inputs
  IF p_actor_auth_id IS NULL OR p_poll_id IS NULL OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'transition_poll: required argument is null'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_status IS NULL OR p_target_status NOT IN ('active', 'closed') THEN
    RAISE EXCEPTION 'transition_poll: invalid target status % (must be active or closed)', p_target_status
      USING ERRCODE = '22023';
  END IF;

  -- Verify existence and resolve lecture/course through teacher ownership
  SELECT pq.lecture_id, ls.course_id
  INTO v_lecture_id, v_course_id
  FROM public.poll_questions pq
  JOIN public.lecture_sessions ls ON ls.id = pq.lecture_id
  JOIN public.courses c ON c.id = ls.course_id
  JOIN public.teachers t ON t.id = c.teacher_id
  WHERE pq.id = p_poll_id
    AND t.auth_id = p_actor_auth_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found or actor is not the authorized teacher'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock lecture_sessions row FOR UPDATE before locking poll row
  SELECT * INTO v_lecture
  FROM public.lecture_sessions
  WHERE id = v_lecture_id
  FOR UPDATE;

  -- Verify lecture status is live
  IF v_lecture.status <> 'live' THEN
    RAISE EXCEPTION 'INVALID_LECTURE_STATUS: lecture % status is %, expected live', v_lecture.id, v_lecture.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock and re-read the target poll row FOR UPDATE
  SELECT * INTO v_poll
  FROM public.poll_questions
  WHERE id = p_poll_id
  FOR UPDATE;

  IF p_target_status = 'active' THEN
    IF v_poll.status <> 'draft' THEN
      RAISE EXCEPTION 'INVALID_POLL_STATUS: poll % status is %, expected draft for activation', p_poll_id, v_poll.status
        USING ERRCODE = 'P0001';
    END IF;

    -- Check under the lecture lock for any other active poll
    SELECT id INTO v_active_poll_id
    FROM public.poll_questions
    WHERE lecture_id = v_poll.lecture_id
      AND status = 'active'
      AND id <> p_poll_id
    LIMIT 1;

    IF v_active_poll_id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_POLL_EXISTS: lecture % already has active poll %', v_poll.lecture_id, v_active_poll_id
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.poll_questions
    SET status = 'active',
        activated_at = p_occurred_at
    WHERE id = p_poll_id
    RETURNING * INTO v_poll;

  ELSIF p_target_status = 'closed' THEN
    IF v_poll.status <> 'active' THEN
      RAISE EXCEPTION 'INVALID_POLL_STATUS: poll % status is %, expected active for closure', p_poll_id, v_poll.status
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.poll_questions
    SET status = 'closed',
        closed_at = p_occurred_at
    WHERE id = p_poll_id
    RETURNING * INTO v_poll;
  END IF;

  RETURN NEXT v_poll;
END;
$$;

-- 3. Response Admission RPC
CREATE OR REPLACE FUNCTION public.ingest_poll_response(
  p_actor_auth_id uuid,
  p_poll_id uuid,
  p_response_id uuid,
  p_answer text,
  p_answered_at timestamptz
)
RETURNS TABLE(response jsonb, inserted boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_student_id uuid;
  v_lecture_id uuid;
  v_course_id uuid;
  v_lecture public.lecture_sessions%ROWTYPE;
  v_poll public.poll_questions%ROWTYPE;
  v_existing public.poll_responses%ROWTYPE;
  v_inserted public.poll_responses%ROWTYPE;
  v_concept_in_course boolean;
BEGIN
  -- Validate inputs
  IF p_actor_auth_id IS NULL OR p_poll_id IS NULL OR p_response_id IS NULL OR p_answered_at IS NULL THEN
    RAISE EXCEPTION 'ingest_poll_response: required argument is null'
      USING ERRCODE = '22023';
  END IF;

  IF p_answer IS NULL OR btrim(p_answer) = '' THEN
    RAISE EXCEPTION 'ingest_poll_response: answer cannot be blank or whitespace-only'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve poll, lecture, course, and enrolled student from actor_auth_id
  SELECT pq.lecture_id, s.id, ls.course_id
  INTO v_lecture_id, v_student_id, v_course_id
  FROM public.poll_questions pq
  JOIN public.lecture_sessions ls ON ls.id = pq.lecture_id
  JOIN public.students s ON s.course_id = ls.course_id
  WHERE pq.id = p_poll_id
    AND s.auth_id = p_actor_auth_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found or actor is not an enrolled student in this course'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock lecture row FOR UPDATE
  SELECT * INTO v_lecture
  FROM public.lecture_sessions
  WHERE id = v_lecture_id
  FOR UPDATE;

  -- Lock and read poll row FOR UPDATE
  SELECT * INTO v_poll
  FROM public.poll_questions
  WHERE id = p_poll_id
  FOR UPDATE;

  -- Require live lecture
  IF v_lecture.status <> 'live' THEN
    RAISE EXCEPTION 'INVALID_LECTURE_STATUS: lecture % status is %, expected live', v_lecture.id, v_lecture.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Require active poll
  IF v_poll.status <> 'active' THEN
    RAISE EXCEPTION 'INVALID_POLL_STATUS: poll % status is %, expected active', p_poll_id, v_poll.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Verify poll concept belongs to lecture course
  SELECT EXISTS(
    SELECT 1 FROM public.concept_nodes
    WHERE id = v_poll.concept_id AND course_id = v_course_id
  ) INTO v_concept_in_course;

  IF NOT v_concept_in_course THEN
    RAISE EXCEPTION 'Concept % does not belong to course %', v_poll.concept_id, v_course_id
      USING ERRCODE = '42501';
  END IF;

  -- Lock existing response if present
  SELECT * INTO v_existing
  FROM public.poll_responses
  WHERE question_id = p_poll_id
    AND student_id = v_student_id
  FOR UPDATE;

  IF FOUND THEN
    -- Raw byte text equality
    IF v_existing.answer = p_answer THEN
      response := to_jsonb(v_existing);
      inserted := false;
      RETURN NEXT;
      RETURN;
    ELSE
      RAISE EXCEPTION 'RESPONSE_ALREADY_SUBMITTED: student % already submitted a different answer to poll %', v_student_id, p_poll_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Insert new pending response
  INSERT INTO public.poll_responses (
    id,
    question_id,
    student_id,
    answer,
    status,
    evaluation,
    answered_at
  ) VALUES (
    p_response_id,
    p_poll_id,
    v_student_id,
    p_answer,
    'pending',
    NULL,
    p_answered_at
  )
  RETURNING * INTO v_inserted;

  response := to_jsonb(v_inserted);
  inserted := true;
  RETURN NEXT;
  RETURN;
END;
$$;

-- 4. Revoke and grant privileges: service_role only
REVOKE EXECUTE ON FUNCTION public.transition_poll(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_poll(uuid, uuid, text, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_poll_response(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_poll_response(uuid, uuid, uuid, text, timestamptz) TO service_role;
