// Revierte la confirmacion de pago de UNA cuota: la devuelve a pendiente y da de
// baja el pago que se creo al confirmarla. Se usa cuando FICO confirma la cuota
// equivocada; la plata nunca entro, asi que la fila de payments no puede quedar
// viva sumando al PAGADO del listado.
//
// Los pagos se dan de BAJA LOGICA (active='N'), no se borran: es como ya vive el
// resto de la tabla (ver payment_id 2825 del 3290) y conserva voucher, numero de
// operacion y fecha por si el pago aparece despues.
//
// El estado destino NO se hardcodea: se toma de las cuotas hermanas vivas del
// mismo enrollment, porque conviven dos catalogos de estado de cuota
// (we_inst_* 445x y we_payment_status_* 247x/3174) y meter el del namespace
// equivocado deja la cuota con una etiqueta que no cuadra con sus hermanas.
//
// Uso:
//   node scripts/revertir-cuota-a-pendiente.mjs <enrollmentId> <nroCuota> [--aplicar] [--produccion]
// Sin --aplicar hace un ensayo (rollback al final) y muestra el antes/despues.
// Sin --produccion va contra la BD local de pruebas.
import fs from 'node:fs'
import pg from 'pg'

const BD_PRUEBAS = 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev'

// La contrasena de produccion no se pasa por el shell ni se hardcodea: se lee de
// la linea DATABASE_URL del tunel que vive comentada en Backend/.env.
function produccionUrl () {
  const url = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map(l => l.trim().replace(/^#\s*/, ''))
    .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432'))
    ?.slice('DATABASE_URL='.length)
  if (!url) throw new Error('No encontre la linea de produccion (tunel 55432) en Backend/.env')
  return url
}

const PAID_STATUS_IDS = [4454, 2471]
const CAT_STATUS_ANNULLED = 4456
const FALLBACK_PENDING_STATUS = 2470 // we_payment_status_pending
const AUDIT_ACTION = 'edited'
// performed_by NULL: la bitacora lo muestra como "Sistema". Firmar con el
// user_id de una persona que no ejecuto el cambio seria mentir en el historial.
const SYSTEM_USER_ID = null
const JUSTIFICACION = 'Edicion de estado por solicitud de FICO'

const [enrollmentIdArg, installmentNumberArg] = process.argv.slice(2)
const aplicar = process.argv.includes('--aplicar')
const produccion = process.argv.includes('--produccion')
const enrollmentId = Number(enrollmentIdArg)
const installmentNumber = Number(installmentNumberArg)
if (!enrollmentId || !Number.isInteger(installmentNumber)) {
  throw new Error('Uso: node scripts/revertir-cuota-a-pendiente.mjs <enrollmentId> <nroCuota> [--aplicar] [--produccion]')
}

const pool = new pg.Pool({
  connectionString: produccion ? produccionUrl() : BD_PRUEBAS,
  max: 2,
  connectionTimeoutMillis: 15000,
  keepAlive: true
})
console.log(`BD: ${produccion ? 'PRODUCCION (tunel 55432)' : 'pruebas local (5433)'}`)

// Estado al que vuelve la cuota: el que llevan sus hermanas no pagadas ni
// anuladas. Si es la unica cuota viva, cae al pendiente del catalogo nuevo.
async function resolveTargetStatus (client) {
  const { rows } = await client.query(`
    SELECT cat_status, COUNT(*) AS n
      FROM payment_installments
     WHERE enrollment_id = $1 AND installment_number > 0
       AND cat_status <> ALL($2::int[]) AND cat_status <> $3
     GROUP BY cat_status ORDER BY n DESC, cat_status LIMIT 1
  `, [enrollmentId, PAID_STATUS_IDS, CAT_STATUS_ANNULLED])
  return rows[0]?.cat_status ?? FALLBACK_PENDING_STATUS
}

async function snapshot (client) {
  const { rows: cuota } = await client.query(`
    SELECT i.*, c.alias AS status_alias, c.description AS status_label
      FROM payment_installments i
      LEFT JOIN catalog c ON c.catalog_id = i.cat_status
     WHERE i.enrollment_id = $1 AND i.installment_number = $2
  `, [enrollmentId, installmentNumber])
  if (!cuota[0]) throw new Error(`La inscripcion ${enrollmentId} no tiene cuota ${installmentNumber}`)
  const { rows: pagos } = await client.query(
    'SELECT * FROM payments WHERE installment_id = $1 ORDER BY payment_id',
    [cuota[0].installment_id]
  )
  return { cuota: cuota[0], pagos }
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const antes = await snapshot(client)
  if (!PAID_STATUS_IDS.includes(Number(antes.cuota.cat_status))) {
    throw new Error(`La cuota ${installmentNumber} no esta pagada (estado ${antes.cuota.status_label}): no hay nada que revertir`)
  }

  const targetStatus = await resolveTargetStatus(client)
  const pagosVivos = antes.pagos.filter(p => p.active === 'Y')

  await client.query(
    'UPDATE payment_installments SET cat_status = $1 WHERE installment_id = $2',
    [targetStatus, antes.cuota.installment_id]
  )
  const { rowCount: bajas } = await client.query(
    "UPDATE payments SET active = 'N' WHERE installment_id = $1 AND active = 'Y'",
    [antes.cuota.installment_id]
  )

  const detalleBajas = pagosVivos.map(p => `#${p.payment_id} S/. ${p.amount}`).join(', ') || 'ninguno'
  await client.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
  `, [
    enrollmentId, AUDIT_ACTION, SYSTEM_USER_ID, JUSTIFICACION,
    JSON.stringify({ [`Cuota ${installmentNumber}`]: { old: antes.cuota.status_label, new: 'Pendiente' } }),
    `Cuota ${installmentNumber} devuelta a Pendiente: la confirmacion de pago fue un error de FICO. Pago dado de baja: ${detalleBajas}.`
  ])

  const despues = await snapshot(client)
  console.log('ANTES  ', { estado: antes.cuota.status_label, pagos_activos: pagosVivos.length })
  console.log('DESPUES', { estado: despues.cuota.status_label, pagos_activos: despues.pagos.filter(p => p.active === 'Y').length, pagos_de_baja: bajas })

  if (!aplicar) {
    await client.query('ROLLBACK')
    console.log('\nENSAYO: nada se guardo. Volve a correr con --aplicar.')
  } else {
    const respaldo = `scripts/_backup_cuota_${enrollmentId}_${installmentNumber}.json`
    fs.writeFileSync(respaldo, JSON.stringify(antes, null, 2))
    await client.query('COMMIT')
    console.log(`\nAPLICADO. Respaldo del estado previo en ${respaldo}`)
  }
} catch (err) {
  await client.query('ROLLBACK')
  console.error('FALLO, nada se guardo:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
