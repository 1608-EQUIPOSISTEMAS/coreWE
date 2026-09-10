// One-off: pasa el asesor de una lista de inscripciones a "solo B2B"
// (seller_agent_id = NULL, agent_origin = 'B2B'), que es lo que produce la
// etiqueta "B2B" a secas en la columna Asesor de FICO.
//
// Replica el flujo del usecase editSellerAgent (setSellerAgent + logAudit) para
// que quede el mismo rastro en el Historial de la inscripcion que si el cambio
// se hubiera hecho desde la pantalla.
//
//   node scripts/set-asesor-b2b.mjs                        -> dry-run local
//   node scripts/set-asesor-b2b.mjs --produccion           -> dry-run produccion
//   node scripts/set-asesor-b2b.mjs --produccion --aplicar -> escribe en produccion
//
// --produccion lee la URL del tunel de .env.bak-produccion, para no dejar la
// contrasena en la linea de comandos ni tocar el .env del backend.
import fs from 'node:fs'

const ENROLLMENT_IDS = [18507, 18508]
const JUSTIFICACION = 'Correccion de canal: la venta corresponde a Convenios (B2B).'
const PERFORMED_BY = 9 // ADMIN: el cambio se aplico por script, no desde la pantalla

if (process.argv.includes('--produccion')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8')
    .match(/^DATABASE_URL=(.+)$/m)[1].trim()
}
const { q, pool } = await import('./db.mjs')

const fmtAgent = (alias, origin) =>
  alias && origin ? `${origin} - ${alias}` : alias || origin || '(sin asesor)'

const { rows: actuales } = await q(`
  SELECT e.enrollment_id, e.seller_agent_id, e.agent_origin, u.alias, cf.alias AS fico_status
    FROM enrollments e
    LEFT JOIN users u ON u.user_id = e.seller_agent_id
    LEFT JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
   WHERE e.enrollment_id = ANY($1)
   ORDER BY e.enrollment_id`, [ENROLLMENT_IDS])

console.table(actuales)

const faltantes = ENROLLMENT_IDS.filter(id => !actuales.some(r => r.enrollment_id === id))
if (faltantes.length) throw new Error(`No existen en esta BD: ${faltantes.join(', ')}`)

if (!process.argv.includes('--aplicar')) {
  console.log('\nDRY-RUN. Agregar --aplicar para escribir.')
  await pool.end()
  process.exit(0)
}

// Una sola transaccion: si falla el audit, el UPDATE tampoco queda. A diferencia
// del usecase (donde auditar es best-effort), aca el rastro es parte del pedido.
await q('BEGIN')
try {
  for (const row of actuales) {
    await q('UPDATE enrollments SET seller_agent_id = NULL, agent_origin = $1 WHERE enrollment_id = $2',
      ['B2B', row.enrollment_id])

    const antes = fmtAgent(row.alias, row.agent_origin)
    await q(`
      INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
      VALUES ($1, 'seller_agent_changed', $2, $3, $4::jsonb, $5)`, [
      row.enrollment_id,
      PERFORMED_BY,
      JUSTIFICACION,
      JSON.stringify({ Asesor: { old: antes, new: 'B2B' } }),
      `Asesor: ${antes} → B2B`
    ])
    console.log(`#${row.enrollment_id}: ${antes} -> B2B`)
  }
  await q('COMMIT')
} catch (err) {
  await q('ROLLBACK')
  throw err
}

const { rows: despues } = await q(`
  SELECT e.enrollment_id, e.seller_agent_id, e.agent_origin,
         (SELECT count(*) FROM enrollment_audit_log a
           WHERE a.enrollment_id = e.enrollment_id AND a.action = 'seller_agent_changed') AS audits
    FROM enrollments e WHERE e.enrollment_id = ANY($1) ORDER BY 1`, [ENROLLMENT_IDS])
console.table(despues)
await pool.end()
