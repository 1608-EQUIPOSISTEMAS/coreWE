-- Historial de cambios de un aula (modal Auditoría del Cronograma).
-- Une audit_logs de: program_editions (padre e hijos), edition_structure
-- (vínculos padre-hijo) y edition_session_control (Control de Ediciones:
-- estados A/R/T y reprogramaciones por sesión; record_id = edition_num_id).
-- Fuente original: dump de la BD (13/07/2026) + bloque logs_session_control.
CREATE OR REPLACE PROCEDURE public.sp_audit_logs_get(IN p_edition_id integer DEFAULT NULL::integer, IN p_limit integer DEFAULT 50, IN p_offset integer DEFAULT 0, INOUT p_cur refcursor DEFAULT NULL::refcursor)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    IF p_cur IS NULL THEN
        p_cur := 'cur_audit_logs';
    END IF;

    OPEN p_cur FOR
    WITH
    -- ============================================================
    -- 1. IDs relevantes: padre + todos sus hijos actuales/históricos
    -- ============================================================
    relevant_ids AS (
        SELECT p_edition_id AS edition_id
        WHERE p_edition_id IS NOT NULL

        UNION

        SELECT child_edition_id
        FROM public.edition_structure
        WHERE parent_edition_id = p_edition_id

        UNION
        -- Hijos que pudieron haberse desvinculado (están en audit_logs de edition_structure)
        SELECT (changed_fields->'child_edition_id'->'new')::int
        FROM public.audit_logs
        WHERE table_name = 'edition_structure'
          AND (changed_fields ? 'child_edition_id' OR new_data ? 'child_edition_id')
          AND (
              (new_data->>'parent_edition_id')::int = p_edition_id
              OR (old_data->>'parent_edition_id')::int = p_edition_id
          )
    ),

    -- ============================================================
    -- 2. Pre-resolver catálogos y docentes para enriquecer changed_fields
    -- ============================================================
    catalog_map AS (
        SELECT catalog_id, description
        FROM public.catalog
    ),
    instructor_map AS (
        SELECT i.instructor_id,
               TRIM(p.first_name || ' ' || p.last_name ||
                    COALESCE(' ' || p.mother_last_name, '')) AS full_name
        FROM public.instructors i
        JOIN public.persons p ON p.person_id = i.person_id
    ),
    version_map AS (
        SELECT pv.program_version_id, pv.abbreviation,
               pg.program_name
        FROM public.program_versions pv
        JOIN public.programs pg ON pg.program_id = pv.program_id
    ),

    -- ============================================================
    -- 3. Audit logs de program_editions (padre e hijos)
    -- ============================================================
    logs_editions AS (
        SELECT
            al.id,
            al.transaction_id,
            al.created_at,
            al.user_id,
            al.table_name,
            al.record_id,
            al.action,
            al.changed_fields,
            al.old_data,
            al.new_data,
            edx.global_code,
            edx.specific_code,
            vm.abbreviation  AS program_abbreviation,
            vm.program_name,
            -- ¿Es hijo?
            CASE
                WHEN al.record_id = p_edition_id THEN false
                ELSE true
            END AS is_child,
            -- Resolver changed_fields: enriquecer cada campo con su label
            public.fn_resolve_edition_audit_fields(al.changed_fields) AS changed_fields_resolved
        FROM public.audit_logs al
        LEFT JOIN public.program_editions edx ON edx.edition_num_id = al.record_id
        LEFT JOIN version_map vm ON vm.program_version_id = edx.program_version_id
        WHERE al.table_name = 'program_editions'
          AND (
              p_edition_id IS NULL
              OR al.record_id IN (SELECT edition_id FROM relevant_ids)
          )
    ),

    -- ============================================================
    -- 4. Audit logs de edition_structure (vínculos padre-hijo)
    -- ============================================================
    logs_structure AS (
        SELECT
            al.id,
            al.transaction_id,
            al.created_at,
            al.user_id,
            al.table_name,
            al.record_id,
            al.action,
            al.changed_fields,
            al.old_data,
            al.new_data,
            -- Mostrar qué módulo fue vinculado/desvinculado
            COALESCE(
                (SELECT global_code FROM public.program_editions
                 WHERE edition_num_id = (COALESCE(al.new_data, al.old_data)->>'child_edition_id')::int),
                'Módulo eliminado'
            ) AS global_code,
            COALESCE(
                (SELECT specific_code FROM public.program_editions
                 WHERE edition_num_id = (COALESCE(al.new_data, al.old_data)->>'child_edition_id')::int),
                ''
            ) AS specific_code,
            COALESCE(
                (SELECT vm.abbreviation FROM public.program_editions edx
                 JOIN version_map vm ON vm.program_version_id = edx.program_version_id
                 WHERE edx.edition_num_id = (COALESCE(al.new_data, al.old_data)->>'child_edition_id')::int),
                ''
            ) AS program_abbreviation,
            NULL::text AS program_name,
            true AS is_child,
            al.changed_fields AS changed_fields_resolved
        FROM public.audit_logs al
        WHERE al.table_name = 'edition_structure'
          AND p_edition_id IS NOT NULL
          AND (
              (al.new_data->>'parent_edition_id')::int = p_edition_id
              OR (al.old_data->>'parent_edition_id')::int = p_edition_id
          )
    ),

    -- ============================================================
    -- 5. Audit logs del Control de Ediciones (estados por sesión:
    --    dictada/reprogramada/tardanza y cambios de fecha).
    --    record_id = edition_num_id del aula.
    -- ============================================================
    logs_session_control AS (
        SELECT
            al.id,
            al.transaction_id,
            al.created_at,
            al.user_id,
            al.table_name,
            al.record_id,
            al.action,
            al.changed_fields,
            al.old_data,
            al.new_data,
            edx.global_code,
            edx.specific_code,
            vm.abbreviation  AS program_abbreviation,
            vm.program_name,
            false AS is_child,
            al.changed_fields AS changed_fields_resolved
        FROM public.audit_logs al
        LEFT JOIN public.program_editions edx ON edx.edition_num_id = al.record_id
        LEFT JOIN version_map vm ON vm.program_version_id = edx.program_version_id
        WHERE al.table_name = 'edition_session_control'
          AND (
              p_edition_id IS NULL
              OR al.record_id IN (SELECT edition_id FROM relevant_ids)
          )
    ),

    -- ============================================================
    -- 6. UNION de las fuentes
    -- ============================================================
    all_logs AS (
        SELECT * FROM logs_editions
        UNION ALL
        SELECT * FROM logs_structure
        UNION ALL
        SELECT * FROM logs_session_control
    )

    -- ============================================================
    -- 7. AGRUPACIÓN POR TRANSACCIÓN
    -- ============================================================
    SELECT
        al.transaction_id,
        MAX(al.created_at)                        AS created_at,
        MAX(al.user_id)                           AS user_id,
        MAX(u.name)                               AS user_name,
        jsonb_agg(
            jsonb_build_object(
                'table_name',           al.table_name,
                'record_id',            al.record_id,
                'global_code',          al.global_code,
                'specific_code',        al.specific_code,
                'program_abbreviation', al.program_abbreviation,
                'program_name',         al.program_name,
                'action',               al.action,
                'is_child',             al.is_child,
                -- changed_fields ya con labels resueltos
                'changed_fields',       al.changed_fields_resolved,
                -- old/new data también útiles para INSERT/DELETE
                'old_data',             al.old_data,
                'new_data',             al.new_data
            )
            ORDER BY al.record_id, al.id
        )                                         AS changes
    FROM all_logs al
    INNER JOIN public.users u ON u.user_id = al.user_id
    GROUP BY al.transaction_id
    ORDER BY MAX(al.created_at) DESC
    LIMIT  p_limit
    OFFSET p_offset;

END;
$procedure$
