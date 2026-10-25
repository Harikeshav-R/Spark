-- Migration: 20261024040001_party_quest_lifecycle.sql
-- Description: Transactional RPCs for study group invitation acceptance and party quest progress/completion

BEGIN;

-- ============================================================================
-- 1. Respond Study Group Invitation RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.respond_study_group_invitation(
    p_actor_auth_id UUID,
    p_invitation_id UUID,
    p_decision TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_invitation RECORD;
    v_invitee_student_id UUID;
    v_s1 UUID;
    v_s2 UUID;
    v_locked_count INT;
    v_now TIMESTAMPTZ;
    v_p1 RECORD;
    v_p2 RECORD;
    v_gap FLOAT;
    v_total_diff FLOAT;
    v_mastery_count INT;
    v_match_id UUID;
BEGIN
    -- 1. Input validation
    IF p_actor_auth_id IS NULL OR p_invitation_id IS NULL OR p_decision IS NULL THEN
        RAISE EXCEPTION 'Required parameter is null' USING ERRCODE = '22023';
    END IF;

    IF p_decision NOT IN ('accepted', 'declined') THEN
        RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
    END IF;

    -- 2. Lock invitation row
    SELECT *
    INTO v_invitation
    FROM public.study_group_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found: %', p_invitation_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Verify authenticated actor owns the invitee student record in this course
    SELECT s.id
    INTO v_invitee_student_id
    FROM public.students s
    WHERE s.id = v_invitation.invitee_student_id
      AND s.auth_id = p_actor_auth_id
      AND s.course_id = v_invitation.course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actor is not authorized as the invitee for this invitation' USING ERRCODE = '42501';
    END IF;

    -- Verify inviter is still enrolled in the course
    IF NOT EXISTS (
        SELECT 1
        FROM public.students
        WHERE id = v_invitation.inviter_student_id
          AND course_id = v_invitation.course_id
    ) THEN
        RAISE EXCEPTION 'Inviter is no longer enrolled in the course' USING ERRCODE = '55000';
    END IF;

    -- 4. Terminal state idempotency and conflict checks
    IF v_invitation.status = p_decision THEN
        RETURN jsonb_build_object(
            'status', v_invitation.status,
            'matchId', v_invitation.resulting_match_id,
            'changed', false
        );
    END IF;

    IF v_invitation.status IN ('accepted', 'declined') AND v_invitation.status <> p_decision THEN
        RAISE EXCEPTION 'Invitation already finalized with conflicting decision: %', v_invitation.status USING ERRCODE = '55000';
    END IF;

    IF v_invitation.status = 'expired' THEN
        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', false
        );
    END IF;

    IF v_invitation.status <> 'pending' THEN
        RAISE EXCEPTION 'Invalid invitation status: %', v_invitation.status USING ERRCODE = '55000';
    END IF;

    -- 5. Handle decline decision
    IF p_decision = 'declined' THEN
        UPDATE public.study_group_invitations
        SET status = 'declined'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'declined',
            'matchId', NULL,
            'changed', true
        );
    END IF;

    -- 6. Handle accepted decision
    -- Canonical student ID ordering
    IF v_invitation.inviter_student_id < v_invitation.invitee_student_id THEN
        v_s1 := v_invitation.inviter_student_id;
        v_s2 := v_invitation.invitee_student_id;
    ELSE
        v_s1 := v_invitation.invitee_student_id;
        v_s2 := v_invitation.inviter_student_id;
    END IF;

    -- Lock both pool rows in canonical student order
    PERFORM 1
    FROM public.study_group_pool
    WHERE course_id = v_invitation.course_id
      AND student_id IN (v_s1, v_s2)
    ORDER BY student_id
    FOR UPDATE;

    GET DIAGNOSTICS v_locked_count = ROW_COUNT;

    IF v_locked_count <> 2 THEN
        UPDATE public.study_group_invitations
        SET status = 'expired'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', true
        );
    END IF;
    -- Capture database timestamp after lock acquisition
    v_now := clock_timestamp();

    -- Check invitation expiration
    IF v_invitation.expires_at < v_now THEN
        UPDATE public.study_group_invitations
        SET status = 'expired'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', true
        );
    END IF;

    -- Load and verify both pool entries
    SELECT * INTO v_p1
    FROM public.study_group_pool
    WHERE course_id = v_invitation.course_id AND student_id = v_s1;

    SELECT * INTO v_p2
    FROM public.study_group_pool
    WHERE course_id = v_invitation.course_id AND student_id = v_s2;

    -- Both entries must be waiting, unexpired, and not re-created after invitation
    IF v_p1.status <> 'waiting' OR v_p2.status <> 'waiting'
       OR v_p1.expires_at < v_now OR v_p2.expires_at < v_now
       OR v_p1.created_at > v_invitation.created_at OR v_p2.created_at > v_invitation.created_at THEN
        UPDATE public.study_group_invitations
        SET status = 'expired'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', true
        );
    END IF;

    -- Verify invitation concepts belong to both pool entries
    IF NOT (v_invitation.concept_ids <@ v_p1.concept_ids AND v_invitation.concept_ids <@ v_p2.concept_ids) THEN
        UPDATE public.study_group_invitations
        SET status = 'expired'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', true
        );
    END IF;

    -- Validate mastery data integrity: confidence must be finite in [0.0, 1.0]
    IF EXISTS (
        SELECT 1
        FROM public.student_mastery
        WHERE student_id IN (v_s1, v_s2)
          AND concept_id = ANY(v_invitation.concept_ids)
          AND (confidence IS NULL OR confidence < 0.0 OR confidence > 1.0)
    ) THEN
        RAISE EXCEPTION 'Invalid present confidence encountered in mastery' USING ERRCODE = 'XX000';
    END IF;

    -- Check unrounded gap on invitation concepts
    SELECT
        count(*),
        sum(abs(m1.confidence - m2.confidence))
    INTO v_mastery_count, v_total_diff
    FROM unnest(v_invitation.concept_ids) AS cid
    JOIN public.student_mastery m1 ON m1.student_id = v_invitation.inviter_student_id AND m1.concept_id = cid
    JOIN public.student_mastery m2 ON m2.student_id = v_invitation.invitee_student_id AND m2.concept_id = cid;

    IF v_mastery_count <> cardinality(v_invitation.concept_ids) THEN
        -- Missing mastery makes acceptance ineligible
        UPDATE public.study_group_invitations
        SET status = 'expired'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', true
        );
    END IF;

    v_gap := v_total_diff / v_mastery_count;
    IF v_gap < 0.30 THEN
        -- Current gap below 0.30 makes invitation expired/ineligible
        UPDATE public.study_group_invitations
        SET status = 'expired'
        WHERE id = p_invitation_id;

        RETURN jsonb_build_object(
            'status', 'expired',
            'matchId', NULL,
            'changed', true
        );
    END IF;

    -- Delegate atomic pool claiming and match creation
    v_match_id := public.claim_and_create_match(
        v_invitation.course_id,
        v_invitation.inviter_student_id,
        v_invitation.invitee_student_id,
        v_invitation.concept_ids
    );

    UPDATE public.study_group_invitations
    SET status = 'accepted',
        resulting_match_id = v_match_id
    WHERE id = p_invitation_id;

    RETURN jsonb_build_object(
        'status', 'accepted',
        'matchId', v_match_id,
        'changed', true
    );
