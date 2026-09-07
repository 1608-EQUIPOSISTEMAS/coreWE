// Detector: ventas que un asesor de convenios cerro por token pero quedaron sin
// ninguna marca B2B, asi que no entran a la hoja "7. Convenios" ni cuentan como
// B2B en el cronograma. Es el hueco que tapa TokenRepository.stampB2bOriginFromAdvisor.
import { q, pool } from './db.mjs'

const SIN_MARCA_B2B = `NOT COALESCE(
        e.agent_origin = 'B2B' OR e.b2b_contract_id IS NOT NULL
        OR e.cat_b2b_doctype IS NOT NULL OR l.b2b = 'Y', FALSE)`

const { rows: asesores } = await q(`
  SELECT u.user_id, u.alias, string_agg(r.alias, ',') AS roles
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN rol r ON r.rol_id = ur.rol_id
   WHERE r.alias IN ('B2B', 'LIDER_B2B')
   GROUP BY u.user_id, u.alias ORDER BY u.user_id`)
console.log('Asesores con rol B2B:'); console.table(asesores)

const { rows: porToken } = await q(`
  SELECT DISTINCT e.enrollment_id, e.registration_date::date AS f_reg,
         u_pt.alias AS pidio_token, u_sell.alias AS seller_agent,
         e.agent_origin, COALESCE(l.b2b, '-') AS lead_b2b
    FROM enrollments e
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN users u_sell ON u_sell.user_id = e.seller_agent_id
    JOIN LATERAL (SELECT pt.* FROM payment_tokens pt
                   WHERE pt.enrollment_id = e.enrollment_id
                   ORDER BY pt.token_id LIMIT 1) pt ON TRUE
    JOIN users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
    JOIN user_roles ur ON ur.user_id = u_pt.user_id
    JOIN rol r ON r.rol_id = ur.rol_id AND r.alias IN ('B2B', 'LIDER_B2B')
   WHERE e.active = 'Y' AND ${SIN_MARCA_B2B}
   ORDER BY e.enrollment_id`)
console.log('Ventas por token de asesor B2B sin marca B2B:', porToken.length)
console.table(porToken)

const { rows: directas } = await q(`
  SELECT e.enrollment_id, e.registration_date::date AS f_reg, u.alias AS seller_agent,
         c.alias AS situacion_lead
    FROM enrollments e
    JOIN users u ON u.user_id = e.seller_agent_id
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN rol r ON r.rol_id = ur.rol_id AND r.alias IN ('B2B', 'LIDER_B2B')
    LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
    LEFT JOIN "catalog" c ON c.catalog_id = l.cat_prospect_situation
   WHERE e.active = 'Y' AND ${SIN_MARCA_B2B}
   ORDER BY e.enrollment_id`)
console.log('Ventas directas de un asesor B2B sin marca B2B:', directas.length)
console.table(directas)

await pool.end()
