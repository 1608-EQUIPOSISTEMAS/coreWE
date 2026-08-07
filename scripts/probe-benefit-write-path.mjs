// Sondeo: quien escribe enrollment_discounts y con que monto.
//
// Pregunta concreta: cuando el modal de LeadsNew manda un beneficio, el SP
// guarda el `value` del catalogo (discounts.value) o el monto que calculo el
// front? De eso depende si un clamp en el front sobrevive hasta la BD.
import { q, pool } from './db.mjs'

const SPS = [
  'sp_comercial_enrollment_register',
  'sp_comercial_lead_register',
  'sp_comercial_lead_update',
  'sp_fico_enrollment_register_direct'
]

for (const name of SPS) {
  const { rows } = await q(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [name]
  )
  if (!rows.length) { console.log(`\n### ${name}: NO EXISTE`); continue }
  const def = rows[0].def
  if (!/enrollment_discounts/i.test(def)) { console.log(`\n### ${name}: no toca enrollment_discounts`); continue }

  console.log(`\n### ${name} — bloques que tocan enrollment_discounts`)
  const lines = def.split('\n')
  lines.forEach((l, i) => {
    if (/enrollment_discounts/i.test(l)) {
      console.log(lines.slice(Math.max(0, i - 18), i + 22).map((x, k) => `${i - 18 + k}| ${x}`).join('\n'))
      console.log('  ---')
    }
  })
}

await pool.end()
