-- v_dashboard_program_goals — metas por edición (tablero de objetivos).
-- Fix 17/07/2026: se quitó "AND pe.flag_history = true" del WHERE. Ese filtro
-- ocultaba las metas de las ediciones con flag_history=false (213 activas de
-- 2026): el upsert en program_edition_goals guardaba bien, pero el modal de
-- Objetivos del Cronograma, ReportGoalEdition y ScheduleBoard leían la vista
-- y mostraban 0. El universo correcto es "ediciones activas", sin más.
CREATE OR REPLACE VIEW public.v_dashboard_program_goals AS
 WITH sales_agg AS (
         SELECT e.program_edition_id,
            count(*) AS total_ventas_cnt,
            sum(
                CASE
                    WHEN e.cat_currency = 3042 THEN e.total_amount * 3.75
                    ELSE e.total_amount
                END) AS total_ventas_monto
           FROM enrollments e
          WHERE (e.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar])) AND e.cat_type_status <> 3135
          GROUP BY e.program_edition_id
        ), leads_base AS (
         SELECT l.program_edition_id,
            l.cat_client_moment,
            l.cat_channel,
            l.user_registration_id,
            l.cat_status_lead,
            l.cat_type_strategy
           FROM leads l
          WHERE (l.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar])) AND l.program_edition_id IS NOT NULL
        ), leads_sales AS (
         SELECT l.program_edition_id,
            count(*) AS leads_vendidos_cnt
           FROM leads l
             LEFT JOIN catalog cat ON cat.catalog_id = l.cat_status_lead
          WHERE (l.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar])) AND l.program_edition_id IS NOT NULL AND (cat.alias::text = ANY (ARRAY['we_lead_status_insc'::character varying::text, 'we_lead_status_bought'::character varying::text]))
          GROUP BY l.program_edition_id
        ), advisors_counts AS (
         SELECT lb.program_edition_id,
            COALESCE(u.alias, u.name, ('Usuario '::text || lb.user_registration_id::text)::character varying) AS advisor_name,
            count(*) AS qty
           FROM leads_base lb
             LEFT JOIN users u ON u.user_id = lb.user_registration_id
          GROUP BY lb.program_edition_id, (COALESCE(u.alias, u.name, ('Usuario '::text || lb.user_registration_id::text)::character varying))
        ), origins_counts AS (
         SELECT lb.program_edition_id,
                CASE
                    WHEN lb.cat_type_strategy IS NOT NULL THEN 'ESTRATEGIAS'::text
                    WHEN cat.alias::text = ANY (ARRAY['we_social_media_instagram'::character varying::text, 'we_social_media_linkedin'::character varying::text, 'we_social_media_facebook'::character varying::text, 'we_social_media_estados'::character varying::text]) THEN 'MARKETING'::text
                    WHEN cat.alias::text = ANY (ARRAY['we_social_media_wechat'::character varying::text, 'we_social_media_other'::character varying::text]) THEN 'OTROS'::text
                    ELSE 'OTROS'::text
                END AS origin_group,
                CASE
                    WHEN lb.cat_type_strategy IS NOT NULL THEN COALESCE(cat_strat.description, 'Estrategia Desconocida'::character varying)
                    ELSE COALESCE(cat.description, 'Desconocido'::character varying)
                END AS origin_name,
            count(*) AS qty
           FROM leads_base lb
             LEFT JOIN catalog cat ON cat.catalog_id = lb.cat_channel
             LEFT JOIN catalog cat_strat ON cat_strat.catalog_id = lb.cat_type_strategy
          GROUP BY lb.program_edition_id, (
                CASE
                    WHEN lb.cat_type_strategy IS NOT NULL THEN 'ESTRATEGIAS'::text
                    WHEN cat.alias::text = ANY (ARRAY['we_social_media_instagram'::character varying::text, 'we_social_media_linkedin'::character varying::text, 'we_social_media_facebook'::character varying::text, 'we_social_media_estados'::character varying::text]) THEN 'MARKETING'::text
                    WHEN cat.alias::text = ANY (ARRAY['we_social_media_wechat'::character varying::text, 'we_social_media_other'::character varying::text]) THEN 'OTROS'::text
                    ELSE 'OTROS'::text
                END), (
                CASE
                    WHEN lb.cat_type_strategy IS NOT NULL THEN COALESCE(cat_strat.description, 'Estrategia Desconocida'::character varying)
                    ELSE COALESCE(cat.description, 'Desconocido'::character varying)
                END)
        ), clients_counts AS (
         SELECT lb.program_edition_id,
            COALESCE(cat.description, 'Sin Clasificar'::character varying) AS client_type,
            count(*) AS qty
           FROM leads_base lb
             LEFT JOIN catalog cat ON cat.catalog_id = lb.cat_client_moment
          GROUP BY lb.program_edition_id, (COALESCE(cat.description, 'Sin Clasificar'::character varying))
        ), funnel_counts AS (
         SELECT lb.program_edition_id,
            COALESCE(cat.description, 'Sin Estado'::character varying) AS status_name,
            cat.alias,
            count(*) AS qty
           FROM leads_base lb
             LEFT JOIN catalog cat ON cat.catalog_id = lb.cat_status_lead
          GROUP BY lb.program_edition_id, (COALESCE(cat.description, 'Sin Estado'::character varying)), cat.alias
        ), json_advisors AS (
         SELECT advisors_counts.program_edition_id,
            jsonb_agg(jsonb_build_object('name', advisors_counts.advisor_name, 'count', advisors_counts.qty)) AS json_data
           FROM advisors_counts
          GROUP BY advisors_counts.program_edition_id
        ), json_origins AS (
         SELECT origins_counts.program_edition_id,
            jsonb_agg(jsonb_build_object('group', origins_counts.origin_group, 'name', origins_counts.origin_name, 'count', origins_counts.qty)) AS json_data
           FROM origins_counts
          GROUP BY origins_counts.program_edition_id
        ), json_clients AS (
         SELECT clients_counts.program_edition_id,
            jsonb_agg(jsonb_build_object('name', clients_counts.client_type, 'count', clients_counts.qty)) AS json_data
           FROM clients_counts
          GROUP BY clients_counts.program_edition_id
        ), json_funnel AS (
         SELECT funnel_counts.program_edition_id,
            jsonb_agg(jsonb_build_object('name', funnel_counts.status_name, 'alias', funnel_counts.alias, 'count', funnel_counts.qty)) AS json_data
           FROM funnel_counts
          GROUP BY funnel_counts.program_edition_id
        )
 SELECT pe.edition_num_id,
    EXTRACT(year FROM pe.start_date)::integer AS anio,
        CASE EXTRACT(month FROM pe.start_date)
            WHEN 1 THEN 'Enero'::text
            WHEN 2 THEN 'Febrero'::text
            WHEN 3 THEN 'Marzo'::text
            WHEN 4 THEN 'Abril'::text
            WHEN 5 THEN 'Mayo'::text
            WHEN 6 THEN 'Junio'::text
            WHEN 7 THEN 'Julio'::text
            WHEN 8 THEN 'Agosto'::text
            WHEN 9 THEN 'Septiembre'::text
            WHEN 10 THEN 'Octubre'::text
            WHEN 11 THEN 'Noviembre'::text
            WHEN 12 THEN 'Diciembre'::text
            ELSE NULL::text
        END AS mes_nombre,
    EXTRACT(month FROM pe.start_date)::integer AS mes_num,
    cat_seg.description AS categoria,
    cat_cat.description AS linea,
    p.program_name AS programa,
    cat_catx.description AS tipo,
    pe.start_date AS fecha_inicio,
    pe.global_code AS codigo_edicion,
    COALESCE(peg.revenue_goal, 0::numeric) AS meta_monto,
    COALESCE(peg.vacant_goal, 0) AS meta_vacantes,
    COALESCE(agg.total_ventas_monto, 0::numeric) AS venta_monto,
    COALESCE(ls.leads_vendidos_cnt, 0::bigint) AS venta_cantidad,
        CASE
            WHEN COALESCE(peg.revenue_goal, 0::numeric) > 0::numeric THEN round(COALESCE(agg.total_ventas_monto, 0::numeric) / peg.revenue_goal * 100::numeric, 1)
            ELSE 0::numeric
        END AS porcentaje_logro_monto,
        CASE
            WHEN COALESCE(peg.vacant_goal, 0) > 0 THEN round(COALESCE(agg.total_ventas_cnt, 0::bigint)::numeric / peg.vacant_goal::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS porcentaje_logro_vacantes,
    COALESCE(ja.json_data, '[]'::jsonb) AS breakdown_asesores,
    COALESCE(jo.json_data, '[]'::jsonb) AS breakdown_origen,
    COALESCE(jc.json_data, '[]'::jsonb) AS breakdown_clientes,
    COALESCE(jf.json_data, '[]'::jsonb) AS breakdown_estado_comercial
   FROM program_editions pe
     JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
     JOIN programs p ON p.program_id = pv.program_id
     LEFT JOIN catalog cat_seg ON cat_seg.catalog_id = pe.cat_segment
     LEFT JOIN catalog cat_cat ON cat_cat.catalog_id = p.cat_category
     LEFT JOIN catalog cat_catx ON cat_catx.catalog_id = p.cat_type_program
     LEFT JOIN program_edition_goals peg ON peg.edition_num_id = pe.edition_num_id
     LEFT JOIN sales_agg agg ON agg.program_edition_id = pe.edition_num_id
     LEFT JOIN json_advisors ja ON ja.program_edition_id = pe.edition_num_id
     LEFT JOIN json_origins jo ON jo.program_edition_id = pe.edition_num_id
     LEFT JOIN json_clients jc ON jc.program_edition_id = pe.edition_num_id
     LEFT JOIN json_funnel jf ON jf.program_edition_id = pe.edition_num_id
     LEFT JOIN leads_sales ls ON ls.program_edition_id = pe.edition_num_id
  WHERE pe.active = ANY (ARRAY['Y'::bpchar, '1'::bpchar]);