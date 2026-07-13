-- ===========================================================================
-- Integracion NEXUS: Lista de Notas por alumno (modulo Academica)
-- ---------------------------------------------------------------------------
-- Permite que el docente, desde Nexus, vea la lista de alumnos de su aula y
-- registre sus notas. Sigue la MISMA convencion que las vistas que Nexus ya
-- consume (vw_aula_auditoria_2026, vw_program_editions_2026):
--   * Identificador de aula = `codigo` (siglas-DD/MM/YY), reproducido identico
--     a vw_program_editions_2026 (incluida la desambiguacion por iniciales del
--     docente cuando dos programas inician el mismo dia).
--   * Alcance al anio 2026.
--
-- Tres funciones:
--   sp_nexus_aula_codigo_resolver(codigo)  -> edition_num_id (helper interno)
--   sp_nexus_aula_notas_list(codigo)       -> lista de notas del aula
--   sp_nexus_aula_notas_save(...)          -> registra notas/grupo de un alumno
--
-- Lo que el docente ve por alumno: nombre, dni, ocupacion (P/E), modalidad,
-- ESTADO de seguimiento (SEG/Activo/RP/CC), codigo del programa padre, GRUPO,
-- sus notas (tests por sesion, participacion, criterios de entregables) y los
-- totales calculados con resultado APROBADO/DESAPROBADO.
--
-- Lo que el docente registra: tests por sesion (0-20, la nota del TEST FINAL
-- del quiz de esa sesion), participacion por sesion (true/false), criterios
-- de entregables (cada criterio de 0 a 20; parcial pondera 40/40/20 y final
-- 30/30/20/20), y el numero de grupo. En el save, NULL = "no cambiar ese
-- campo"; lo enviado reemplaza completo ese bloque.
--
-- !! REGLAS DE NEGOCIO REPLICADAS DEL ERP !!
-- Fuente de verdad: GRADE_RULES en Backend/src/modules/edition/edition.entity.js
-- (y su espejo en Frontend AulaDetail.vue). Si cambian alla, actualizar aqui:
--   * TEST (20)        = SUM(tests) / sesiones_programadas   (0-20 por sesion)
--   * PARTICIPACION    = ROUND(checks * 2 / sesiones), cap 2
--   * ENTREGABLES      = promedio ponderado de criterios 0-20 c/u
--                        (parcial: 40/40/20; final: 30/30/20/20) => /20
--   * NOTA FINAL       = TEST*0.30 + PARCIAL*0.30 + FINAL*0.40 + PARTICIPACION
--                        capeada a 20
--   * APROBADO         = nota final >= 12
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- HELPER: codigo Nexus -> edition_num_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sp_nexus_aula_codigo_resolver(p_codigo text)
RETURNS integer
LANGUAGE sql STABLE
AS $$
  WITH ed AS (
    SELECT
      pe.edition_num_id,
      CASE
        WHEN count(*) OVER (PARTITION BY pv.abbreviation, pe.start_date) > 1
          THEN upper(left(split_part(btrim(p.first_name), ' ', 1), 1))
            || upper(left(split_part(btrim(p.last_name), ' ', 1), 1))
            || sg.siglas || '-' || to_char(pe.start_date, 'DD/MM/YY')
        ELSE sg.siglas || '-' || to_char(pe.start_date, 'DD/MM/YY')
      END AS codigo
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN instructors i       ON i.instructor_id = pe.instructor_id
    JOIN persons p           ON p.person_id = i.person_id
    CROSS JOIN LATERAL (
      SELECT string_agg(left(w, 1), '') AS siglas
      FROM regexp_split_to_table(upper(pv.abbreviation::text), '\s+') AS w
    ) sg
    WHERE pe.start_date >= DATE '2026-01-01'
      AND pe.start_date <  DATE '2027-01-01'
  )
  SELECT edition_num_id FROM ed WHERE codigo = p_codigo LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- LISTA DE NOTAS DEL AULA (una fila por alumno matriculado FICO-aprobado)
