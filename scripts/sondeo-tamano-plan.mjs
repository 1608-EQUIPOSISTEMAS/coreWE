// De donde sale el peso del blob del plan: bytes por campo, sumados sobre todos
// los items. El planner manda el escenario COMPLETO en cada guardado, asi que
// cada campo muerto se paga en cada save.
import { q, pool } from './db.mjs'
const { rows } = await q(`
  SELECT plan_id, name, jsonb_array_length(items) AS items,
         pg_size_pretty(length(items::text)::bigint) AS peso
    FROM schedule_plans WHERE active = 'Y' ORDER BY plan_id`)
console.table(rows)

const { rows: [{ items }] } = await q(
  'SELECT items FROM schedule_plans WHERE active = $1 ORDER BY plan_id DESC LIMIT 1', ['Y'])
const pesos = {}
for (const item of items) {
  for (const [k, v] of Object.entries(item)) {
    pesos[k] = (pesos[k] || 0) + JSON.stringify(v ?? null).length
  }
}
const total = Object.values(pesos).reduce((a, b) => a + b, 0)
console.log('\ncampos mas pesados:')
console.table(Object.entries(pesos).sort((a, b) => b[1] - a[1]).slice(0, 14)
  .map(([campo, bytes]) => ({ campo, kb: Math.round(bytes / 1024), pct: Math.round(bytes / total * 100) + '%' })))
await pool.end()
