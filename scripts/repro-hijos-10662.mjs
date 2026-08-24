// One-off (2026-08-24): reprogramacion de DOS hijos SEG del paquete 10662
// (JUAN DIEGO CARRASCO IDROGO - DIPLOMADO EN GESTION DE PROYECTOS).
//
//   10666 PMO             E5  14/06 -> E6  15/08 (edicion 15001 -> 15110)
//   10667 GEST FINANCIERA E19 02/08 -> E21 26/09 (edicion 15065 -> 15148)
//
// Se mueve la edicion en vez de correr el flujo RP completo: un hijo de paquete
// va en 0.00 con una sola cuota cero, sin cuotas pendientes que trasladar, sin
// pagos, sin notas de aula y sin odoo_user_id. Dejar el origen vivo en estado RP
// solo ensuciaria el roster del aula vieja. El acuerdo con el alumno queda en la
// bitacora, que es donde el flujo RP tambien lo dejaria.
//
//   node scripts/repro-hijos-10662.mjs --dry   # muestra, no guarda
//   node scripts/repro-hijos-10662.mjs         # aplica
import { q, pool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const MOVIMIENTOS = [
  { enrollmentId: 10666, desde: 15001, hacia: 15110, curso: 'PMO' },
  { enrollmentId: 10667, desde: 15065, hacia: 15148, curso: 'GESTION FINANCIERA' }
]
const DRY = process.argv.includes('--dry')
const EDICIONES = MOVIMIENTOS.flatMap(m => [m.desde, m.hacia])

const fotoDelPaquete = () => q(`
  SELECT e.enrollment_id, e.parent_enrollment_id AS padre, pv.abbreviation AS curso,
         e.program_edition_id AS edicion, pe.global_code, pe.start_date::date AS inicio,
         pe.end_date::date AS fin, cts.alias AS estado, e.total_amount
    FROM enrollments e
    LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = 10662 OR e.parent_enrollment_id = 10662
   ORDER BY pe.start_date, e.enrollment_id`).then(r => r.rows)

// Los contadores por canal del cronograma: el SEG tiene que bajar en la edicion
// de origen y subir en la de destino.
const contadoresDelCronograma = async () => {
  const metricas = await new EditionRepository(pool).classroomChannelMetricsList(EDICIONES)
  return EDICIONES.map(id => {
    const m = metricas.find(x => x.edition_num_id === id) || {}
    return { edicion: id, VENTAS: m.cnt_ventas, SEGUI: m.cnt_segui, B2B: m.cnt_b2b, MEMB: m.cnt_memb, BECA: m.cnt_becas, AULA: m.cnt_aula }
  })
}

const mover = async ({ enrollmentId, desde, hacia, curso }) => {
  // El WHERE lleva la edicion de origen: si alguien ya la movio, no la pisa.
  const { rows: [movido] } = await q(`
    UPDATE enrollments
       SET program_edition_id = $1, modification_date = NOW()
     WHERE enrollment_id = $2 AND program_edition_id = $3
    RETURNING enrollment_id, program_edition_id`, [hacia, enrollmentId, desde])
  if (!movido) throw new Error(`${enrollmentId} (${curso}) no estaba en la edicion ${desde}: nada que mover`)

  await q(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, justificacion, changes, details)
    VALUES ($1, 'enrollment_update', $2, $3, $4)`, [
    enrollmentId,
    `Reprogramacion del hijo ${curso}: cambio de aula acordado con el alumno`,
    JSON.stringify({ program_edition_id: { from: desde, to: hacia } }),
    `Hijo SEG del paquete 10662 movido de la edicion ${desde} a la ${hacia}`
  ])
  console.log(`  ${enrollmentId} ${curso}: edicion ${desde} -> ${hacia}`)
}

console.log('\nANTES - paquete:'); console.table(await fotoDelPaquete())
console.log('ANTES - contadores cronograma:'); console.table(await contadoresDelCronograma())

if (DRY) {
  console.log('\n[dry] no se aplico nada. Propuesto:')
  MOVIMIENTOS.forEach(m => console.log(`  ${m.enrollmentId} ${m.curso}: ${m.desde} -> ${m.hacia}`))
  await pool.end()
  process.exit(0)
}

console.log('\nAPLICANDO:')
for (const movimiento of MOVIMIENTOS) await mover(movimiento)

// El panel FICO lee la cabecera de la matview, no de la tabla. CONCURRENTLY
// porque en produccion el panel la consulta en vivo y un refresh normal la bloquea.
await q('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_enrollment_report_system')
console.log('matview refrescada')

console.log('\nDESPUES - paquete:'); console.table(await fotoDelPaquete())
console.log('DESPUES - contadores cronograma:'); console.table(await contadoresDelCronograma())
await pool.end()