-- ---------------------------------------------------------------------------
-- DROP previo: agregar columnas al RETURNS TABLE no es posible con OR REPLACE.
DROP FUNCTION IF EXISTS public.sp_nexus_aula_notas_list(text);
CREATE OR REPLACE FUNCTION public.sp_nexus_aula_notas_list(p_codigo text)
RETURNS TABLE (
  codigo                 text,
  programa               text,
  docente                text,
  fecha_inicio           date,
  sesiones               integer,
  enrollment_id          integer,
  alumno                 text,
  dni                    text,
  ocupacion              text,     -- P / E
  modalidad              text,     -- REGULAR / FLEX
  estado                 text,     -- SEG / Activo / RP / CC / OBS
  seguimiento_padre      text,     -- codigo del programa padre (solo hijos)
  grupo                  integer,
  tests                  jsonb,    -- {"1":4,"2":5,...} 0-5 por sesion
  participacion          jsonb,    -- {"1":true,...}
  entregable_parcial     jsonb,    -- {"1":n/8,"2":n/8,"3":n/4}
  entregable_final       jsonb,    -- {"1".."4": n/5}
  tests_texto            text,     -- "S1=4 | S2=5 | S3=- ..."
  participacion_texto    text,     -- "S1=[x] | S2=[ ] ..."
  nota_test_20           numeric,
  puntos_participacion   numeric,
  nota_parcial_20        numeric,
  nota_entregable_final_20 numeric,
  nota_final_20          numeric,
  resultado              text,     -- APROBADO / DESAPROBADO / SIN NOTAS
  observacion            text,     -- observacion del acta (editable)
  actualizado_en         timestamptz
)
LANGUAGE sql STABLE
AS $$
  WITH ed AS (
    SELECT
      pe.edition_num_id,
      pv.abbreviation::text                   AS programa,
      pv.sessions                             AS sesiones,
      (p.first_name || ' ' || p.last_name)    AS docente,
      pe.start_date                           AS fecha_inicio,
      CASE
        WHEN count(*) OVER (PARTITION BY pv.abbreviation, pe.start_date) > 1
          THEN upper(left(split_part(btrim(p.first_name), ' ', 1), 1))
            || upper(left(split_part(btrim(p.last_name), ' ', 1), 1))
            || sg.siglas || '-' || to_char(pe.start_date, 'DD/MM/YY')
        ELSE sg.siglas || '-' || to_char(pe.start_date, 'DD/MM/YY')
      END                                     AS codigo
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN instructors i       ON i.instructor_id = pe.instructor_id
    JOIN persons p           ON p.person_id = i.person_id
    CROSS JOIN LATERAL (
      SELECT string_agg(left(w, 1), '') AS siglas
      FROM regexp_split_to_table(upper(pv.abbreviation::text), '\s+') AS w
    ) sg
    WHERE pe.start_date >= DATE '2026-01-01'
      AND pe.start_date <  DATE '2027-01-01'
  )
  SELECT
    ed.codigo,
    ed.programa,
    ed.docente,
    ed.fecha_inicio,
    ed.sesiones,
    e.enrollment_id,
    TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
    per.document_number::text                 AS dni,
    CASE c_prof.alias
      WHEN 'we_profile_student' THEN 'E'
      ELSE 'P'
    END                                       AS ocupacion,
    CASE c_mod.alias
      WHEN 'we_insc_modality_flexible' THEN 'FLEX'
      ELSE 'REGULAR'
    END                                       AS modalidad,
    COALESCE(cts.description::text, '--')     AS estado,
    CASE WHEN e.parent_enrollment_id IS NOT NULL
         THEN pv_parent.version_code::text END AS seguimiento_padre,
    g.group_number                            AS grupo,
    COALESCE(g.tests, '{}'::jsonb)            AS tests,
    COALESCE(g.participation, '{}'::jsonb)    AS participacion,
    COALESCE(g.partial_criteria, '{}'::jsonb) AS entregable_parcial,
    COALESCE(g.final_criteria, '{}'::jsonb)   AS entregable_final,
    (SELECT string_agg('S' || n || '=' || COALESCE(g.tests ->> n::text, '-'), ' | ' ORDER BY n)
       FROM generate_series(1, ed.sesiones) n)                       AS tests_texto,
    (SELECT string_agg('S' || n || '=' ||
              CASE WHEN (g.participation ->> n::text)::boolean THEN '[x]' ELSE '[ ]' END,
              ' | ' ORDER BY n)
       FROM generate_series(1, ed.sesiones) n)                       AS participacion_texto,
    g.test_score                              AS nota_test_20,
    g.participation_score                     AS puntos_participacion,
    g.partial_score                           AS nota_parcial_20,
    g.final_deliv_score                       AS nota_entregable_final_20,
    g.final_grade                             AS nota_final_20,
    -- "Tiene notas" = al menos una celda escrita (un 0 tecleado cuenta; el
    -- grupo o la observacion NO cuentan). Espejo de hasAnyGrade en el ERP.
    CASE
      WHEN g.grade_id IS NULL THEN 'SIN NOTAS'
      WHEN NOT (
           EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(g.tests, '{}'::jsonb)) t WHERE t.value IS NOT NULL)
        OR EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(g.partial_criteria, '{}'::jsonb)) t WHERE t.value IS NOT NULL)
        OR EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(g.final_criteria, '{}'::jsonb)) t WHERE t.value IS NOT NULL)
        OR EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(g.participation, '{}'::jsonb)) t WHERE t.value = 'true')
      ) THEN 'SIN NOTAS'
      WHEN g.final_grade >= 12 THEN 'APROBADO'
      ELSE 'DESAPROBADO'
    END                                       AS resultado,
    g.observation                             AS observacion,
    g.updated_at                              AS actualizado_en
  FROM ed
  JOIN public.enrollments e        ON e.program_edition_id = ed.edition_num_id
  JOIN public.customers cust       ON cust.customer_id = e.customer_id
  JOIN public.persons per          ON per.person_id = cust.person_id
  JOIN public."catalog" cf         ON cf.catalog_id = e.cat_fico_status
  LEFT JOIN public."catalog" cts   ON cts.catalog_id = e.cat_type_status
  LEFT JOIN public."catalog" c_mod ON c_mod.catalog_id = e.cat_inscription_modality
  LEFT JOIN public."catalog" c_prof ON c_prof.catalog_id = e.cat_profile_id
  LEFT JOIN public.enrollments e_parent ON e_parent.enrollment_id = e.parent_enrollment_id
  LEFT JOIN public.program_versions pv_parent ON pv_parent.program_version_id = e_parent.program_version_id
  LEFT JOIN public.classroom_student_grades g ON g.enrollment_id = e.enrollment_id
  WHERE ed.codigo = p_codigo
    AND e.active = 'Y'
    AND cf.alias = 'we_enrollment_status_checked'
    -- HOJA = sin hijos (un destino de cambio de curso hacia un paquete tiene
    -- padre Y sus propios hijos SEG: asisten los hijos, no el).
    AND NOT EXISTS (
           SELECT 1 FROM public.enrollments c
            WHERE c.parent_enrollment_id = e.enrollment_id
         )
  ORDER BY per.last_name, per.first_name
