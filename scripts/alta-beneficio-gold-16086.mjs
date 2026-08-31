// One-off: alta del curso POWER APPS E10-26 (ed. 15070) para el socio WE GOLD
// 70120821 usando el beneficio de su membresia.
//
// Contexto: la venta 16086 (S/285) quedo en CC porque financio el upgrade a
// WE GOLD (16482). El guard de duplicados no miraba cat_type_status, asi que
// ese origen CC bloqueaba el reingreso al mismo curso. Con el guard arreglado
// el alta pasa; se corre por el usecase real (no un INSERT) para que quede el
// job register_followup que el backend desplegado consume: hijos, Odoo y correo.
//
//   node scripts/alta-beneficio-gold-16086.mjs          # simulacro
//   node scripts/alta-beneficio-gold-16086.mjs --commit # aplica
import 'dotenv/config'
import '../src/modules/fico/fico.bootstrap.js'   // sin esto logAudit es un no-op mudo
import { ficoEnrollmentRegister } from '../src/modules/fico/enrollment/enrollment.usecases.js'
import { enrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'

const FICO_USER_ID = 21

const data = {
  document_number: '70120821',
  cat_type_document: 2300,          // DNI
  first_name: 'YARDEL ESAUD',
  last_name: 'CONDORI CISNEROS',
  email: 'yardelcondoricisneros@gmail.com',
  phone: '934799384',
  program_version_id: 60,           // POWER APPS Y POWER AUTOMATE (PC-CZ-08)
  program_edition_id: 15070,        // E10-26
  cat_insc_modality: 2625,          // Modalidad Flexible (la misma de 16086)
  cat_payment_channel: 4301,        // GENERAL, como el resto de altas por beneficio
  cat_currency: 3041,               // SOLES
  cat_payment_way: 2466,            // Al contado
  cat_payment_medium: null,         // pago cero: no hay medio de pago
  list_price: 700,                  // tarifa PROFESIONAL de la edicion
  total_amount: 0,
  saved_money: 0,
  is_scholarship: false,            // NO es beca: tiene su propia via en el SP
  is_membership_benefit: true,
  membership_program_id: 169,       // MEMBRESIA GOLDEN
  client_profile: 'profesional',    // el SP espera el texto, no el catalog_id
  agent_origin: 'SA',               // beneficio, no venta: sin asesor acreditado
  seller_agent_id: null,
  observations: 'Beneficio WE GOLD (memb. 16482). Reingreso al curso cuya venta 16086 quedo en CC al financiar el upgrade.'
}

const commit = process.argv.includes('--commit')

const duplicate = await enrollmentRepository.findDuplicate({
  programEditionId: data.program_edition_id, doc: data.document_number, mail: data.email
})
console.log('guard de duplicados ->', duplicate ?? 'libre')
if (duplicate) { console.error('ABORTA: sigue bloqueado'); process.exit(1) }

if (!commit) {
  console.log('SIMULACRO. Payload:\n', data)
  process.exit(0)
}

const resp = await ficoEnrollmentRegister({ data, userId: FICO_USER_ID })
console.log('respuesta:', resp)
