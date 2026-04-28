import 'dotenv/config'
import { pool } from '../src/config/db.js'

const ENROLL = 1128

async function main () {
  const { rows } = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = $1', [ENROLL])
  const e = rows[0] || {}
  const numericFields = Object.entries(e).filter(([k, v]) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)))
  console.log('enrollment numeric fields:')
  for (const [k, v] of numericFields) console.log(`  ${k}: ${v}`)
  console.log('enrollment key fields:')
  console.log(`  program_version_id: ${e.program_version_id}`)
  console.log(`  program_edition_id: ${e.program_edition_id}`)
  console.log(`  odoo_order_id: ${e.odoo_order_id}`)
  console.log(`  odoo_user_id: ${e.odoo_user_id}`)

  const { rows: installments } = await pool.query(`
    SELECT installment_id, installment_number, amount, due_date, cat_status
    FROM payment_installments WHERE enrollment_id = $1 ORDER BY installment_number
  `, [ENROLL])
  console.log('\npayment_installments:')
  console.table(installments)

  console.log('\n=== columnas de enrollments que contengan "amount" / "price" / "pay" ===')
  const { rows: cols } = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enrollments'
      AND (column_name ILIKE '%amount%' OR column_name ILIKE '%price%' OR column_name ILIKE '%pay%' OR column_name ILIKE '%money%' OR column_name ILIKE '%saved%' OR column_name ILIKE '%total%')
  `)
  console.table(cols)

  pool.end()
}
main().catch(e => { console.error(e); pool.end() })