$$;

-- ---------------------------------------------------------------------------
-- REGISTRO DE NOTAS / GRUPO DE UN ALUMNO
-- ---------------------------------------------------------------------------
-- Contrato: p_tests / p_participacion / p_parcial / p_final / p_grupo en NULL
-- significa "no cambiar"; si vienen, REEMPLAZAN ese bloque completo (mismo
-- comportamiento que el guardado del ERP). Los valores se clampean por celda:
-- tests 0-20, criterios de entregables 0-20; claves invalidas se descartan.
-- Los totales se recalculan SIEMPRE aqui (nunca se aceptan del cliente).
-- ENTREGABLES GRUPALES: si el alumno tiene grupo y el bloque parcial/final
-- CAMBIA, se propaga el mismo bloque a todo el grupo recalculando la nota
-- final de cada miembro con SUS tests/participacion individuales.
DROP FUNCTION IF EXISTS public.sp_nexus_aula_notas_save(text, integer, jsonb, jsonb, jsonb, jsonb, integer);
CREATE OR REPLACE FUNCTION public.sp_nexus_aula_notas_save(
  p_codigo        text,
  p_enrollment_id integer,
  p_tests         jsonb DEFAULT NULL,
  p_participacion jsonb DEFAULT NULL,
  p_parcial       jsonb DEFAULT NULL,
  p_final         jsonb DEFAULT NULL,
  p_grupo         integer DEFAULT NULL,
  p_observacion   text DEFAULT NULL
)
RETURNS TABLE (
  enrollment_id        integer,
  alumno               text,
  grupo                integer,
  nota_test_20         numeric,
  puntos_participacion numeric,
  nota_parcial_20      numeric,
  nota_entregable_final_20 numeric,
  nota_final_20        numeric,
  resultado            text,
  observacion          text,
  actualizado_en       timestamptz
)
LANGUAGE plpgsql
AS $$
-- Las columnas de RETURNS TABLE comparten nombre con las de la tabla
-- (enrollment_id, etc.); dentro de los statements SQL gana la columna.
#variable_conflict use_column
DECLARE
  v_edition      integer;
  v_sesiones     integer;
  v_tests        jsonb;
  v_part         jsonb;
  v_parcial      jsonb;
  v_final        jsonb;
  v_parcial_old  jsonb;
  v_final_old    jsonb;
  v_grupo_prev   integer;
  v_grupo        integer;
  v_prop_parcial boolean := false;
  v_prop_final   boolean := false;
  v_tiene_notas  boolean := false;
  v_test20       numeric;
  v_part2        numeric;
  v_parcial20    numeric;
  v_final20      numeric;
  v_nota         numeric;
