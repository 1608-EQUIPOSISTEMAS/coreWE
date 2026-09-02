// Da de alta una empresa B2B por el mismo camino que /business/companies:
// el SP valida razon social, RUC y duplicados, asi que un alta por script no
// puede quedar peor que una hecha desde la pantalla.
//
//   node scripts/alta-empresa-b2b.mjs 20539627938 "LA JOYA MINING" [--prod]
//
// Sector y clasificacion quedan vacios a proposito: son datos que solo tiene
// comercial (ver la pantalla de empresas para completarlos despues).
import fs from 'fs'

if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { q, pool } = await import('./db.mjs')

const [ruc, razonSocial] = process.argv.slice(2).filter((a) => a !== '--prod')

if (!ruc || !razonSocial) {
  console.error('uso: node scripts/alta-empresa-b2b.mjs <ruc> "<razon social>" [--prod]')
  process.exit(1)
}

const payload = { company: { razon_social: razonSocial, document_number: ruc } }
const { rows } = await q('CALL public.sp_b2b_company_register($1, NULL, NULL, NULL)', [JSON.stringify(payload)])

console.log(rows[0])
await pool.end()
