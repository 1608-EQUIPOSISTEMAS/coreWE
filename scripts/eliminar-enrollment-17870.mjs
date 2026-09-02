// One-off: baja definitiva del enrollment 17870 (evento BECADO, total 0, sin hijos).
//
// La UI falla al eliminarlo y NO es por el monto cero: deleteEnrollmentCascade
// suelta el lead con un UPDATE, y el trigger block_update_when_enrolled de
// leads lo rechaza justamente porque el lead todavia apunta al enrollment.
// Aqui el trigger se apaga dentro de la transaccion (DDL transaccional: si algo
// falla, el ROLLBACK lo devuelve solo).
//
// Respalda TODO lo borrado en _backup_17870_2026-09-01.json antes de tocar nada.
import { writeFileSync } from 'node:fs'
import { pool } from './db.mjs'

const ID = 17870
const TABLAS_HIJAS = [
  'payments', 'payment_installments', 'enrollment_validations',
  'enrollment_attachments', 'enrollment_audit_log', 'email_logs',
  'payment_tokens', 'enrollment_discounts', 'fico_jobs'
]

// Una sola conexion: con el pool, BEGIN y ROLLBACK pueden caer en clientes
// distintos y la transaccion no cubriria nada.
const client = await pool.connect()
try {
  const { rows: [enrollment] } = await client.query('SELECT * FROM enrollments WHERE enrollment_id=$1', [ID])
  if (!enrollment) { console.log(`enrollment ${ID} ya no existe`); process.exit(0) }

  const { rows: hijos } = await client.query('SELECT enrollment_id FROM enrollments WHERE parent_enrollment_id=$1', [ID])
  const ids = [ID, ...hijos.map(h => h.enrollment_id)]

  const respaldo = { enrollment, hijos, borrado_el: new Date().toISOString() }
  for (const tabla of TABLAS_HIJAS) {
    respaldo[tabla] = (await client.query(`SELECT * FROM ${tabla} WHERE enrollment_id = ANY($1::int[])`, [ids])).rows
  }
  respaldo.leads = (await client.query('SELECT * FROM leads WHERE enrollment_id = ANY($1::int[])', [ids])).rows
  writeFileSync(new URL(`./_backup_${ID}_2026-09-01.json`, import.meta.url), JSON.stringify(respaldo, null, 2))

  await client.query('BEGIN')
  try {
    for (const tabla of TABLAS_HIJAS) {
      const { rowCount } = await client.query(`DELETE FROM ${tabla} WHERE enrollment_id = ANY($1::int[])`, [ids])
      if (rowCount) console.log(`  -${rowCount} ${tabla}`)
    }

    await client.query('ALTER TABLE leads DISABLE TRIGGER block_update_when_enrolled')
    // El lead suelta la venta y vuelve a "atendido", igual que el cascade de la UI.
    const { rowCount: leadsSueltos } = await client.query(
      `UPDATE leads
          SET enrollment_id = NULL,
              cat_status_lead = COALESCE(
                (SELECT catalog_id FROM catalog WHERE alias='we_lead_status_atendido' LIMIT 1),
                cat_status_lead)
        WHERE enrollment_id = ANY($1::int[])`, [ids])
    await client.query('ALTER TABLE leads ENABLE TRIGGER block_update_when_enrolled')
    console.log(`  ~${leadsSueltos} leads liberados`)

    const { rowCount } = await client.query('DELETE FROM enrollments WHERE enrollment_id = ANY($1::int[])', [ids])
    await client.query('COMMIT')
    console.log(`OK: ${rowCount} enrollment(s) eliminados (${ids.join(', ')})`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }

  await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enrollment_report_system')
  console.log('matview refrescada')
} finally {
  client.release()
  await pool.end()
}
