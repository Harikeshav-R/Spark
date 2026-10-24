-- ============================================================================
-- Migration: 20261022005107_commit_knowledge_graph.sql
-- Description: Transactional commit of course knowledge graph and mastery init
-- Lane: Lane A (Platform)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.commit_knowledge_graph(
    p_actor_auth_id UUID,
    p_course_id UUID,
    p_nodes JSONB,
    p_edges JSONB
)
RETURNS TABLE (node_count INTEGER, edge_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_teacher_auth_id UUID;
    v_node_count INTEGER;
    v_edge_count INTEGER;
    v_edge_inserted INTEGER;
    v_has_cycle BOOLEAN;
BEGIN
    -- 1. Validate required non-null parameters and array types
    IF p_actor_auth_id IS NULL OR p_course_id IS NULL OR p_nodes IS NULL OR p_edges IS NULL THEN
        RAISE EXCEPTION 'All parameters (p_actor_auth_id, p_course_id, p_nodes, p_edges) are required'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(p_nodes) != 'array' OR jsonb_typeof(p_edges) != 'array' THEN
        RAISE EXCEPTION 'Parameters p_nodes and p_edges must be JSON arrays'
            USING ERRCODE = '22023';
    END IF;

    -- 2. Lock course FOR UPDATE and verify teacher authorization
    SELECT t.auth_id INTO v_teacher_auth_id
    FROM public.courses c
    JOIN public.teachers t ON t.id = c.teacher_id
    WHERE c.id = p_course_id
    FOR UPDATE OF c;

    IF NOT FOUND THEN
        IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = p_course_id) THEN
            RAISE EXCEPTION 'Course % not found', p_course_id
                USING ERRCODE = 'P0002';
        ELSE
            RAISE EXCEPTION 'Teacher record not found for course %', p_course_id
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF v_teacher_auth_id IS DISTINCT FROM p_actor_auth_id THEN
        RAISE EXCEPTION 'Actor % is not authorized teacher for course %', p_actor_auth_id, p_course_id
            USING ERRCODE = '42501';
    END IF;

    -- 3. Invariant check: Course must not already have concept nodes committed
    IF EXISTS (SELECT 1 FROM public.concept_nodes WHERE course_id = p_course_id) THEN
        RAISE EXCEPTION 'GRAPH_ALREADY_EXISTS'
            USING ERRCODE = 'P0001';
    END IF;

    -- 4. Validate payload shape and topology bounds
    v_node_count := jsonb_array_length(p_nodes);
    IF v_node_count < 1 OR v_node_count > 40 THEN
        RAISE EXCEPTION 'INVALID_GRAPH: concept count must be between 1 and 40, got %', v_node_count
            USING ERRCODE = 'P0001';
    END IF;

    -- Check node shape
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_nodes) AS elem
        WHERE jsonb_typeof(elem) != 'object'
           OR jsonb_typeof(elem->'label') != 'string'
           OR length(elem->>'label') < 1
           OR length(elem->>'label') > 255
           OR jsonb_typeof(elem->'description') != 'string'
           OR jsonb_typeof(elem->'category') != 'string'
           OR length(elem->>'category') > 100
           OR jsonb_typeof(elem->'difficulty') != 'number'
           OR (elem->>'difficulty')::NUMERIC != (elem->>'difficulty')::INT
           OR (elem->>'difficulty')::INT < 1
           OR (elem->>'difficulty')::INT > 5
           OR (elem ? 'x' AND jsonb_typeof(elem->'x') != 'null' AND jsonb_typeof(elem->'x') != 'number')
           OR (elem ? 'y' AND jsonb_typeof(elem->'y') != 'null' AND jsonb_typeof(elem->'y') != 'number')
    ) THEN
        RAISE EXCEPTION 'INVALID_GRAPH: malformed concept node in payload'
            USING ERRCODE = '22023';
    END IF;

    -- Check unique node labels
    IF (
        SELECT count(DISTINCT elem->>'label')
        FROM jsonb_array_elements(p_nodes) AS elem
    ) != v_node_count THEN
        RAISE EXCEPTION 'INVALID_GRAPH: duplicate concept label'
            USING ERRCODE = 'P0001';
    END IF;

    -- Check edge shape
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_edges) AS elem
        WHERE jsonb_typeof(elem) != 'array'
           OR jsonb_array_length(elem) != 2
           OR jsonb_typeof(elem->0) != 'string'
           OR jsonb_typeof(elem->1) != 'string'
           OR length(elem->>0) < 1
           OR length(elem->>0) > 255
           OR length(elem->>1) < 1
           OR length(elem->>1) > 255
    ) THEN
        RAISE EXCEPTION 'INVALID_GRAPH: malformed concept edge in payload'
            USING ERRCODE = '22023';
    END IF;

    -- Check self-edges
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_edges) AS elem
        WHERE (elem->>0) = (elem->>1)
    ) THEN
        RAISE EXCEPTION 'INVALID_GRAPH: self-edge detected'
            USING ERRCODE = 'P0001';
    END IF;

    -- Check edge endpoints
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_edges) AS elem
        WHERE (elem->>0) NOT IN (SELECT n->>'label' FROM jsonb_array_elements(p_nodes) AS n)
           OR (elem->>1) NOT IN (SELECT n->>'label' FROM jsonb_array_elements(p_nodes) AS n)
    ) THEN
        RAISE EXCEPTION 'INVALID_GRAPH: edge endpoint not found'
            USING ERRCODE = 'P0001';
    END IF;

    -- Check unique directed edges
    v_edge_count := jsonb_array_length(p_edges);
    IF (
        SELECT count(DISTINCT (elem->>0, elem->>1))
        FROM jsonb_array_elements(p_edges) AS elem
    ) != v_edge_count THEN
        RAISE EXCEPTION 'INVALID_GRAPH: duplicate edge'
            USING ERRCODE = 'P0001';
    END IF;

    -- Cycle check via reachability CTE
    IF v_edge_count > 0 THEN
        WITH RECURSIVE reachability AS (
            SELECT DISTINCT elem->>0 AS source_label, elem->>1 AS target_label
            FROM jsonb_array_elements(p_edges) AS elem
            UNION
            SELECT r.source_label, e->>1 AS target_label
            FROM reachability r
            JOIN jsonb_array_elements(p_edges) AS e ON r.target_label = e->>0
        )
        SELECT EXISTS (
            SELECT 1 FROM reachability WHERE source_label = target_label
        ) INTO v_has_cycle;

        IF v_has_cycle THEN
            RAISE EXCEPTION 'INVALID_GRAPH: cycle detected'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 5. Insert concept nodes
    INSERT INTO public.concept_nodes (
        course_id,
        label,
        description,
        category,
        difficulty,
        x,
        y
    )
    SELECT
        p_course_id,
        elem->>'label',
        elem->>'description',
        elem->>'category',
        (elem->>'difficulty')::INT,
        CASE WHEN elem ? 'x' AND jsonb_typeof(elem->'x') = 'number' THEN (elem->>'x')::FLOAT ELSE NULL END,
        CASE WHEN elem ? 'y' AND jsonb_typeof(elem->'y') = 'number' THEN (elem->>'y')::FLOAT ELSE NULL END
    FROM jsonb_array_elements(p_nodes) AS elem;

    -- 6. Insert concept edges
    IF v_edge_count > 0 THEN
        INSERT INTO public.concept_edges (
            course_id,
            source_id,
            target_id,
            relationship
        )
        SELECT
            p_course_id,
            s.id,
            t.id,
            'prerequisite'
        FROM jsonb_array_elements(p_edges) AS elem
        JOIN public.concept_nodes s ON s.course_id = p_course_id AND s.label = elem->>0
        JOIN public.concept_nodes t ON t.course_id = p_course_id AND t.label = elem->>1;

        GET DIAGNOSTICS v_edge_inserted = ROW_COUNT;
        IF v_edge_inserted != v_edge_count THEN
            RAISE EXCEPTION 'Failed to insert all concept edges'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 7. Initialize student mastery for all existing enrolled students
    INSERT INTO public.student_mastery (
        student_id,
        concept_id,
        confidence,
        attempts,
        version
    )
    SELECT
        s.id,
        cn.id,
        0.0,
        0,
        1
    FROM public.students s
    CROSS JOIN public.concept_nodes cn
    WHERE s.course_id = p_course_id
      AND cn.course_id = p_course_id
    ON CONFLICT (student_id, concept_id) DO NOTHING;

    -- 8. Return counts
    RETURN QUERY SELECT v_node_count, v_edge_count;
END;
$$;

-- Revoke execute from public/anon/authenticated; grant exclusively to service_role
REVOKE ALL ON FUNCTION public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_knowledge_graph(UUID, UUID, JSONB, JSONB) TO service_role;
