-- Migration: 20261024023802_game_progression.sql
-- Description: Transactional practice reward and quest clear RPC for Spark game progression

BEGIN;

CREATE OR REPLACE FUNCTION public.record_practice_reward(
    p_actor_auth_id UUID,
    p_student_id UUID,
    p_attempt_id UUID,
    p_answers JSONB,
    p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_student RECORD;
    v_attempt RECORD;
    v_encounter RECORD;
    v_quest RECORD;
    v_award_date DATE;
    v_practice_xp INT := 0;
    v_xp_awarded INT := 0;
    v_inserted_xp INT;
    v_changed BOOLEAN := FALSE;
    v_correct_count INT := 0;
    v_answer_record JSONB;
    v_hints_used INT;
    v_is_correct BOOLEAN;
    v_expected_hint INT;
    v_new_completed_ids UUID[] := '{}';
    v_all_completed BOOLEAN := FALSE;
    v_cleared_at TIMESTAMPTZ := NULL;
    v_mutation_time TIMESTAMPTZ;
    v_res_quest JSONB := NULL;
    v_i INT;
BEGIN
    -- 1. Input presence validation
    IF p_actor_auth_id IS NULL OR p_student_id IS NULL OR p_attempt_id IS NULL OR p_now IS NULL THEN
        RAISE EXCEPTION 'Required parameter is null' USING ERRCODE = '22023';
    END IF;

    -- Validate p_answers is JSONB array with exactly 5 elements
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) <> 5 THEN
        RAISE EXCEPTION 'Answers must be a JSON array of exactly 5 items' USING ERRCODE = '22023';
    END IF;

    -- 2. Lock student row first (enforces single serialization order for student)
    SELECT id, auth_id, course_id, created_at
    INTO v_student
    FROM public.students
    WHERE id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found: %', p_student_id USING ERRCODE = 'P0002';
    END IF;

    -- Verify actor authorization
    IF v_student.auth_id <> p_actor_auth_id THEN
        RAISE EXCEPTION 'Actor is not authorized for student %', p_student_id USING ERRCODE = '42501';
    END IF;

    -- 3. Validate quiz attempt
    SELECT id, student_id, concept_id, score, correct_count, total_questions, encounter_id, submitted_at
    INTO v_attempt
    FROM public.quiz_attempts
    WHERE id = p_attempt_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz attempt not found: %', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.student_id <> p_student_id THEN
        RAISE EXCEPTION 'Quiz attempt does not belong to student' USING ERRCODE = '42501';
    END IF;

    IF v_attempt.total_questions <> 5 THEN
        RAISE EXCEPTION 'Quiz attempt must have total_questions = 5' USING ERRCODE = '22023';
    END IF;

    IF v_attempt.correct_count < 0 OR v_attempt.correct_count > 5 THEN
        RAISE EXCEPTION 'Quiz attempt correct_count must be in 0..5' USING ERRCODE = '22023';
    END IF;

    IF abs(v_attempt.score - (v_attempt.correct_count::FLOAT / 5.0)) > 0.001 THEN
        RAISE EXCEPTION 'Quiz attempt score does not match correct_count' USING ERRCODE = '22023';
    END IF;

    IF v_attempt.submitted_at > p_now THEN
        RAISE EXCEPTION 'Quiz attempt submitted_at cannot be in the future relative to server time' USING ERRCODE = '22023';
    END IF;

    -- Verify concept belongs to the same course as student
    IF NOT EXISTS (
        SELECT 1 FROM public.concept_nodes
        WHERE id = v_attempt.concept_id AND course_id = v_student.course_id
    ) THEN
        RAISE EXCEPTION 'Concept does not belong to student course' USING ERRCODE = '22023';
    END IF;

    -- 4. Lock and validate encounter if linked
    IF v_attempt.encounter_id IS NOT NULL THEN
        SELECT id, student_id, concept_id, question_ids, hints_used
        INTO v_encounter
        FROM public.encounters
        WHERE id = v_attempt.encounter_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Linked encounter not found: %', v_attempt.encounter_id USING ERRCODE = 'P0002';
        END IF;

        IF v_encounter.student_id <> p_student_id OR v_encounter.concept_id <> v_attempt.concept_id THEN
            RAISE EXCEPTION 'Linked encounter does not match student and concept' USING ERRCODE = '22023';
        END IF;

        IF array_length(v_encounter.question_ids, 1) <> 5 THEN
            RAISE EXCEPTION 'Linked encounter question_ids must have length 5' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 5. Validate answers array elements & calculate practice XP
    v_correct_count := 0;
    v_practice_xp := 0;

    FOR v_i IN 0..4 LOOP
        v_answer_record := p_answers -> v_i;

        IF v_answer_record IS NULL OR jsonb_typeof(v_answer_record) <> 'object' THEN
            RAISE EXCEPTION 'Answer item at index % is not an object', v_i USING ERRCODE = '22023';
        END IF;

        IF jsonb_typeof(v_answer_record -> 'correct') <> 'boolean' THEN
            RAISE EXCEPTION 'Answer item at index % missing boolean correct field', v_i USING ERRCODE = '22023';
        END IF;

        IF jsonb_typeof(v_answer_record -> 'hintsUsed') <> 'number' THEN
            RAISE EXCEPTION 'Answer item at index % missing numeric hintsUsed field', v_i USING ERRCODE = '22023';
        END IF;

        v_is_correct := (v_answer_record ->> 'correct')::BOOLEAN;
        v_hints_used := (v_answer_record ->> 'hintsUsed')::INT;

        IF v_hints_used < 0 OR v_hints_used > 3 THEN
            RAISE EXCEPTION 'hintsUsed must be between 0 and 3 at index %', v_i USING ERRCODE = '22023';
        END IF;

        IF v_is_correct THEN
            v_correct_count := v_correct_count + 1;
            v_practice_xp := v_practice_xp + GREATEST(8, 30 - 6 * v_hints_used);
        ELSE
            v_practice_xp := v_practice_xp + 8;
        END IF;

        -- Verify hint count against encounter or standalone attempt
        IF v_attempt.encounter_id IS NOT NULL THEN
            v_expected_hint := COALESCE((v_encounter.hints_used ->> ((v_i + 1)::TEXT))::INT, 0);
            IF v_hints_used <> v_expected_hint THEN
                RAISE EXCEPTION 'hintsUsed % at index % does not match persisted encounter hint %',
                    v_hints_used, v_i, v_expected_hint USING ERRCODE = '22023';
            END IF;
        ELSE
            IF v_hints_used <> 0 THEN
                RAISE EXCEPTION 'hintsUsed must be 0 for standalone quiz attempts without encounter' USING ERRCODE = '22023';
            END IF;
        END IF;
    END LOOP;

    IF v_correct_count <> v_attempt.correct_count THEN
        RAISE EXCEPTION 'Answers correct count (%) does not match attempt correct_count (%)',
            v_correct_count, v_attempt.correct_count USING ERRCODE = '22023';
    END IF;

    -- 6. Verify matching quiz mastery evidence exists
    IF NOT EXISTS (
        SELECT 1 FROM public.mastery_evidence
        WHERE evidence_type = 'quiz'
          AND source_id = p_attempt_id
          AND student_id = p_student_id
          AND concept_id = v_attempt.concept_id
    ) THEN
        RAISE EXCEPTION 'Matching quiz mastery evidence not found for attempt %', p_attempt_id USING ERRCODE = 'P0002';
    END IF;

    -- 7. Insert practice XP into xp_events ledger
    v_award_date := (v_attempt.submitted_at AT TIME ZONE 'UTC')::DATE;

    INSERT INTO public.xp_events (
        student_id,
        amount,
        reason,
        source_id,
        award_date,
        concept_id,
        created_at
    )
    VALUES (
        p_student_id,
        v_practice_xp,
        'encounter',
        p_attempt_id,
        v_award_date,
        v_attempt.concept_id,
        p_now
    )
    ON CONFLICT (student_id, concept_id, award_date) WHERE reason = 'encounter'
    DO NOTHING
    RETURNING amount INTO v_inserted_xp;

    IF v_inserted_xp IS NOT NULL THEN
        v_xp_awarded := v_inserted_xp;
        v_changed := TRUE;
    ELSE
        v_xp_awarded := 0;
    END IF;

    -- 8. Daily Quest completion & clear check
    SELECT id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at
    INTO v_quest
    FROM public.daily_quests
    WHERE student_id = p_student_id AND quest_date = v_award_date
    FOR UPDATE;

    IF FOUND THEN
        -- Check if attempt concept is in quest
        IF v_attempt.concept_id = ANY(v_quest.concept_ids) THEN
            -- Check if not already completed
            IF NOT (v_attempt.concept_id = ANY(v_quest.completed_ids)) THEN
                v_changed := TRUE;

                -- Build new_completed_ids preserving concept_ids order
                SELECT COALESCE(array_agg(cid ORDER BY ord), '{}'::UUID[])
                INTO v_new_completed_ids
                FROM (
                    SELECT cid, ord
                    FROM unnest(v_quest.concept_ids) WITH ORDINALITY AS t(cid, ord)
                    WHERE cid = ANY(v_quest.completed_ids) OR cid = v_attempt.concept_id
                ) s;

                -- Check if all items in quest are now completed
                v_all_completed := (
                    array_length(v_new_completed_ids, 1) = array_length(v_quest.concept_ids, 1)
                    AND COALESCE(array_length(v_quest.concept_ids, 1), 0) > 0
                );

                IF v_all_completed AND v_quest.cleared_at IS NULL THEN
                    v_cleared_at := p_now;

                    UPDATE public.daily_quests
                    SET completed_ids = v_new_completed_ids,
                        cleared_at = v_cleared_at,
                        version = v_quest.version + 1,
                        updated_at = p_now
                    WHERE id = v_quest.id
                    RETURNING id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at
                    INTO v_quest;

                    -- Insert 25 XP bonus for quest clear
                    INSERT INTO public.xp_events (
                        student_id,
                        amount,
                        reason,
                        source_id,
                        award_date,
                        concept_id,
                        created_at
                    )
                    VALUES (
                        p_student_id,
                        25,
                        'quest_cleared',
                        v_quest.id,
                        v_award_date,
                        NULL,
                        p_now
                    )
                    ON CONFLICT (student_id, award_date) WHERE reason = 'quest_cleared'
                    DO NOTHING;
                ELSE
                    UPDATE public.daily_quests
                    SET completed_ids = v_new_completed_ids,
                        version = v_quest.version + 1,
                        updated_at = p_now
                    WHERE id = v_quest.id
                    RETURNING id, student_id, quest_date, concept_ids, completed_ids, cleared_at, version, created_at, updated_at
                    INTO v_quest;
                END IF;
            END IF;
        END IF;

        v_res_quest := jsonb_build_object(
            'id', v_quest.id,
            'student_id', v_quest.student_id,
            'quest_date', v_quest.quest_date::TEXT,
            'concept_ids', to_jsonb(v_quest.concept_ids),
            'completed_ids', to_jsonb(v_quest.completed_ids),
            'cleared_at', CASE WHEN v_quest.cleared_at IS NOT NULL THEN to_char(v_quest.cleared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
            'version', v_quest.version,
            'created_at', to_char(v_quest.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'updated_at', to_char(v_quest.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        );
    END IF;

    IF v_changed THEN
        v_mutation_time := p_now;
    ELSE
        v_mutation_time := COALESCE(v_quest.updated_at, v_attempt.submitted_at);
    END IF;

    RETURN jsonb_build_object(
        'xp_awarded', v_xp_awarded,
        'quest', v_res_quest,
        'changed', v_changed,
        'updated_at', to_char(v_mutation_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
END;
$$;

-- Revoke execute from public/anon/authenticated; grant to service_role only
REVOKE ALL ON FUNCTION public.record_practice_reward(UUID, UUID, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_practice_reward(UUID, UUID, UUID, JSONB, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.record_practice_reward(UUID, UUID, UUID, JSONB, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_practice_reward(UUID, UUID, UUID, JSONB, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
