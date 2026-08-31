// Limpieza de las 5 empresas fantasma (razon_social NULL / document_number NULL)
// que dejo el desalineamiento del payload en sp_b2b_company_register.
// Se verifico antes que ninguna tabla (leads, contratos, clientes, contactos,
// afiliadas) las referencia. Se borra dentro de una transaccion que solo confirma
// si el conteo cuadra exactamente con las 5 esperadas.
import { pool } from './db.mjs'

const FANTASMA = [1146, 1147, 1148, 1151, 1152]

const client = await pool.connect()
try {
  const { rows: [{ current_database: db }] } = await client.query('SELECT current_database()')
  await client.query('BEGIN')

  const { rows: antes } = await client.query(
    `SELECT company_id, razon_social, document_number FROM public.companies
      WHERE company_id = ANY($1) AND razon_social IS NULL AND document_number IS NULL`,
    [FANTASMA])
  console.log(`BD ${db}: candidatas a borrar`, antes.map(r => r.company_id))

  if (antes.length !== FANTASMA.length) {
    throw new Error(`se esperaban ${FANTASMA.length} filas vacias y hay ${antes.length}: no se borra nada`)
  }

  const { rowCount } = await client.query(
    `DELETE FROM public.companies
      WHERE company_id = ANY($1) AND razon_social IS NULL AND document_number IS NULL`,
    [FANTASMA])
  await client.query('COMMIT')
  console.log('borradas:', rowCount)

  const { rows: [resto] } = await client.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE razon_social IS NULL) AS sin_nombre
       FROM public.companies WHERE active = 'Y'`)
  console.log('empresas activas ahora:', resto)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('FALLO, sin cambios:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
