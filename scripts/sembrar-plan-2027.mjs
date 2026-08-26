// Deja la BD LOCAL lista para mirar Producto > Planificacion con datos reales:
//
//   1. Borra los escenarios de prueba automatica y las ediciones 2027 que
//      llegaron a publicar (eran datos de test, no programacion de verdad).
//   2. Crea el escenario "Programacion 2027".
//   3. Copia los 12 meses de 2026 corriendo el dia de la semana.
//
// Re-ejecutable. Solo BD de pruebas.
//   node scripts/sembrar-plan-2027.mjs
import 'dotenv/config'
import { q, pool } from './db.mjs'
import * as planes from '../src/modules/scheduleplan/scheduleplan.usecases.js'

const ANIO_ORIGEN = 2026
const ANIO_PLAN = 2027
const NOMBRE = `Programacion ${ANIO_PLAN}`
const USER_ID = 9 // ADMIN

console.log('── Limpiando datos de prueba ──')
const previos = await q('SELECT plan_id, name, items FROM schedule_plans')
const publicadas = previos.rows
  .filter(p => p.name.startsWith('Prueba automatica') || p.name === NOMBRE)
  .flatMap(p => (p.items || []).map(i => i.published_edition_id))
  .filter(Boolean)

if (publicadas.length) {
  await q('DELETE FROM program_edition_tree WHERE edition_id = ANY($1::int[]) OR child_edition_id = ANY($1::int[])',
    [publicadas]).catch(() => {})
  const { rowCount } = await q('DELETE FROM program_editions WHERE edition_num_id = ANY($1::int[])', [publicadas])
  console.log('ediciones publicadas por los planes de prueba, borradas:', rowCount)
}
await q("DELETE FROM schedule_plans WHERE name LIKE 'Prueba automatica %' OR name = $1", [NOMBRE])

console.log(`\n── Creando "${NOMBRE}" ──`)
const plan = await planes.createPlan({ name: NOMBRE, year: ANIO_PLAN, user_id: USER_ID })
console.log('plan_id:', plan.plan_id)

console.log(`\n── Copiando los 12 meses de ${ANIO_ORIGEN} ──`)
const inicio = Date.now()
const res = await planes.seedYearFromYear({
  plan_id: plan.plan_id, source_year: ANIO_ORIGEN, mode: 'weekday', user_id: USER_ID
})
console.log(res, `(${Math.round((Date.now() - inicio) / 1000)}s)`)

const cargado = await planes.getPlan({ plan_id: plan.plan_id })
const porMes = {}
for (const item of cargado.items) {
  const mes = String(item.start_date || '').slice(0, 7)
  porMes[mes] = (porMes[mes] || 0) + 1
}
console.log('\nediciones por mes del plan:')
console.table(Object.entries(porMes).sort().map(([mes, n]) => ({ mes, ediciones: n })))

await pool.end()
