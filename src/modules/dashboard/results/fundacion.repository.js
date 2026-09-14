import { pool } from '../../../shared/db/pool.js'
import { editionRepository } from '../../edition/edition.repository.js'
import { PARENT_OR_CC_DESTINATION, EXCLUDE_IMPORTED } from '../../integration/integration.repository.js'
import { RANKING_LIMIT } from './results.entity.js'

// Filas crudas del panel de Fundación. Fundación vende entradas a eventos y
// otorga becas; su "equipo" es un canal (agent_origin 'FWE'), no un grupo de
// usuarios, por eso el alcance del líder no filtra estas consultas.

// Venta viva: sin baja (retiro, reprogramación, cambio de curso, anulación),
// sin hijos de paquete y sin la importación masiva. Asume `e` y `st`.
const LIVE_SALE = `
         e.active = 'Y'
         AND COALESCE(st.alias, '') NOT IN ('we_enrollment_status_retired', 'we_enrollment_status_reprogrammed',
                                            'we_enrollment_status_course_changed', 'we_enrollment_status_annulment')
         ${PARENT_OR_CC_DESTINATION}
         ${EXCLUDE_IMPORTED}`

// FROM + WHERE de una venta de Fundación. La regla 1.5 es la misma de AREA_CASE
// (edition.repository.js) para que el panel y el reporte de Objetivos del evento
// acrediten las mismas ventas a Fundación.
const FUNDACION_SALES = `
    FROM public.enrollments e
    LEFT JOIN public.users u ON u.user_id = e.seller_agent_id
    LEFT JOIN public.catalog st ON st.catalog_id = e.cat_type_status
   WHERE ${LIVE_SALE}
     AND (e.agent_origin = 'FWE' OR u.alias ILIKE '%FUN%')`

// USD a soles con el mismo tipo fijo que v_gerencia_funnel.
const AMOUNT_PEN = `CASE WHEN e.cat_currency = 3042 THEN e.total_amount * 3.75 ELSE e.total_amount END`

// Mes en curso (meses_atras 0) y los 6 anteriores, con los meses vacíos en cero:
// si un mes sin movimiento no aparece, la mediana solo vería los meses buenos.
const LAST_SEVEN_MONTHS = `
  meses AS (
    SELECT gs::date AS mes, (row_number() OVER (ORDER BY gs DESC) - 1)::int AS meses_atras
      FROM generate_series(date_trunc('month', current_date) - interval '6 months',
                           date_trunc('month', current_date), interval '1 month') gs
  )`

