// Estado de la columna EMPRESA de "7. Convenios" para una venta puntual.
//   node scripts/probe-empresa-convenio.mjs 18227 [--prod]
import fs from 'fs'
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { pool } = await import('./db.mjs')

const [enrollmentId] = process.argv.slice(2).filter((a) => a !== '--prod')
if (!enrollmentId) {
  console.error('uso: node scripts/probe-empresa-convenio.mjs <enrollment_id> [--prod]')
  process.exit(1)
}

const { rows } = await pool.query(`
  SELECT e.enrollment_id,
         TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
         cf.alias AS estado_fico, e.agent_origin, e.b2b_contract_id,
         l.lead_id, l.company_id AS lead_company_id, l.company_name AS lead_company_name,
         comp_lead.razon_social AS empresa_lead,
         comp_ctr.razon_social  AS empresa_contrato,
         COALESCE(comp_lead.razon_social, comp_ctr.razon_social, l.company_name, '') AS empresa_en_hoja,
         to_char(COALESCE(l.pay_date::date, e.registration_date::date), 'DD/MM/YYYY') AS f_pago
    FROM enrollments e
    JOIN customers cust ON cust.customer_id = e.customer_id
    JOIN persons per    ON per.person_id = cust.person_id
    JOIN catalog cf     ON cf.catalog_id = e.cat_fico_status
    LEFT JOIN leads l               ON l.enrollment_id = e.enrollment_id
    LEFT JOIN companies comp_lead   ON comp_lead.company_id = l.company_id
    LEFT JOIN b2b_contracts ctr     ON ctr.b2b_contract_id = e.b2b_contract_id
    LEFT JOIN companies comp_ctr    ON comp_ctr.company_id = ctr.company_id
   WHERE e.enrollment_id = $1`, [enrollmentId])
console.log(`-- venta ${enrollmentId} --`)
console.table(rows)
await pool.end()
