// Sondeo de las inscripciones retenidas del sync a Sheets (HELD_ENROLLMENT_IDS
// en integration.repository.js): ordenes de pago del flujo antiguo que no se
// cuentan hasta que el alumno pague.
//
// Sirve para dos cosas: confirmar que los ids retenidos son los que el negocio
// pidio (correo/persona), y despues, para ver cual ya pago y sacarlo de la lista.
//   cd Backend && node scripts/probe-held-enrollments.mjs
import { q, pool } from './db.mjs'
import { HELD_ENROLLMENT_IDS } from '../src/modules/integration/integration.repository.js'

const { rows } = await q(`
  SELECT e.enrollment_id                                   AS id,
         e.parent_enrollment_id                            AS padre,
         cf.alias                                          AS estado_fico,
         e.active,
         COALESCE(l.email, p.email, '')                    AS correo,
         TRIM(COALESCE(p.names,'') || ' ' || COALESCE(p.surnames,'')) AS persona,
         e.total_amount                                    AS total,
         COALESCE(SUM(py.amount) FILTER (WHERE py.active = 'Y'), 0) AS pagado,
         COUNT(py.payment_id) FILTER (WHERE py.active = 'Y')        AS n_pagos,
         (SELECT COUNT(*) FROM public.enrollments h
           WHERE h.parent_enrollment_id = e.enrollment_id)  AS hijos
    FROM public.enrollments e
    LEFT JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN public.persons  p   ON p.person_id   = e.person_id
    LEFT JOIN public.leads    l   ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.payments py  ON py.enrollment_id = e.enrollment_id
   WHERE e.enrollment_id = ANY($1::int[])
   GROUP BY e.enrollment_id, cf.alias, l.email, p.email, p.names, p.surnames
   ORDER BY e.enrollment_id`, [HELD_ENROLLMENT_IDS])

console.table(rows)

const faltantes = HELD_ENROLLMENT_IDS.filter(id => !rows.some(r => r.id === id))
if (faltantes.length) console.warn('IDs retenidos que no existen en la BD:', faltantes)

await pool.end()
