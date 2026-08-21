// Corrige una inscripcion que se registro como BECA cuando en realidad era
// beneficio de membresia (curso de cortesia por ser socio BLACK/GOLD/PLATINIUM).
//
// El sistema no guarda un flag "es beca": BECA es lo que queda cuando una venta
// va en total 0 y no es B2B ni socio (ver edition.repository.js -> is_beca). Por
// eso la correccion NO es "apagar la beca", es GRABAR EL TIER: al escribir
// enrollments.membership_program_id la venta deja de cumplir el criterio de beca
// y pasa a contar como MEMB en el aula, en el cronograma y en el panel FICO.
//
// Lo que toca:
//   - enrollments.membership_program_id -> FK al tier real en programs (is_membership)
//   - payment_installments.notes        -> el texto que puso el SP ('Beca - sin
//                                          pago requerido') pasa a decir membresia
// Lo que NO toca: montos. El total ya es 0 por las dos vias, y la cortesia de
// membresia se registra igual que la beca (total 0, cuota 0 pagada). Cambiar
// dinero aqui seria inventar una diferencia que no existe.
//
// Idempotente: si el tier ya esta grabado, no hace nada.
//
// Uso:  node scripts/corregir-beca-a-membresia.mjs <enrollment_id> <tier> [--aplicar]
//       node scripts/corregir-beca-a-membresia.mjs 16708 BLACK
//       node scripts/corregir-beca-a-membresia.mjs 16708 BLACK --aplicar
import { q, pool } from './db.mjs'

const aplicar = process.argv.includes('--aplicar')
const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const ID = Number(args[0])
const TIER = (args[1] || '').trim()
if (!ID || !TIER) {
  console.error('Uso: node scripts/corregir-beca-a-membresia.mjs <enrollment_id> <tier> [--aplicar]')
  process.exit(1)
}

const foto = async () => (await q(`
  SELECT e.enrollment_id, e.list_price, e.total_amount, e.discount_amount,
         e.membership_program_id, mp.program_name AS membership_tier,
         e.parent_enrollment_id, e.cat_b2b_doctype, e.notes, e.active,
         e.registration_date, e.program_edition_id,
         (SELECT json_agg(json_build_object('id', pi.installment_id, 'n', pi.installment_number,
                                            'monto', pi.amount, 'estado', cs.alias, 'nota', pi.notes)
                          ORDER BY pi.installment_number)
            FROM payment_installments pi
            JOIN catalog cs ON cs.catalog_id = pi.cat_status
           WHERE pi.enrollment_id = e.enrollment_id) AS cuotas,
         (SELECT json_agg(json_build_object('discount_id', ed.discount_id, 'desc', d.description,
                                            'monto', ed.calculated_amount, 'orden', ed.order_applied)
                          ORDER BY ed.order_applied)
            FROM enrollment_discounts ed
            JOIN discounts d ON d.discount_id = ed.discount_id
           WHERE ed.enrollment_id = e.enrollment_id) AS descuentos
    FROM enrollments e
    LEFT JOIN programs mp ON mp.program_id = e.membership_program_id
   WHERE e.enrollment_id = $1`, [ID])).rows[0]

console.log('BD:', (await q('SELECT current_database() AS db')).rows[0].db)

const antes = await foto()
if (!antes) throw new Error(`el enrollment ${ID} no existe`)
console.log('antes ->', JSON.stringify(antes, null, 2))

// El tier se resuelve contra programs, no se hardcodea el id: es la misma fuente
// que alimenta el dropdown del formulario FICO.
const { rows: tiers } = await q(
  `SELECT program_id, program_name FROM programs WHERE is_membership = true ORDER BY program_id`)
console.log('tiers disponibles ->', tiers.map(t => `${t.program_id}=${t.program_name}`).join(' | '))

const match = tiers.filter(t => t.program_name.toUpperCase().includes(TIER.toUpperCase()))
if (match.length !== 1) throw new Error(`"${TIER}" no identifica un tier unico (${match.length} coincidencias)`)
const tier = match[0]

// PLUS paga el curso: si alguien lo pide aqui, la venta no deberia estar en 0 y
// la correccion correcta es otra (registrar el pago), no marcar cortesia.
if (/plus/i.test(tier.program_name)) throw new Error('MEMBRESIA PLUS no regala cursos: revisar a mano')
// Una beca real tiene total 0. Si esta venta tiene monto, no es el caso que este
// script arregla y grabar el tier ocultaria una venta cobrada.
if (Number(antes.total_amount) !== 0) throw new Error(`total_amount=${antes.total_amount}: no es una venta en 0, revisar a mano`)

if (antes.membership_program_id === tier.program_id) {
  console.log(`\nya estaba grabado como ${tier.program_name}: nada que hacer`)
} else if (!aplicar) {
  console.log(`\n(dry-run) pondria membership_program_id=${tier.program_id} (${tier.program_name})`)
  console.log('volver a correr con --aplicar')
} else {
  await q('BEGIN')
  try {
    await q(`UPDATE enrollments
                SET membership_program_id = $2, modification_date = NOW()
              WHERE enrollment_id = $1`, [ID, tier.program_id])
    await q(`UPDATE payment_installments
                SET notes = 'Beneficio de membresia - curso de cortesia'
              WHERE enrollment_id = $1 AND notes ILIKE 'Beca%'`, [ID])
    await q('COMMIT')
  } catch (err) {
    await q('ROLLBACK')
    throw err
  }
  // Sin esto el panel de FICO sigue mostrando el estado viejo.
  await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')

  const despues = await foto()
  console.log('despues ->', JSON.stringify(despues, null, 2))

  // La correccion vale por como se ve en el aula, no por la columna: se afirma
  // el criterio derivado (is_beca / member_benefits), que es lo que el area lee.
  const { EditionRepository } = await import('../src/modules/edition/edition.repository.js')
  const alumnos = await new EditionRepository(pool).classroomStudentsList(despues.program_edition_id)
  const alumno = alumnos.find(a => Number(a.enrollment_id) === ID)
  if (!alumno) console.warn(`OJO: el enrollment ${ID} no aparece en la lista de la edicion ${despues.program_edition_id}`)
  else console.log('en el aula ->', {
    nombre: alumno.full_name,
    is_beca: alumno.is_beca,
    member_benefits: alumno.member_benefits,
    tier: alumno.membership_tier_name
  })
}

await pool.end()
