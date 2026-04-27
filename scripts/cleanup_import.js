// scripts/cleanup_import.js
// Rollback de todo lo que el importer metio hoy.
// Identifica por user_registration_id=9 + registration_date::date=CURRENT_DATE.

import 'dotenv/config'
import { pool } from '../src/config/db.js'

const DEFAULT_USER_REG = 9

async function main () {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const eids = await client.query(
      `SELECT enrollment_id FROM enrollments
       WHERE user_registration_id = $1 AND registration_date::date = CURRENT_DATE`,
      [DEFAULT_USER_REG]
    )
    const enrollmentIds = eids.rows.map(r => r.enrollment_id)
    console.log(`Enrollments a borrar: ${enrollmentIds.length}`)

    if (enrollmentIds.length) {
      const dp = await client.query('DELETE FROM payments WHERE enrollment_id = ANY($1)', [enrollmentIds])
      console.log(`  payments borrados: ${dp.rowCount}`)
      const di = await client.query('DELETE FROM payment_installments WHERE enrollment_id = ANY($1)', [enrollmentIds])
      console.log(`  payment_installments borrados: ${di.rowCount}`)
      const de = await client.query('DELETE FROM enrollments WHERE enrollment_id = ANY($1)', [enrollmentIds])
      console.log(`  enrollments borrados: ${de.rowCount}`)
    }

    const dc = await client.query(
      `DELETE FROM customers WHERE user_registration_id = $1 AND registration_date::date = CURRENT_DATE`,
      [DEFAULT_USER_REG]
    )
    console.log(`Customers borrados: ${dc.rowCount}`)

    const du = await client.query(
      `DELETE FROM users WHERE alias IN ('CG37','JF39','IV27','NY12')`
    )
    console.log(`Users stub borrados: ${du.rowCount}`)

    const dper = await client.query(
      `DELETE FROM persons WHERE user_registration_id = $1 AND registration_date::date = CURRENT_DATE`,
      [DEFAULT_USER_REG]
    )
    console.log(`Persons borrados: ${dper.rowCount}`)

    await client.query('COMMIT')
    console.log('\nCOMMIT OK — rollback aplicado')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  await pool.end()
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
