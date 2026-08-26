// Prueba end-to-end del modulo Planificacion contra la BD LOCAL de pruebas.
//
// Recorre el flujo completo: crear escenario -> duplicar un mes del anio
// anterior -> preview con el sobre del cronograma -> publicar al cronograma real
// -> verificar que las ediciones existen y que republicar no duplica.
//
// Deja el escenario y las ediciones creadas en la BD local: es un clon, y sirven
// para mirar el resultado en pantalla.
//   node scripts/probar-planificacion.mjs
import 'dotenv/config'
import { q, pool } from './db.mjs'
import * as planes from '../src/modules/scheduleplan/scheduleplan.usecases.js'

const MES_ORIGEN = 6
const ANIO_ORIGEN = 2026
const ANIO_PLAN = 2027
const USER_ID = 9 // ADMIN@WE-EDUCACION.COM: el SP de alta valida el rol por su cuenta

function titulo (texto) { console.log(`\n── ${texto} ${'─'.repeat(Math.max(0, 60 - texto.length))}`) }

titulo('0. Limpiar corridas anteriores')
// Re-ejecutable: borra los escenarios de prueba Y las ediciones que publicaron.
// Sin esto la 2da corrida choca contra sus propias ediciones y los codigos
// globales que ya se consumieron. Solo aplica a la BD LOCAL de pruebas.
const previos = await q(
  `SELECT plan_id, items FROM schedule_plans WHERE name LIKE 'Prueba automatica %'`)
const publicadasAntes = previos.rows
  .flatMap(p => (p.items || []).map(i => i.published_edition_id))
  .filter(Boolean)

if (publicadasAntes.length) {
  await q('DELETE FROM program_edition_tree WHERE edition_id = ANY($1::int[]) OR child_edition_id = ANY($1::int[])',
    [publicadasAntes]).catch(() => {})
  const { rowCount } = await q('DELETE FROM program_editions WHERE edition_num_id = ANY($1::int[])', [publicadasAntes])
  console.log('ediciones de prueba borradas:', rowCount)
}
await q("DELETE FROM schedule_plans WHERE name LIKE 'Prueba automatica %'")
// Los sondeos puntuales tambien dejan ediciones: se van con su marcador.
await q("DELETE FROM program_editions WHERE notes LIKE 'sondeo%'")

// Red de seguridad: una corrida que fallo a mitad deja ediciones sin quedar
// registradas en el plan, y en la siguiente chocan por "el docente ya tiene una
// edicion con el mismo horario". Se barren por autor + fecha de alta.
const { rowCount: huerfanas } = await q(`
  DELETE FROM program_editions
   WHERE user_registration_id = $1
     AND registration_date > NOW() - INTERVAL '6 hours'
     AND EXTRACT(YEAR FROM start_date) = $2`, [USER_ID, ANIO_PLAN])
if (huerfanas) console.log('ediciones huerfanas de corridas fallidas borradas:', huerfanas)

titulo('1. Crear escenario')
const plan = await planes.createPlan({
  name: `Prueba automatica ${ANIO_PLAN}`, year: ANIO_PLAN, user_id: USER_ID
})
console.log('plan_id:', plan.plan_id, '| anio:', plan.year)

titulo(`2. Duplicar ${MES_ORIGEN}/${ANIO_ORIGEN} corriendo el dia de la semana`)
const sembrado = await planes.seedMonthFromYear({
  plan_id: plan.plan_id, month: MES_ORIGEN, source_year: ANIO_ORIGEN,
  mode: 'weekday', user_id: USER_ID
})
console.log(sembrado)

const cargado = await planes.getPlan({ plan_id: plan.plan_id })
const muestra = cargado.items.slice(0, 3)
console.table(muestra.map(i => ({
  uid: i.uid,
  programa: (i.program_abreviature || i.abbreviation || '').slice(0, 24),
  origen: i.source_edition_id,
  inicio: i.start_date,
  fin: i.end_date,
  dia_semana: new Date(`${i.start_date}T00:00:00Z`).getUTCDay(),
  modulos: (i.children || []).length
})))

titulo('3. El dia de la semana se conserva')
const original = await q(
  `SELECT edition_num_id, start_date FROM program_editions
    WHERE edition_num_id = ANY($1::int[])`,
  [muestra.map(i => i.source_edition_id)])
const diaUtc = iso => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getUTCDay()
for (const item of muestra) {
  const fuente = original.rows.find(r => r.edition_num_id === item.source_edition_id)
  const antes = fuente.start_date.toISOString().slice(0, 10)
  const igual = diaUtc(antes) === diaUtc(item.start_date)
  console.log(`${antes} -> ${item.start_date}  mismo dia de semana: ${igual ? 'SI' : 'NO'}`)
  if (!igual) throw new Error('El modo weekday corrio el dia de la semana')
}

titulo('4. Preview con el sobre del cronograma')
const preview = await planes.previewMonth({ plan_id: plan.plan_id, month: MES_ORIGEN })
console.log('semanas:', preview.items.map(s => `S${s.schedule}:${s.items.length}`).join(' '))
if (preview.items.length !== 6) throw new Error('El preview no devolvio 6 semanas')

titulo('5. Publicar al cronograma real (sin Odoo)')
const publicado = await planes.publishPlan({ plan_id: plan.plan_id, user_id: USER_ID })
console.log('publicadas:', publicado.published.length, '| rechazadas:', publicado.failed.length)
publicado.failed.slice(0, 8).forEach(f => console.log('  ✗', f.label, '->', f.message))

const sinId = publicado.published.filter(p => !p.edition_num_id)
if (sinId.length) throw new Error(`${sinId.length} publicadas sin id: la guarda de idempotencia queda muerta`)

if (publicado.published.length) {
  const ids = publicado.published.map(p => p.edition_num_id)
  const reales = await q(
    `SELECT edition_num_id, global_code, specific_code, start_date
       FROM program_editions WHERE edition_num_id = ANY($1::int[])
       ORDER BY edition_num_id LIMIT 5`, [ids])
  console.log(`ediciones reales creadas (muestra de ${ids.length}):`)
  console.table(reales.rows.map(r => ({ ...r, start_date: r.start_date.toISOString().slice(0, 10) })))
  if (reales.rows.length === 0) throw new Error('El SP dijo que si pero no hay filas en program_editions')
}

titulo('6. Republicar no duplica (guarda de idempotencia)')
const segunda = await planes.publishPlan({ plan_id: plan.plan_id, user_id: USER_ID })
console.log('publicadas en la 2da pasada:', segunda.published.length)
// Las que fallaron en la 1ra pasada se reintentan (es lo correcto: se corrigen
// y se vuelven a mandar). Lo que NO puede pasar es que se repita una exitosa.
if (segunda.published.length > publicado.failed.length) {
  throw new Error('Se republicaron ediciones que ya estaban creadas')
}

await pool.end()
