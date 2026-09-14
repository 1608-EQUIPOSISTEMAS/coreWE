import { pool } from '../../../shared/db/pool.js'
import { PARENT_OR_CC_DESTINATION } from '../../integration/integration.repository.js'

// Filas crudas del panel de Producto. La regla de "venta" es la de Gerencia
// (v_gerencia_funnel): padre o destino de CC, sin el estado 3135. No se usa
// v_dashboard_program_goals: cuenta hijos de paquete y mezcla leads con matrículas.
//
// A5 (edición cancelada) queda fuera de llenado y riesgo: una edición que ya no
// abre no puede "caerse". Solo entra en la tasa de cancelación, que la mide.
const NOT_CANCELLED = `COALESCE(seg.alias, '') <> 'we_segment_a5'`

export async function fetchProductoRaw (_scope, db = pool) {
  const [proximas, llenadoT14, cancelacion, planificacion] = await Promise.all([
    // Ediciones que inician en los próximos 30 días, con su llenado de hoy.
    db.query(`
      SELECT f.edition_num_id, f.programa, f.codigo_edicion,
             f.fecha_inicio::text AS fecha_inicio,
             (f.fecha_inicio - CURRENT_DATE)::int AS dias,
             f.ventas, f.meta_ventas
        FROM public.v_gerencia_funnel f
        JOIN public.program_editions pe ON pe.edition_num_id = f.edition_num_id
        LEFT JOIN public."catalog" seg ON seg.catalog_id = pe.cat_segment
       WHERE f.fecha_inicio BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
         AND ${NOT_CANCELLED}
       ORDER BY f.fecha_inicio, f.programa`),

    // Llenado a 14 días del inicio, agrupado por el mes en que cayó ese corte.
    // Es la comparación justa: la venta llega tarde (el llenado final supera el
    // 100%), así que el llenado de HOY solo se puede medir contra el de otras
    // ediciones a la misma distancia de su inicio. Solo cortes ya ocurridos.
    // ponytail: registration_date puede ser la fecha de importación y no la de
    // venta; si el histórico se ve raro, medir por primer pago.
    db.query(`
      WITH ed AS (
        SELECT pe.edition_num_id, pe.start_date::date - 14 AS corte, g.vacant_goal AS meta
          FROM public.program_editions pe
          JOIN public.program_edition_goals g
            ON g.edition_num_id = pe.edition_num_id AND g.vacant_goal > 0
          LEFT JOIN public."catalog" seg ON seg.catalog_id = pe.cat_segment
         WHERE pe.active = 'Y'
           AND ${NOT_CANCELLED}
           AND pe.start_date::date - 14 >= date_trunc('month', CURRENT_DATE) - interval '3 months'
           AND pe.start_date::date - 14 <= CURRENT_DATE
      )
      SELECT to_char(ed.corte, 'YYYY-MM') AS mes,
             COUNT(*)::int AS ediciones,
             SUM(ed.meta)::int AS meta,
             SUM((SELECT COUNT(*) FROM public.enrollments e
                   WHERE e.program_edition_id = ed.edition_num_id
                     AND e.active = 'Y'
                     AND e.cat_type_status <> 3135
                     ${PARENT_OR_CC_DESTINATION}
                     AND e.registration_date < ed.corte))::int AS ventas
        FROM ed
       GROUP BY 1
       ORDER BY 1`),

    // Cursos por mes de inicio y cuántos quedaron A5. Sin filtro de active: la
    // cancelación suele inactivar la edición (trg_update_segment_on_inactive),
    // y filtrarla escondería justo lo que se quiere contar.
    db.query(`
      SELECT to_char(pe.start_date, 'YYYY-MM') AS mes,
             COUNT(*)::int AS cursos,
             COUNT(*) FILTER (WHERE seg.alias = 'we_segment_a5')::int AS canceladas
        FROM public.program_editions pe
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        JOIN public.programs p          ON p.program_id = pv.program_id
        JOIN public."catalog" ctp       ON ctp.catalog_id = p.cat_type_program
                                       AND ctp.alias = 'we_program_type_course'
        LEFT JOIN public."catalog" seg  ON seg.catalog_id = pe.cat_segment
       WHERE pe.start_date >= date_trunc('month', CURRENT_DATE) - interval '6 months'
         AND pe.start_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
       GROUP BY 1
       ORDER BY 1`),

    // Items del borrador de Planificación que ya deberían estar en el
    // cronograma. items.active = false es una fila descartada del plan.
    db.query(`
      SELECT COUNT(*)::int AS sin_publicar,
             MIN(i->>'start_date') AS primera
        FROM public.schedule_plans sp
        CROSS JOIN LATERAL jsonb_array_elements(sp.items) i
       WHERE sp.active = 'Y'
         AND (i->>'active')::boolean
         AND i->>'published_edition_id' IS NULL
         AND (i->>'start_date')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90`)
  ])

  return {
    proximas: proximas.rows,
    llenadoT14: llenadoT14.rows,
    cancelacion: cancelacion.rows,
    planificacion: planificacion.rows[0] ?? { sin_publicar: 0, primera: null }
  }
}
