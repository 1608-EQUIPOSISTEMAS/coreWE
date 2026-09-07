// Verifica el fix del ASESOR de los hijos de paquete en el listado FICO.
// Corre el SP tal como lo llama el panel y compara la etiqueta del padre con la
// de sus hijos. Sin argumentos apunta a la BD del .env (pruebas).
//
//   node scripts/probe-asesor-hijos.mjs [enrollment_id_del_padre]
import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const listar = async (q) => {
  const cli = await pool.connect()
  try {
    await cli.query('BEGIN')
    await cli.query("CALL public.sp_fico_enrollment_list($1, 'cur_asesor')", [JSON.stringify({ q, size: 50 })])
    const { rows } = await cli.query('FETCH ALL FROM cur_asesor')
    await cli.query('COMMIT')
    return rows
  } catch (e) { await cli.query('ROLLBACK'); throw e } finally { cli.release() }
}

// Padres de paquete con hijos SEG, que es donde se veia 'SA'.
const { rows: casos } = await pool.query(`
  SELECT p.enrollment_id AS padre, p.agent_origin AS canal_padre, up.alias AS asesor_padre,
         TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
         COUNT(h.enrollment_id)::int AS hijos
    FROM enrollments p
    JOIN enrollments h ON h.parent_enrollment_id = p.enrollment_id AND h.active = 'Y'
    JOIN customers cu ON cu.customer_id = p.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    LEFT JOIN users up ON up.user_id = p.seller_agent_id
   WHERE p.active = 'Y' AND h.agent_origin = 'SA'
     AND (p.agent_origin IS NOT NULL OR p.seller_agent_id IS NOT NULL)
   GROUP BY p.enrollment_id, p.agent_origin, up.alias, per.first_name, per.last_name
   ORDER BY p.enrollment_id DESC
   LIMIT ${Number(process.argv[3]) || 6}`)

const objetivo = process.argv[2]
const aRevisar = objetivo ? [{ padre: Number(objetivo) }] : casos

for (const c of aRevisar) {
  const filas = await listar(String(c.padre))
  const padre = filas.find(f => Number(f.enrollment_id) === Number(c.padre))
  if (!padre) { console.log(`#${c.padre}: no aparece en el listado`); continue }

  const nombre = padre.student_full_name
  const suyas = (await listar(nombre)).filter(f => f.student_full_name === nombre)
  console.log(`\n${nombre} (padre #${c.padre})`)
  for (const f of suyas) {
    const rol = Number(f.enrollment_id) === Number(c.padre) ? 'PADRE' : 'hijo '
    console.log(`  ${rol} #${f.enrollment_id}  asesor: ${f.seller_agent_name ?? '—'}`)
  }
}

await pool.end()
