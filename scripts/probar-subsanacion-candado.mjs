// Check del candado del lead en los tres escenarios que importan, cada uno
// dentro de su propio ROLLBACK (no deja rastro, se puede correr en produccion).
//
// 1. Comercial corrige el lead con la venta aun OBSERVADA  -> debe permitir.
// 2. El SP de subsanacion ya devolvio la venta a Pendiente
//    y marco la transaccion                                -> debe permitir.
// 3. Un lead con venta normal, sin marca                   -> debe seguir bloqueado.
//
// El 3 es el que evita que el arreglo se coma la proteccion original.
import { pool } from './db.mjs'

const db = await pool.connect()
const { rows: [{ bd }] } = await db.query('SELECT current_database() AS bd')

const { rows: [cat] } = await db.query(
  `SELECT (SELECT catalog_id FROM catalog WHERE alias='we_enrollment_status_pending')  AS pendiente,
          (SELECT catalog_id FROM catalog WHERE alias='we_enrollment_status_observed') AS observado`)

const buscarLead = (observado) => db.query(
  `SELECT l.lead_id AS "leadId", l.enrollment_id AS "enrollmentId" FROM leads l
     JOIN enrollments e ON e.enrollment_id = l.enrollment_id
    WHERE e.cat_fico_status ${observado ? '=' : 'IS DISTINCT FROM'} $1 LIMIT 1`, [cat.observado])

const TOCAR_LEAD = `UPDATE leads SET origin_email='prueba@we.pe', modification_date=NOW() WHERE lead_id=$1`

async function escenario (nombre, { leadId, enrollmentId, aPendiente, marcar }, esperado) {
  await db.query('BEGIN')
  let obtenido
  try {
    if (aPendiente) {
      await db.query('UPDATE enrollments SET cat_fico_status=$1 WHERE enrollment_id=$2', [cat.pendiente, enrollmentId])
    }
    if (marcar) {
      await db.query(`SELECT set_config('we.resubmit_lead_id', $1, true)`, [String(leadId)])
    }
    await db.query(TOCAR_LEAD, [leadId])
    obtenido = 'permitido'
  } catch {
    obtenido = 'bloqueado'
  } finally {
    await db.query('ROLLBACK')
  }
  const ok = obtenido === esperado
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}: ${obtenido} (esperado ${esperado})`)
  return ok
}

const { rows: [obs] } = await buscarLead(true)
const { rows: [normal] } = await buscarLead(false)
console.log(`BD: ${bd} | lead observado ${obs?.leadId} | lead normal ${normal?.leadId}\n`)

const resultados = [
  await escenario('venta observada, sin marca', { ...obs }, 'permitido'),
  await escenario('subsanacion: ya Pendiente + marca', { ...obs, aPendiente: true, marcar: true }, 'permitido'),
  await escenario('venta normal, sin marca', { ...normal }, 'bloqueado')
]

db.release()
await pool.end()
process.exit(resultados.every(Boolean) ? 0 : 1)
