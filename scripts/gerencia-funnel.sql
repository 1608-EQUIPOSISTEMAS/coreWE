-- Reporte de Gerencia: embudo Consultas -> Ventas por edicion y canal.
-- Reemplaza al Google Sheet "Reporte de Consultas 2026" (78 columnas x 12 pestanas).
--
-- Idempotente: se puede correr las veces que haga falta (el tunel se cae seguido).
--
-- Decisiones que NO copian a v_dashboard_program_goals, a proposito:
--   1. ventas = enrollments padre (o destino de CC), NO todos los enrollments.
--      La vista vieja cuenta hijos de paquete: 1588 filas en mayo-2026 cuando las
--      ventas reales son 633. Regla identica a PARENT_OR_CC_DESTINATION del sync.
--   2. WEB sale de OTROS y es su propio grupo, como en la hoja.
--   3. ESTRATEGIAS se llama COMERCIAL, que es como lo lee gerencia.
--   4. Consultas y ventas se clasifican con la MISMA taxonomia, para que la
--      conversion por canal sea comparable (la hoja nunca la calcula).

-- ── 1. Metas por canal ────────────────────────────────────────────────────────
-- channel_goals: {"MARKETING_NUEVO": {"consultas": 1704, "ventas": 318}, ...}
-- Un jsonb en vez de 40 columnas: los canales cambian, el esquema no deberia.
--
-- NULL a proposito (sin NOT NULL): Producto->Cronograma ya guarda metas por este
-- mismo upsert sin conocer estas dos columnas. Dejarlas nulas permite distinguir
-- "no me lo mandaron" de "mandaron cero" y no pisar las metas de canal cargadas
-- desde Gerencia. La vista hace el COALESCE.
ALTER TABLE public.program_edition_goals
  ADD COLUMN IF NOT EXISTS lead_goal     integer,
  ADD COLUMN IF NOT EXISTS channel_goals jsonb;

COMMENT ON COLUMN public.program_edition_goals.lead_goal IS
  'Meta de consultas (leads) de la edicion. Equivale a OBJ CONS. de la hoja.';
COMMENT ON COLUMN public.program_edition_goals.channel_goals IS
  'Metas por canal: {"<GRUPO>_<MOMENTO>": {"consultas": int, "ventas": int}}. '
  'GRUPO = MARKETING|WEB|COMERCIAL|OTROS, MOMENTO = NUEVO|LEAD|COMUNIDAD.';

-- ── 2. La vista ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_gerencia_funnel AS
WITH lead_class AS (
  SELECT
    l.program_edition_id,
    CASE
      WHEN l.cat_type_strategy IS NOT NULL THEN 'COMERCIAL'
      WHEN ch.alias IN ('we_social_media_instagram', 'we_social_media_linkedin',
                        'we_social_media_facebook',  'we_social_media_estados') THEN 'MARKETING'
      WHEN ch.alias = 'we_social_media_wechat' THEN 'WEB'
      ELSE 'OTROS'
    END AS grupo,
    CASE cm.alias
      WHEN 'we_moment_new'  THEN 'NUEVO'
      WHEN 'we_moment_lead' THEN 'LEAD'
      WHEN 'we_moment_cwd'  THEN 'COMUNIDAD'
      ELSE 'SIN_CLASIFICAR'
    END AS momento,
    (st.alias IN ('we_lead_status_insc', 'we_lead_status_bought')) AS vendido
  FROM public.leads l
  LEFT JOIN public.catalog ch ON ch.catalog_id = l.cat_channel
  LEFT JOIN public.catalog cm ON cm.catalog_id = l.cat_client_moment
  LEFT JOIN public.catalog st ON st.catalog_id = l.cat_status_lead
  WHERE l.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar])
    AND l.program_edition_id IS NOT NULL
),
canal_agg AS (
  SELECT
    program_edition_id,
    grupo,
    momento,
    COUNT(*)::int                          AS consultas,
    COUNT(*) FILTER (WHERE vendido)::int   AS ventas
  FROM lead_class
  GROUP BY program_edition_id, grupo, momento
),
canal_json AS (
  SELECT
    program_edition_id,
    jsonb_object_agg(
      grupo || '_' || momento,
      jsonb_build_object('consultas', consultas, 'ventas', ventas)
    )                        AS canales,
    SUM(consultas)::int      AS consultas,
    SUM(ventas)::int         AS ventas_trazadas
  FROM canal_agg
  GROUP BY program_edition_id
),
-- Ventas duras: enrollments padre + destinos de Cambio de Curso. Los hijos de
-- paquete (SEG, pago cero) no son una venta, son asistentes del mismo pago.
sales_agg AS (
  SELECT
    e.program_edition_id,
    COUNT(*)::int AS ventas,
    SUM(CASE WHEN e.cat_currency = 3042 THEN e.total_amount * 3.75
             ELSE e.total_amount END) AS monto
  FROM public.enrollments e
  WHERE e.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar])
    AND e.cat_type_status <> 3135
    AND (
      e.parent_enrollment_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.course_changes cc
         WHERE cc.enrollment_destination_id = e.enrollment_id
           AND cc.active = 'Y'
      )
    )
  GROUP BY e.program_edition_id
)
SELECT
  pe.edition_num_id,
  EXTRACT(year  FROM pe.start_date)::int AS anio,
  EXTRACT(month FROM pe.start_date)::int AS mes_num,
  cat_seg.description  AS categoria,
  cat_cat.description  AS linea,
  p.program_name       AS programa,
  cat_catx.description AS tipo,
  pe.start_date        AS fecha_inicio,
  pe.global_code       AS codigo_edicion,

  COALESCE(peg.lead_goal, 0)              AS meta_consultas,
  COALESCE(peg.vacant_goal, 0)            AS meta_ventas,
  COALESCE(peg.revenue_goal, 0::numeric)  AS meta_monto,
  COALESCE(peg.channel_goals, '{}'::jsonb) AS metas_canal,

  COALESCE(cj.consultas, 0)               AS consultas,
  COALESCE(sa.ventas, 0)                  AS ventas,
  COALESCE(sa.monto, 0::numeric)          AS venta_monto,
  -- Ventas que si tienen un lead detras. La diferencia contra `ventas` es la
  -- venta sin trazabilidad de canal: dato nuevo, la hoja no lo puede ver.
  COALESCE(cj.ventas_trazadas, 0)         AS ventas_trazadas,
  COALESCE(cj.canales, '{}'::jsonb)       AS canales
FROM public.program_editions pe
JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
JOIN public.programs p          ON p.program_id          = pv.program_id
LEFT JOIN public.catalog cat_seg  ON cat_seg.catalog_id  = pe.cat_segment
LEFT JOIN public.catalog cat_cat  ON cat_cat.catalog_id  = p.cat_category
LEFT JOIN public.catalog cat_catx ON cat_catx.catalog_id = p.cat_type_program
LEFT JOIN public.program_edition_goals peg ON peg.edition_num_id      = pe.edition_num_id
LEFT JOIN canal_json cj                    ON cj.program_edition_id   = pe.edition_num_id
LEFT JOIN sales_agg  sa                    ON sa.program_edition_id   = pe.edition_num_id
WHERE pe.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar]);

COMMENT ON VIEW public.v_gerencia_funnel IS
  'Embudo consultas->ventas por edicion y canal para el reporte de Gerencia. '
  'Ventas = enrollments padre o destino de CC (los hijos de paquete no cuentan).';