BEGIN
  v_edition := public.sp_nexus_aula_codigo_resolver(p_codigo);
  IF v_edition IS NULL THEN
    RAISE EXCEPTION 'Aula con codigo % no encontrada (alcance 2026)', p_codigo;
  END IF;

  SELECT pv.sessions INTO v_sesiones
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.edition_num_id = v_edition;
  v_sesiones := COALESCE(v_sesiones, 0);

  -- El alumno debe pertenecer al aula y estar activo/aprobado por FICO.
  PERFORM 1
    FROM public.enrollments e
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
   WHERE e.enrollment_id = p_enrollment_id
     AND e.program_edition_id = v_edition
     AND e.active = 'Y'
     AND cf.alias = 'we_enrollment_status_checked';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno (enrollment %) no pertenece al aula % o no esta activo',
      p_enrollment_id, p_codigo;
  END IF;

  -- Bloques: NULL = conservar lo guardado; si viene, se sanea y reemplaza.
  SELECT g.tests, g.participation, g.partial_criteria, g.final_criteria, g.group_number
    INTO v_tests, v_part, v_parcial, v_final, v_grupo_prev
    FROM public.classroom_student_grades g
   WHERE g.enrollment_id = p_enrollment_id;

  -- Copia previa de los entregables para detectar cambios (propagacion grupal)
  v_parcial_old := COALESCE(v_parcial, '{}'::jsonb);
  v_final_old   := COALESCE(v_final, '{}'::jsonb);

  IF p_tests IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(key, LEAST(GREATEST(value::numeric, 0), 20)), '{}'::jsonb)
      INTO v_tests
      FROM jsonb_each_text(p_tests)
     WHERE key ~ '^[0-9]+$' AND key::int BETWEEN 1 AND GREATEST(v_sesiones, 1)
       AND value ~ '^[0-9]+(\.[0-9]+)?$';
  END IF;
  v_tests := COALESCE(v_tests, '{}'::jsonb);

  IF p_participacion IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(key, (value::boolean)), '{}'::jsonb)
      INTO v_part
      FROM jsonb_each_text(p_participacion)
     WHERE key ~ '^[0-9]+$' AND key::int BETWEEN 1 AND GREATEST(v_sesiones, 1)
       AND lower(value) IN ('true', 'false');
  END IF;
  v_part := COALESCE(v_part, '{}'::jsonb);

  IF p_parcial IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(key, LEAST(GREATEST(value::numeric, 0), 20)), '{}'::jsonb)
      INTO v_parcial
      FROM jsonb_each_text(p_parcial)
     WHERE key IN ('1', '2', '3')
       AND value ~ '^[0-9]+(\.[0-9]+)?$';
  END IF;
  v_parcial := COALESCE(v_parcial, '{}'::jsonb);

  IF p_final IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(key, LEAST(GREATEST(value::numeric, 0), 20)), '{}'::jsonb)
      INTO v_final
      FROM jsonb_each_text(p_final)
     WHERE key IN ('1', '2', '3', '4')
       AND value ~ '^[0-9]+(\.[0-9]+)?$';
  END IF;
  v_final := COALESCE(v_final, '{}'::jsonb);

  -- Propagar al grupo solo si el bloque realmente cambio
  v_prop_parcial := p_parcial IS NOT NULL AND v_parcial IS DISTINCT FROM v_parcial_old;
  v_prop_final   := p_final   IS NOT NULL AND v_final   IS DISTINCT FROM v_final_old;
  v_grupo        := COALESCE(p_grupo, v_grupo_prev);

  -- Totales (espejo de computeGradeTotals en edition.entity.js).
  -- TEST /20 = promedio de los tests de sesion (cada uno ya viene 0-20).
  SELECT COALESCE(SUM(value::numeric), 0) INTO v_test20 FROM jsonb_each_text(v_tests);
  v_test20 := CASE WHEN v_sesiones > 0 THEN ROUND(v_test20 / v_sesiones, 2) ELSE 0 END;

  SELECT COUNT(*) INTO v_part2 FROM jsonb_each_text(v_part) WHERE value = 'true';
  v_part2 := CASE WHEN v_sesiones > 0
                  THEN LEAST(ROUND(v_part2 * 2.0 / v_sesiones), 2) ELSE 0 END;

  -- Entregables: promedio ponderado de criterios 0-20 (criterio ausente = 0)
  v_parcial20 := ROUND(
      COALESCE((v_parcial ->> '1')::numeric, 0) * 0.40
    + COALESCE((v_parcial ->> '2')::numeric, 0) * 0.40
    + COALESCE((v_parcial ->> '3')::numeric, 0) * 0.20, 2);
  v_final20 := ROUND(
      COALESCE((v_final ->> '1')::numeric, 0) * 0.30
    + COALESCE((v_final ->> '2')::numeric, 0) * 0.30
    + COALESCE((v_final ->> '3')::numeric, 0) * 0.20
    + COALESCE((v_final ->> '4')::numeric, 0) * 0.20, 2);

  v_nota := LEAST(ROUND(v_test20 * 0.30 + v_parcial20 * 0.30 + v_final20 * 0.40 + v_part2, 2), 20);

  -- "Tiene notas" = al menos una celda escrita (espejo de hasAnyGrade del ERP);
  -- solo grupo u observacion NO cuenta como evaluado.
  v_tiene_notas :=
       EXISTS (SELECT 1 FROM jsonb_each_text(v_tests) t WHERE t.value IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_each_text(v_parcial) t WHERE t.value IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_each_text(v_final) t WHERE t.value IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_each_text(v_part) t WHERE t.value = 'true');

  RETURN QUERY
  INSERT INTO public.classroom_student_grades AS g
    (program_edition_id, enrollment_id, tests, participation,
     partial_criteria, final_criteria, test_score, participation_score,
     partial_score, final_deliv_score, final_grade, group_number,
     observation, updated_by, updated_at)
  VALUES
    (v_edition, p_enrollment_id, v_tests, v_part, v_parcial, v_final,
     v_test20, v_part2, v_parcial20, v_final20, v_nota,
     p_grupo, NULLIF(TRIM(p_observacion), ''), NULL, NOW())
  ON CONFLICT (enrollment_id) DO UPDATE SET
    tests               = EXCLUDED.tests,
    participation       = EXCLUDED.participation,
    partial_criteria    = EXCLUDED.partial_criteria,
    final_criteria      = EXCLUDED.final_criteria,
    test_score          = EXCLUDED.test_score,
    participation_score = EXCLUDED.participation_score,
    partial_score       = EXCLUDED.partial_score,
    final_deliv_score   = EXCLUDED.final_deliv_score,
    final_grade         = EXCLUDED.final_grade,
    group_number        = COALESCE(EXCLUDED.group_number, g.group_number),
    observation         = COALESCE(EXCLUDED.observation, g.observation),
    updated_at          = NOW()
  RETURNING
    g.enrollment_id,
    (SELECT TRIM(BOTH FROM concat_ws(' ', per.first_name, per.last_name, per.mother_last_name))
       FROM public.enrollments e2
       JOIN public.customers cust ON cust.customer_id = e2.customer_id
       JOIN public.persons per ON per.person_id = cust.person_id
      WHERE e2.enrollment_id = g.enrollment_id),
    g.group_number,
    g.test_score,
    g.participation_score,
    g.partial_score,
    g.final_deliv_score,
    g.final_grade,
    CASE
      WHEN NOT v_tiene_notas THEN 'SIN NOTAS'
      WHEN g.final_grade >= 12 THEN 'APROBADO'
      ELSE 'DESAPROBADO'
    END,
    g.observation,
    g.updated_at;

  -- Entregables grupales: mismo bloque para todo el grupo, pero cada miembro
  -- conserva sus tests/participacion, asi que su nota final se recalcula aqui.
  IF v_grupo IS NOT NULL AND (v_prop_parcial OR v_prop_final) THEN
    UPDATE public.classroom_student_grades cg SET
      partial_criteria  = CASE WHEN v_prop_parcial THEN v_parcial   ELSE cg.partial_criteria END,
      final_criteria    = CASE WHEN v_prop_final   THEN v_final     ELSE cg.final_criteria END,
      partial_score     = CASE WHEN v_prop_parcial THEN v_parcial20 ELSE cg.partial_score END,
      final_deliv_score = CASE WHEN v_prop_final   THEN v_final20   ELSE cg.final_deliv_score END,
      final_grade       = LEAST(ROUND(
          COALESCE(cg.test_score, 0) * 0.30
          + (CASE WHEN v_prop_parcial THEN v_parcial20 ELSE COALESCE(cg.partial_score, 0) END) * 0.30
          + (CASE WHEN v_prop_final   THEN v_final20   ELSE COALESCE(cg.final_deliv_score, 0) END) * 0.40
          + COALESCE(cg.participation_score, 0), 2), 20),
      updated_at        = NOW()
    WHERE cg.program_edition_id = v_edition
      AND cg.group_number = v_grupo
      AND cg.enrollment_id <> p_enrollment_id;
  END IF;
END;
$$;