// El alcance (primer argumento) no se usa: Fundación se mide por canal.
export async function fetchFundacionRaw (_scope, db = pool) {
  const [tramo, ventasPorMes, programas, becas, evento] = await Promise.all([
    // Mes en curso contra el MISMO tramo del anterior (del 1 al día de hoy):
    // contra el mes completo, cualquier día 10 parecería una caída.
    db.query(`
      WITH v AS (
        SELECT e.registration_date::date AS dia, ${AMOUNT_PEN} AS monto
        ${FUNDACION_SALES}
           AND e.registration_date >= date_trunc('month', current_date) - interval '1 month'
           AND e.registration_date::date <= current_date
      )
      SELECT count(*) FILTER (WHERE dia >= date_trunc('month', current_date))::int AS ventas,
             COALESCE(sum(monto) FILTER (WHERE dia >= date_trunc('month', current_date)), 0)::float AS monto,
             count(*) FILTER (WHERE dia < date_trunc('month', current_date)
                                AND dia <= (current_date - interval '1 month')::date)::int AS ventas_prev,
             COALESCE(sum(monto) FILTER (WHERE dia < date_trunc('month', current_date)
                                           AND dia <= (current_date - interval '1 month')::date), 0)::float AS monto_prev
        FROM v`),

    // Ventas por mes: el gráfico cuando no hay evento con meta que mirar.
    db.query(`
      WITH ${LAST_SEVEN_MONTHS},
      v AS (
        SELECT date_trunc('month', e.registration_date)::date AS mes, ${AMOUNT_PEN} AS monto
        ${FUNDACION_SALES}
           AND e.registration_date >= date_trunc('month', current_date) - interval '6 months'
           AND e.registration_date::date <= current_date
      )
      SELECT m.meses_atras, count(v.mes)::int AS ventas, COALESCE(sum(v.monto), 0)::float AS monto
        FROM meses m
        LEFT JOIN v ON v.mes = m.mes
       GROUP BY m.meses_atras
       ORDER BY m.meses_atras`),

    // Qué programas mueve Fundación este mes. El top se corta en la BD: el panel
    // no muestra más que RANKING_LIMIT y el resto vive en el módulo.
    db.query(`
      SELECT p.program_name AS programa, count(*)::int AS ventas, COALESCE(sum(v.monto), 0)::float AS monto
        FROM (SELECT e.program_version_id, ${AMOUNT_PEN} AS monto
              ${FUNDACION_SALES}
                 AND e.registration_date >= date_trunc('month', current_date)
                 AND e.registration_date::date <= current_date) v
        JOIN public.program_versions pv ON pv.program_version_id = v.program_version_id
        JOIN public.programs p ON p.program_id = pv.program_id
       GROUP BY p.program_name
       ORDER BY ventas DESC, monto DESC
       LIMIT $1`, [RANKING_LIMIT]),

    // Becas del canal FWE por mes (decisión del usuario: solo las del asesor FWE).
    db.query(`
      WITH ${LAST_SEVEN_MONTHS},
      becas AS (
        SELECT date_trunc('month', e.registration_date)::date AS mes, cs.alias AS certificado
          FROM public.enrollments e
          LEFT JOIN public.catalog st ON st.catalog_id = e.cat_type_status
          LEFT JOIN public.catalog cs ON cs.catalog_id = e.cat_certificate_status
         WHERE ${LIVE_SALE}
           AND e.agent_origin = 'FWE'
           AND EXISTS (SELECT 1 FROM public.enrollment_discounts ed
                         JOIN public.discounts d ON d.discount_id = ed.discount_id
                        WHERE ed.enrollment_id = e.enrollment_id AND d.description ILIKE '%beca%')
           AND e.registration_date >= date_trunc('month', current_date) - interval '6 months'
           AND e.registration_date::date <= current_date
      )
      SELECT m.meses_atras,
             count(b.mes)::int AS becas,
             count(*) FILTER (WHERE b.certificado = 'we_certificate_status_paid')::int AS certificado_pagado
        FROM meses m
        LEFT JOIN becas b ON b.mes = m.mes
       GROUP BY m.meses_atras
       ORDER BY m.meses_atras`),

    // El evento a mirar: el próximo con meta de Fundación; si ya pasaron todos,
    // el más reciente del último mes (su resultado final sigue siendo noticia).
    db.query(`
      SELECT pe.edition_num_id, p.program_name AS evento, to_char(pe.start_date, 'DD/MM') AS inicio,
             (pe.start_date - current_date)::int AS dias, g.channel_goals -> '1.5' AS meta
        FROM public.program_edition_goals g
        JOIN public.program_editions pe ON pe.edition_num_id = g.edition_num_id
        JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
        JOIN public.programs p ON p.program_id = pv.program_id
       WHERE g.channel_goals ? '1.5'
         AND pe.active = 'Y'
         AND pe.start_date >= current_date - 30
       ORDER BY pe.start_date >= current_date DESC, abs(pe.start_date - current_date)
       LIMIT 1`)
  ])

  const proximo = evento.rows[0] ?? null
  return {
    tramo: tramo.rows[0],
    ventasPorMes: ventasPorMes.rows,
    programas: programas.rows,
    becasPorMes: becas.rows,
    evento: proximo && { ...proximo, areas: await editionRepository.eventReportAreas(proximo.edition_num_id) }
  }
}
