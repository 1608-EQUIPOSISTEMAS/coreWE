// SOLO LECTURA. Compara los objetos que el codigo nuevo necesita contra
// produccion, para saber si desplegar el repo alcanza o falta correr algo en la
// BD. No modifica nada: lee la URL de produccion de .env.bak-produccion para no
// depender de que el .env activo apunte alla.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = readFileSync('.env.bak-produccion', 'utf8')
  .split('\n').find(l => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim()
if (!url) throw new Error('No encuentro DATABASE_URL en .env.bak-produccion')

const prod = new pg.Pool({ connectionString: url, max: 1 })

const { rows: [r] } = await prod.query(`
  SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'b2b_contract_beneficiaries'
        AND column_name IN ('first_name','last_name'))                   AS columnas_nombre,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'sp_b2b_contract_enroll_beneficiaries')          AS sp_matricula,
    -- register / update / get / list / children_sync. El de matricula masiva se
    -- cuenta aparte: tambien empieza con sp_b2b_contract_ y falseaba el total.
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'sp_b2b_contract_%'
        AND p.proname <> 'sp_b2b_contract_enroll_beneficiaries')         AS sps_contrato,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'sp_b2b_agreement_%') AS sps_convenio_borrados,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'agreement_discounts' AND column_name = 'b2b_contract_id') AS fk_descuentos,
    (SELECT count(*) FROM b2b_contracts)                                 AS contratos`)

const esperado = {
  columnas_nombre: 2, sp_matricula: 1, sps_contrato: 5,
  sps_convenio_borrados: 0, fk_descuentos: 1
}
console.log('PRODUCCION:', r)
const faltan = Object.entries(esperado).filter(([k, v]) => Number(r[k]) !== v)
console.log(faltan.length
  ? `\n⚠ FALTA APLICAR EN PRODUCCION: ${faltan.map(([k, v]) => `${k} (esperado ${v}, hay ${r[k]})`).join(', ')}`
  : '\n✓ Produccion ya tiene todo el esquema que el codigo nuevo necesita: desplegar el repo alcanza.')

await prod.end()
