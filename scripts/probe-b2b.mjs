// Sondeo del esquema B2B: tablas del dominio, sus columnas, sus conteos y los
// SPs que las tocan. Lectura pura, no escribe nada.
import { q, pool } from './db.mjs'

const TABLAS = ['companies', 'company_contacts', 'company_affiliates', 'b2b_contracts',
  'agreement_discounts', 'company_leads', 'b2b_attendance']

const columnas = async (tabla) => {
  const { rows } = await q(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [tabla])
  return rows
}

const existe = async (tabla) => {
  const { rows } = await q(
    `SELECT to_regclass('public.'||$1) IS NOT NULL AS ok`, [tabla])
  return rows[0].ok
}

// Cualquier tabla del dominio, no solo las que adiviné arriba.
const { rows: candidatas } = await q(`
  SELECT c.relname AS tabla, c.reltuples::bigint AS filas_aprox
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'
     AND (c.relname ~* 'compan|b2b|contract|agreement|convenio|corporat')
   ORDER BY 1`)

console.log('══ TABLAS DEL DOMINIO ══')
for (const { tabla, filas_aprox } of candidatas) {
  const { rows: [{ n }] } = await q(`SELECT count(*)::int AS n FROM public."${tabla}"`)
  console.log(`\n── ${tabla}  (${n} filas, ~${filas_aprox} en estadisticas)`)
  for (const c of await columnas(tabla)) {
    console.log(`     ${c.column_name.padEnd(30)} ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`)
  }
}

console.log('\n══ TABLAS ESPERADAS QUE NO EXISTEN ══')
for (const t of TABLAS) if (!(await existe(t))) console.log(`   falta: ${t}`)

console.log('\n══ CATALOGOS DEL DOMINIO ══')
for (const tipo of ['we_b2b_contract', 'we_enrollment_b2b_doctype', 'we_business_line']) {
  const { rows: cat } = await q(`
    SELECT hijo.catalog_id, hijo.description, hijo.alias, hijo.active
      FROM catalog hijo JOIN catalog padre ON padre.catalog_id = hijo.catalog_parent_id
     WHERE padre.alias = $1 ORDER BY hijo.catalog_id`, [tipo])
  console.log(`\n── ${tipo}`)
  console.table(cat)
}

console.log('\n══ SPs DEL DOMINIO ══')
const { rows: sps } = await q(`
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname ~* 'b2b|compan|contract|agreement'
   ORDER BY 1`)
sps.forEach(s => console.log(`   ${s.proname}(${s.args})`))

await pool.end()
