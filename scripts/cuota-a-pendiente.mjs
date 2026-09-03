// Pasa UNA cuota de Borrador (o cualquier estado no pagado) a Pendiente.
//
// Distinto de revertir-cuota-a-pendiente.mjs: aquel deshace una confirmacion de
// pago (y da de baja el payment). Este solo corrige la ETIQUETA de estado, para
// cuando la cuota quedo en "Borrador - Pendiente aprobacion Finanzas" y FICO la
// necesita visible como "Pendiente".
//
// Se niega a tocar una cuota pagada: eso es trabajo del otro script, que ademas
// tiene que dar de baja el pago.
//
// Uso:
//   node scripts/cuota-a-pendiente.mjs <enrollmentId> <nroCuota> [--aplicar] [--produccion]
// Sin --aplicar hace un ensayo (rollback al final) y muestra el antes/despues.
import fs from 'node:fs'
import pg from 'pg'

const BD_PRUEBAS = 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev'

// La contrasena de produccion no se pasa por el shell ni se hardcodea: se lee de
// la linea DATABASE_URL del tunel que vive comentada en Backend/.env.
function produccionUrl () {
  const url = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').map(l => l.trim().replace(/^#\s*/, ''))
    .find(l => l.startsWith('DATABASE_URL=') && l.includes('55432'))?.slice('DATABASE_URL='.length)
  if (!url) throw new Error('No encontre la linea de produccion (tunel 55432) en Backend/.env')
  return url
}

const PAID_STATUS_IDS = [4454, 2471]
const PENDING_STATUS = 2470 // we_payment_status_pending — el "Pendiente" que usa el panel FICO
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
  throw new Error('Uso: node scripts/cuota-a-pendiente.mjs <enrollmentId> <nroCuota> [--aplicar] [--produccion]')
}

const pool = new pg.Pool({
  connectionString: produccion ? produccionUrl() : BD_PRUEBAS,
  max: 2,
  connectionTimeoutMillis: 15000,
  keepAlive: true
})
console.log(`BD: ${produccion ? 'PRODUCCION (tunel 55432)' : 'pruebas local (5433)'}`)

async function snapshot (client) {
  const { rows } = await client.query(`
    SELECT i.installment_id, i.installment_number, i.amount, i.due_date,
           i.cat_status, c.description AS estado
      FROM payment_installments i
      LEFT JOIN catalog c ON c.catalog_id = i.cat_status
     WHERE i.enrollment_id = $1 AND i.installment_number = $2
  `, [enrollmentId, installmentNumber])
  if (!rows[0]) throw new Error(`La inscripcion ${enrollmentId} no tiene cuota ${installmentNumber}`)
  return rows[0]
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const antes = await snapshot(client)
  if (PAID_STATUS_IDS.includes(Number(antes.cat_status))) {
    throw new Error(`La cuota ${installmentNumber} esta PAGADA: usa revertir-cuota-a-pendiente.mjs, que ademas da de baja el pago`)
  }
  if (Number(antes.cat_status) === PENDING_STATUS) {
    throw new Error(`La cuota ${installmentNumber} ya esta en Pendiente: no hay nada que hacer`)
  }

  await client.query(
    'UPDATE payment_installments SET cat_status = $1 WHERE installment_id = $2',
    [PENDING_STATUS, antes.installment_id]
  )

  await client.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
  `, [
    enrollmentId, AUDIT_ACTION, SYSTEM_USER_ID, JUSTIFICACION,
    JSON.stringify({ [`Cuota ${installmentNumber}`]: { old: antes.estado, new: 'Pendiente' } }),
    `Cuota ${installmentNumber} pasada de ${antes.estado} a Pendiente por pedido de FICO.`
  ])

  const despues = await snapshot(client)
  console.log('ANTES  ', { estado: antes.estado, cat_status: antes.cat_status })
  console.log('DESPUES', { estado: despues.estado, cat_status: despues.cat_status })

  if (!aplicar) {
    await client.query('ROLLBACK')
    console.log('\nENSAYO: nada se guardo. Volve a correr con --aplicar.')
  } else {
    await client.query('COMMIT')
    console.log('\nAPLICADO.')
  }
} catch (err) {
  await client.query('ROLLBACK')
  console.error('FALLO, nada se guardo:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