END;
$$;

-- ============================================================================
-- 2. Record Party Quest Progress RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_party_quest_progress(
    p_actor_auth_id UUID,
    p_party_quest_id UUID,
    p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_quest RECORD;
    v_match RECORD;
    v_student RECORD;
    v_attempt RECORD;
    v_encounter RECORD;
    v_answer_qids UUID[];
    v_inserted_attempt_id UUID;
    v_completed_pairs INT;
    v_total_pairs INT;
    v_new_version INT;
    v_new_status TEXT;
    v_now TIMESTAMPTZ;
    v_changed BOOLEAN := FALSE;
    v_award_date DATE;
BEGIN
    -- 1. Input presence validation
    IF p_actor_auth_id IS NULL OR p_party_quest_id IS NULL OR p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is null' USING ERRCODE = '22023';
    END IF;

    -- 2. Lock party quest
    SELECT *
    INTO v_quest
    FROM public.party_quests
    WHERE id = p_party_quest_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Party quest not found: %', p_party_quest_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Lock and verify match
    SELECT *
    INTO v_match
    FROM public.study_group_matches
    WHERE id = v_quest.match_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Study group match not found: %', v_quest.match_id USING ERRCODE = 'P0002';
    END IF;

    -- Verify authenticated actor is one course-enrolled matched peer
    SELECT s.id, s.course_id
    INTO v_student
    FROM public.students s
    WHERE s.auth_id = p_actor_auth_id
      AND s.course_id = v_match.course_id
      AND s.id IN (v_match.student1_id, v_match.student2_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actor is not an authorized peer in this match' USING ERRCODE = '42501';
    END IF;

    -- 4. Quest status checks
    IF v_quest.status = 'cancelled' THEN
        RAISE EXCEPTION 'Party quest is cancelled' USING ERRCODE = '55000';
    END IF;

    -- Completed quests allow only valid already-recorded replays
    IF v_quest.status = 'completed' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.party_quest_progress
            WHERE party_quest_id = p_party_quest_id
              AND quiz_attempt_id = p_attempt_id
        ) THEN
            RAISE EXCEPTION 'Party quest is already completed' USING ERRCODE = '55000';
        END IF;
    END IF;

    -- 5. Validate quiz attempt
    SELECT *
    INTO v_attempt
    FROM public.quiz_attempts
    WHERE id = p_attempt_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz attempt not found: %', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id <> v_student.id THEN
        RAISE EXCEPTION 'Quiz attempt does not belong to student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.total_questions <> 5 THEN
        RAISE EXCEPTION 'Quiz attempt must have total_questions = 5' USING ERRCODE = '22023';
    END IF;

    IF NOT (v_attempt.concept_id = ANY(v_quest.concept_ids)) THEN
        RAISE EXCEPTION 'Quiz attempt concept does not belong to party quest' USING ERRCODE = '22023';
    END IF;

    IF v_attempt.submitted_answers IS NULL
       OR jsonb_typeof(v_attempt.submitted_answers) <> 'array'
       OR jsonb_array_length(v_attempt.submitted_answers) <> 5 THEN
        RAISE EXCEPTION 'Quiz attempt must have exactly 5 submitted answers' USING ERRCODE = '22023';
    END IF;

    -- 6. Validate encounter
    IF v_attempt.encounter_id IS NULL THEN
        RAISE EXCEPTION 'Quiz attempt must be linked to an encounter' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_encounter
    FROM public.encounters
    WHERE id = v_attempt.encounter_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Linked encounter not found: %', v_attempt.encounter_id USING ERRCODE = 'P0002';
    END IF;

    IF v_encounter.student_id <> v_student.id OR v_encounter.concept_id <> v_attempt.concept_id THEN
        RAISE EXCEPTION 'Linked encounter does not match student and concept' USING ERRCODE = '22023';
    END IF;

    IF v_encounter.source <> 'party' THEN
        RAISE EXCEPTION 'Linked encounter source must be party' USING ERRCODE = '22023';
    END IF;

    IF v_encounter.party_quest_id IS DISTINCT FROM p_party_quest_id THEN
        RAISE EXCEPTION 'Linked encounter party_quest_id does not match party quest' USING ERRCODE = '22023';
    END IF;

    IF v_encounter.status <> 'completed' THEN
        RAISE EXCEPTION 'Linked encounter is not completed' USING ERRCODE = '55000';
    END IF;

    -- Validate submitted answer question IDs match encounter question IDs exactly
    SELECT array_agg(DISTINCT (elem->>'question_id')::UUID)
    INTO v_answer_qids
    FROM jsonb_array_elements(v_attempt.submitted_answers) AS elem;

    IF v_answer_qids IS NULL OR cardinality(v_answer_qids) <> 5 THEN
        RAISE EXCEPTION 'Submitted answers must contain exactly 5 distinct question IDs' USING ERRCODE = '22023';
    END IF;

    IF NOT (v_answer_qids <@ v_encounter.question_ids AND v_encounter.question_ids <@ v_answer_qids) THEN
        RAISE EXCEPTION 'Submitted answer question IDs do not match encounter question IDs' USING ERRCODE = '22023';
    END IF;

    -- 7. Verify matching quiz mastery evidence exists
    IF NOT EXISTS (
        SELECT 1
        FROM public.mastery_evidence
        WHERE evidence_type = 'quiz'
          AND source_id = p_attempt_id
          AND student_id = v_student.id
          AND concept_id = v_attempt.concept_id
    ) THEN
        RAISE EXCEPTION 'Matching quiz mastery evidence not found for attempt %', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 8. Record progress
    v_now := clock_timestamp();
    v_total_pairs := 2 * cardinality(v_quest.concept_ids);

    INSERT INTO public.party_quest_progress (
        party_quest_id,
        student_id,
        concept_id,
        quiz_attempt_id,
        completed_at
    )
    VALUES (
        p_party_quest_id,
        v_student.id,
        v_attempt.concept_id,
        p_attempt_id,
        v_now
    )
    ON CONFLICT (party_quest_id, student_id, concept_id)
    DO NOTHING
    RETURNING quiz_attempt_id INTO v_inserted_attempt_id;

    SELECT count(*)
    INTO v_completed_pairs
    FROM public.party_quest_progress
    WHERE party_quest_id = p_party_quest_id;

    IF v_inserted_attempt_id IS NOT NULL THEN
        v_changed := TRUE;
        v_new_version := v_quest.version + 1;

        IF v_completed_pairs = v_total_pairs THEN
            v_new_status := 'completed';
            v_award_date := (v_now AT TIME ZONE 'UTC')::DATE;

            UPDATE public.party_quests
            SET status = 'completed',
                version = v_new_version,
                completed_at = v_now,
                updated_at = v_now
            WHERE id = p_party_quest_id;

            -- Atomically insert 60 XP for both peers in the match
            INSERT INTO public.xp_events (
                student_id,
                amount,
                reason,
                source_id,
                award_date,
                concept_id,
                created_at
            )
            VALUES
                (v_match.student1_id, 60, 'party', p_party_quest_id, v_award_date, NULL, v_now),
                (v_match.student2_id, 60, 'party', p_party_quest_id, v_award_date, NULL, v_now);
        ELSE
            v_new_status := v_quest.status;

            UPDATE public.party_quests
            SET version = v_new_version,
                updated_at = v_now
            WHERE id = p_party_quest_id;
        END IF;
    ELSE
        -- Duplicate progress attempt: change nothing
        v_changed := FALSE;
        v_new_version := v_quest.version;
        v_new_status := v_quest.status;
    END IF;

    RETURN jsonb_build_object(
        'partyQuestId', p_party_quest_id,
        'matchId', v_quest.match_id,
        'status', v_new_status,
        'version', v_new_version,
        'completedPairs', v_completed_pairs,
        'totalPairs', v_total_pairs,
        'occurredAt', v_now,
        'changed', v_changed
    );
END;
$$;

-- ============================================================================
-- 3. Access Privileges
-- ============================================================================

REVOKE ALL ON FUNCTION public.respond_study_group_invitation(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_study_group_invitation(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.respond_study_group_invitation(UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.respond_study_group_invitation(UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.respond_study_group_invitation(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_party_quest_progress(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_party_quest_progress(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.record_party_quest_progress(UUID, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.record_party_quest_progress(UUID, UUID, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.record_party_quest_progress(UUID, UUID, UUID) TO service_role;

-- ============================================================================
-- 4. Schema Cache Reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';

COMMIT;
