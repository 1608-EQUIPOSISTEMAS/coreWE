-- ===========================================================================
-- Integracion NEXUS: auditoria de aulas (modulo Academica)
-- ---------------------------------------------------------------------------
-- Expone lo creado en el modulo de Auditoria (rubrica del area academica +
-- analisis IA por sesion) bajo la MISMA convencion que las vistas que Nexus ya
-- consume (vw_program_editions_2026, vw_docentes_ref_codigos_2026):
--   * Identificador de aula = `codigo` (siglas-DD/MM/YY), reproducido identico
--     a vw_program_editions_2026 para poder cruzar por codigo desde Nexus.
--   * Alcance al anio 2026 (sufijo _2026).
--
-- Dos vistas:
--   vw_aula_auditoria_2026          -> detalle por sesion (granular)
--   vw_aula_auditoria_resumen_2026  -> resumen por aula (rollup, agrega la 1ra)
--
-- "Literalmente todo" para Nexus: ademas de las notas escalares, ambas vistas
-- aplanan el contenido completo a columnas de TEXTO listas para leerse en
-- Sheets/BI sin parsear JSONB:
--   * ia_criterios_texto      -> los 9 criterios IA con score, comentario y
--                                timestamps de evidencia, en orden.
--   * ia_fortalezas_texto     -> fortalezas_top3 (titulo: detalle).
--   * ia_oportunidades_texto  -> oportunidades_top5 (titulo: detalle).
--   * rubrica_texto           -> los 20 criterios academicos con su categoria,
--                                etiqueta y marca [x]/[ ].
--   * rubrica_marcados_texto  -> solo los criterios academicos cumplidos.
-- El JSONB crudo (ia_reporte, rubrica_criterios) se conserva para quien
-- prefiera parsearlo.
--
-- Las etiquetas de la rubrica viven en el frontend (const RUBRIC de
-- AulaDetail.vue); aqui se replican como catalogo embebido (rubric_catalog).
-- Si cambian en el frontend, actualizar tambien este VALUES.
--
-- Reglas de negocio replicadas del ERP (AulaDetail.vue):
--   * Rubrica academica: 20 criterios binarios; nota /20 = criterios marcados.
--   * Nota IA /20 = puntuacion_global (1-5) * 4.
--   * Nota consolidada = IA 70% + Area academica 30%. Si solo hay una fuente,
--     se usa esa.
--   * Veredicto: >=19 EXCELENTE, >=17 BUENO, >=15 EN PROCESO, resto DEFICIENTE.
--
-- Estructura del JSONB ai_report (por sesion):
--   metricas_rapidas: { puntuacion_global(1-5), porcentaje_practica,
--                       porcentaje_teoria, temas_cubiertos, temas_totales }
--   criterios:        [ { id, nombre, score(1-5), comentario,
--                         evidencia_timestamps:[...] } ]   (9 elementos)
--   fortalezas_top3:  [ { titulo, detalle } ]
--   oportunidades_top5:[ { titulo, detalle } ]
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- DETALLE POR SESION
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_aula_auditoria_2026 AS
WITH ed AS (
  -- Ediciones 2026 con su `codigo` canonico (identico a vw_program_editions_2026,
  -- incluida la desambiguacion por iniciales del docente cuando dos programas
  -- inician el mismo dia). Conserva edition_num_id para unir con la auditoria.
  SELECT
    pe.edition_num_id,
    pv.abbreviation                         AS programa,
    pv.sessions                             AS sesiones_programadas,
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
),
rubric_catalog(orden, item_key, categoria, label) AS (
  -- Espejo del const RUBRIC del frontend (AulaDetail.vue). El orden reproduce
  -- el de la pantalla. Mantener sincronizado si la rubrica cambia.
  VALUES
    (1,  'interaction.1',   'Interaccion con el alumno',   'Brinda oportunidades de participacion'),
    (2,  'interaction.2',   'Interaccion con el alumno',   'Resuelve dudas durante la sesion'),
    (3,  'interaction.3',   'Interaccion con el alumno',   'Responde consultas por el canal de WhatsApp'),
    (4,  'interaction.4',   'Interaccion con el alumno',   'Utiliza plantilla de contacto al alumno'),
    (5,  'interaction.5',   'Interaccion con el alumno',   'Acompanamiento continuo para monitorear niveles de aprendizaje de los estudiantes'),
    (6,  'content.1',       'Contenido y dinamica de clase','El material visual debe estar actualizado en un tiempo no mas de 5 anos de antiguedad'),
    (7,  'content.2',       'Contenido y dinamica de clase','Refuerza el uso de las carpetas de M. de Revision y M. Complementario'),
    (8,  'content.3',       'Contenido y dinamica de clase','El docente explica las fechas establecidas de entrega de proyectos'),
    (9,  'content.4',       'Contenido y dinamica de clase','Comparte por lo menos 1 video relativo al tema'),
    (10, 'content.5',       'Contenido y dinamica de clase','Desarrolla la sesion a traves de taller y/o casos practicos'),
    (11, 'content.6',       'Contenido y dinamica de clase','Evalua lo aprendido por medio de una herramienta tecnologica en cada sesion'),
    (12, 'environment.1',   'Entorno',                     'Equipamiento tecnico adecuado (conexion a internet, audio en buen estado y camara encendida en todo momento de la sesion)'),
    (13, 'environment.2',   'Entorno',                     'Puntualidad al ingreso y culminacion de la sesion'),
    (14, 'environment.3',   'Entorno',                     'Audio claro (sin interferencias)'),
    (15, 'communication.1', 'Comunicacion academica',      'Responde a notificaciones'),
    (16, 'communication.2', 'Comunicacion academica',      'Envia el pantallazo de apertura de sesion'),
    (17, 'communication.3', 'Comunicacion academica',      'Registra la asistencia durante la sesion'),
    (18, 'communication.4', 'Comunicacion academica',      'Comunica si tiene alguna duda o consulta, o le falta un recurso por lo menos 48 horas antes de empezar la sesion'),
    (19, 'communication.5', 'Comunicacion academica',      'Notifica la actualizacion de la videoclase'),
    (20, 'communication.6', 'Comunicacion academica',      'El docente cumple con la fecha establecida de entrega de notas')
),
ses AS (
  -- Metricas deterministas por sesion a partir de la rubrica y el reporte IA.
  SELECT
    car.program_edition_id,
    car.session_number,
    car.criteria,
    car.ai_report,
    car.ai_generated_at,
    car.updated_at,
    car.updated_by,
    -- criterios binarios marcados como verdaderos (rubrica /20)
    (SELECT count(*) FROM jsonb_each(car.criteria) e
       WHERE e.value = 'true'::jsonb)::numeric              AS nota_area_20,
    -- puntuacion global IA (1-5), solo si es numerica
    CASE
      WHEN (car.ai_report #>> '{metricas_rapidas,puntuacion_global}') ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (car.ai_report #>> '{metricas_rapidas,puntuacion_global}')::numeric
    END                                                     AS puntuacion_global_5
  FROM classroom_audit_rubric car
),
calc AS (
  SELECT
    s.*,
    (s.puntuacion_global_5 * 4)                             AS nota_ia_20,
    -- IA 70% + Area 30%; si no hay IA, solo Area
    CASE
      WHEN s.puntuacion_global_5 IS NULL THEN s.nota_area_20
      ELSE (s.puntuacion_global_5 * 4) * 0.7 + s.nota_area_20 * 0.3
    END                                                     AS nota_consolidada_20
  FROM ses s
)
SELECT
  ed.codigo,
  ed.edition_num_id,
  ed.programa,
  ed.docente,
  ed.fecha_inicio,
  ed.sesiones_programadas,
  c.session_number                                          AS sesion,
  c.nota_area_20::int                                       AS criterios_marcados,
  20                                                        AS criterios_total,
  ROUND(c.nota_area_20, 2)                                  AS nota_area_20,
  (c.nota_area_20 > 0)                                      AS tiene_evaluacion_manual,
  (c.ai_report IS NOT NULL)                                 AS tiene_analisis_ia,
  c.ai_generated_at                                         AS ia_generado_at,
  c.puntuacion_global_5,
  ROUND(c.nota_ia_20, 2)                                    AS nota_ia_20,
  NULLIF(c.ai_report #>> '{metricas_rapidas,porcentaje_practica}', '')::numeric AS practica_pct,
  NULLIF(c.ai_report #>> '{metricas_rapidas,porcentaje_teoria}', '')::numeric   AS teoria_pct,
  NULLIF(c.ai_report #>> '{metricas_rapidas,temas_cubiertos}', '')::int         AS temas_cubiertos,
  NULLIF(c.ai_report #>> '{metricas_rapidas,temas_totales}', '')::int           AS temas_totales,
  ROUND(c.nota_consolidada_20, 2)                          AS nota_consolidada_20,
  CASE
    WHEN c.nota_consolidada_20 >= 19 THEN 'EXCELENTE'
    WHEN c.nota_consolidada_20 >= 17 THEN 'BUENO'
    WHEN c.nota_consolidada_20 >= 15 THEN 'EN PROCESO'
    ELSE 'DEFICIENTE'
  END                                                       AS veredicto,
  c.criteria                                                AS rubrica_criterios,   -- JSONB crudo (20 marcas)
  c.ai_report                                               AS ia_reporte,          -- JSONB crudo (9 criterios, fortalezas, oportunidades, metricas)
  c.updated_at                                              AS actualizado_at,
  u.alias                                                   AS actualizado_por,
  -- ----- CONTENIDO COMPLETO APLANADO A TEXTO (para Nexus/Sheets) -----------
  -- Columnas anexadas al final para que CREATE OR REPLACE VIEW sea in-place.
  ia.criterios_texto                                        AS ia_criterios_texto,
  ia.fortalezas_texto                                       AS ia_fortalezas_texto,
  ia.oportunidades_texto                                    AS ia_oportunidades_texto,
  rub.rubrica_texto                                         AS rubrica_texto,
  rub.marcados_texto                                        AS rubrica_marcados_texto
FROM calc c
JOIN ed         ON ed.edition_num_id = c.program_edition_id
LEFT JOIN users u ON u.user_id = c.updated_by
-- Criterios IA -> una sola cadena ordenada por id, con evidencia entre []
LEFT JOIN LATERAL (
  SELECT
    string_agg(
      '#' || (cr->>'id') || ' ' || COALESCE(cr->>'nombre', 's/nombre')
        || ' (' || COALESCE(cr->>'score', '?') || '/5): '
        || COALESCE(cr->>'comentario', '')
        || CASE
             WHEN jsonb_typeof(cr->'evidencia_timestamps') = 'array'
              AND jsonb_array_length(cr->'evidencia_timestamps') > 0
             THEN ' [evidencia: '
               || (SELECT string_agg(t, ', ')
                     FROM jsonb_array_elements_text(cr->'evidencia_timestamps') t)
               || ']'
             ELSE ''
           END,
      E'\n' ORDER BY NULLIF(cr->>'id', '')::int
    ) AS criterios_texto
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(c.ai_report->'criterios') = 'array'
              THEN c.ai_report->'criterios' ELSE '[]'::jsonb END
       ) cr
) ia_c ON true
-- Fortalezas / oportunidades -> una cadena cada una, preservando el orden
LEFT JOIN LATERAL (
  SELECT
    (SELECT string_agg('- ' || COALESCE(f.val->>'titulo', '') || ': '
                       || COALESCE(f.val->>'detalle', ''), E'\n' ORDER BY f.ord)
       FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(c.ai_report->'fortalezas_top3') = 'array'
                   THEN c.ai_report->'fortalezas_top3' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS f(val, ord)) AS fortalezas_texto,
    (SELECT string_agg('- ' || COALESCE(o.val->>'titulo', '') || ': '
                       || COALESCE(o.val->>'detalle', ''), E'\n' ORDER BY o.ord)
       FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(c.ai_report->'oportunidades_top5') = 'array'
                   THEN c.ai_report->'oportunidades_top5' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS o(val, ord)) AS oportunidades_texto,
    ia_c.criterios_texto AS criterios_texto
) ia ON true
-- Rubrica academica -> texto completo (20 items con [x]/[ ]) y solo los marcados
LEFT JOIN LATERAL (
  SELECT
    string_agg(
      rc.categoria || ' > ' || rc.label || ' '
        || CASE WHEN c.criteria->>rc.item_key = 'true' THEN '[x]' ELSE '[ ]' END,
      E'\n' ORDER BY rc.orden
    ) AS rubrica_texto,
    string_agg(
      CASE WHEN c.criteria->>rc.item_key = 'true'
           THEN rc.categoria || ' > ' || rc.label END,
      E'\n' ORDER BY rc.orden
    ) AS marcados_texto
  FROM rubric_catalog rc
) rub ON true
ORDER BY ed.codigo, c.session_number;

-- ---------------------------------------------------------------------------
-- RESUMEN POR AULA (rollup de la vista de detalle)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_aula_auditoria_resumen_2026 AS
SELECT
  codigo,
  edition_num_id,
  programa,
  docente,
  fecha_inicio,
  max(sesiones_programadas)                                 AS sesiones_programadas,
  count(*)                                                  AS sesiones_con_registro,
  count(*) FILTER (WHERE tiene_analisis_ia)                 AS sesiones_con_ia,
  count(*) FILTER (WHERE tiene_evaluacion_manual)           AS sesiones_con_manual,
  ROUND(avg(nota_ia_20)   FILTER (WHERE tiene_analisis_ia), 2)        AS nota_ia_promedio_20,
  ROUND(avg(nota_area_20) FILTER (WHERE tiene_evaluacion_manual), 2)  AS nota_area_promedio_20,
  ROUND(avg(nota_consolidada_20), 2)                        AS nota_consolidada_aula_20,
  CASE
    WHEN avg(nota_consolidada_20) >= 19 THEN 'EXCELENTE'
    WHEN avg(nota_consolidada_20) >= 17 THEN 'BUENO'
    WHEN avg(nota_consolidada_20) >= 15 THEN 'EN PROCESO'
    ELSE 'DEFICIENTE'
  END                                                       AS veredicto_aula,
  ROUND(100.0 * count(*) FILTER (WHERE tiene_analisis_ia)
        / NULLIF(max(sesiones_programadas), 0), 0)          AS cobertura_ia_pct,
  ROUND(100.0 * count(*) FILTER (WHERE tiene_evaluacion_manual)
        / NULLIF(max(sesiones_programadas), 0), 0)          AS cobertura_manual_pct,
  (count(*) FILTER (WHERE tiene_analisis_ia) >= max(sesiones_programadas)
   AND count(*) FILTER (WHERE tiene_evaluacion_manual) >= max(sesiones_programadas)) AS muestra_completa,
  max(ia_generado_at)                                       AS ultimo_analisis_ia_at,
  max(actualizado_at)                                       AS ultima_actividad_at,
  -- Rollup legible por aula: una linea por sesion con sus notas y veredicto.
  string_agg(
    'S' || sesion || ': consolidada ' || COALESCE(nota_consolidada_20::text, '--')
      || ' (IA ' || COALESCE(nota_ia_20::text, '--')
      || ' / Area ' || COALESCE(nota_area_20::text, '--') || ') ' || veredicto,
    E'\n' ORDER BY sesion
  )                                                         AS sesiones_resumen_texto
FROM public.vw_aula_auditoria_2026
GROUP BY codigo, edition_num_id, programa, docente, fecha_inicio
ORDER BY codigo;
