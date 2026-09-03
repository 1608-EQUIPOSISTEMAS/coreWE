// One-off 2026-09-02: borra en PRODUCCION la inscripcion 16990 (HAIR ALEXANDER
// RAMOS, V CONGRESO DE DIRECCION E1, "Invitado Especial", monto 0).
//
// El boton "Eliminar" del ERP falla contra cualquier venta nacida de un lead:
// deleteEnrollmentCascade desengancha el lead con UPDATE leads SET
// enrollment_id = NULL y el trigger block_update_when_enrolled lo rechaza, lo
// que tumba la transaccion entera. Aqui se apaga ese trigger SOLO dentro de la
// transaccion (ALTER ... DISABLE TRIGGER toma lock y se revierte en el ROLLBACK
// o termina con el COMMIT), replicando el resto de la cascada tal cual.
import fs from 'node:fs'
import { pool } from './db.mjs'

const ID = 16990
const client = await pool.connect()

const respaldar = async (nombre, sql) => {
  const { rows } = await client.query(sql, [ID])
  return [nombre, rows]
}

try {
  const destino = (await client.query('SELECT current_database() db, inet_server_port() port')).rows[0]
  console.log(`BD destino: ${destino.db}:${destino.port}`)

  const respaldo = Object.fromEntries(await Promise.all([
    respaldar('enrollments', 'SELECT * FROM enrollments WHERE enrollment_id=$1 OR parent_enrollment_id=$1'),
    respaldar('payments', 'SELECT * FROM payments WHERE enrollment_id=$1'),
    respaldar('payment_installments', 'SELECT * FROM payment_installments WHERE enrollment_id=$1'),
    respaldar('enrollment_discounts', 'SELECT * FROM enrollment_discounts WHERE enrollment_id=$1'),
    respaldar('email_logs', 'SELECT * FROM email_logs WHERE enrollment_id=$1'),
    respaldar('enrollment_audit_log', 'SELECT * FROM enrollment_audit_log WHERE enrollment_id=$1'),
    respaldar('leads', 'SELECT * FROM leads WHERE enrollment_id=$1')
  ]))
  const archivo = `scripts/_backup_${ID}_2026-09-02.json`
  fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 2))
  console.log(`respaldo -> ${archivo}`)

  if (respaldo.enrollments.length !== 1) throw new Error(`Esperaba 1 enrollment, hay ${respaldo.enrollments.length}`)

  await client.query('BEGIN')
  await client.query('ALTER TABLE leads DISABLE TRIGGER block_update_when_enrolled')

  for (const tabla of ['payments', 'payment_installments', 'enrollment_validations',
                       'enrollment_attachments', 'enrollment_audit_log', 'email_logs', 'payment_tokens']) {
    const r = await client.query(`DELETE FROM ${tabla} WHERE enrollment_id = $1`, [ID])
    console.log(`  ${tabla.padEnd(24)} ${r.rowCount}`)
  }

  const lead = await client.query(
    `UPDATE leads
        SET enrollment_id = NULL,
            cat_status_lead = COALESCE((SELECT catalog_id FROM catalog WHERE alias='we_lead_status_atendido' LIMIT 1), cat_status_lead)
      WHERE enrollment_id = $1`, [ID])
  console.log(`  leads desenganchados      ${lead.rowCount}`)

  const { rowCount } = await client.query('DELETE FROM enrollments WHERE enrollment_id = $1', [ID])
  if (rowCount !== 1) throw new Error(`DELETE enrollments devolvio ${rowCount}, esperaba 1`)

  await client.query('ALTER TABLE leads ENABLE TRIGGER block_update_when_enrolled')
  await client.query('COMMIT')
  console.log(`\nOK: inscripcion ${ID} eliminada.`)
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('FALLO, se revirtio todo:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
