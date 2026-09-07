// Impacto del fix del ASESOR de los hijos: cuantos pasan de 'SA' a un asesor
// real y cuantos se quedan en 'SA' porque su propia venta raiz no tiene asesor
// (dato que el ERP nunca capturo, no algo que el listado pueda resolver).
import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const { rows } = await pool.query(`
  WITH hijos AS (
    SELECT e.enrollment_id, public.fn_enrollment_sale_root(e.enrollment_id) AS raiz
      FROM enrollments e
     WHERE e.active = 'Y' AND e.parent_enrollment_id IS NOT NULL AND e.agent_origin = 'SA'
  )
  SELECT CASE
           WHEN COALESCE(NULLIF(r.agent_origin, 'SA'), u.alias) IS NOT NULL THEN 'hereda un asesor real'
           ELSE 'sigue SA (la venta raiz tampoco tiene asesor)'
         END AS resultado,
         COUNT(*)::int AS hijos
    FROM hijos h
    JOIN enrollments r ON r.enrollment_id = h.raiz
    LEFT JOIN users u ON u.user_id = r.seller_agent_id
   GROUP BY 1 ORDER BY hijos DESC`)

console.log('Hijos que hoy muestran SA en el listado:')
console.table(rows)

const { rows: muestra } = await pool.query(`
  SELECT e.enrollment_id AS hijo, h.raiz,
         COALESCE(NULLIF(r.agent_origin, 'SA') || ' - ' || u.alias,
                  NULLIF(r.agent_origin, 'SA'), u.alias) AS pasa_a_mostrar
    FROM enrollments e
    JOIN LATERAL (SELECT public.fn_enrollment_sale_root(e.enrollment_id) AS raiz) h ON TRUE
    JOIN enrollments r ON r.enrollment_id = h.raiz
    LEFT JOIN users u ON u.user_id = r.seller_agent_id
   WHERE e.active = 'Y' AND e.parent_enrollment_id IS NOT NULL AND e.agent_origin = 'SA'
     AND COALESCE(NULLIF(r.agent_origin, 'SA'), u.alias) IS NOT NULL
   ORDER BY e.enrollment_id DESC LIMIT 8`)
console.log('\nMuestra de los que cambian:')
console.table(muestra)

// Las raices con 'SA' son ventas sin asesor capturado: el fix no las inventa.
const { rows: [raices] } = await pool.query(`
  SELECT COUNT(*)::int AS ventas_raiz_sin_asesor
    FROM enrollments e
   WHERE e.active = 'Y' AND e.parent_enrollment_id IS NULL
     AND e.agent_origin = 'SA' AND e.seller_agent_id IS NULL`)
console.log('\nVentas raiz sin asesor (residuo que ningun listado puede resolver):', raices.ventas_raiz_sin_asesor)

await pool.end()
