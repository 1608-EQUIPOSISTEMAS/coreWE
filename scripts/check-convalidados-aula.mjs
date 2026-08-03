// Check del bloque "Convalidados" del Historial del aula.
// Ejercita el metodo real del repositorio (no una copia del SQL) contra la BD
// de produccion, con el caso conocido:
//   AIMEE TRUJILLO compro ESPEC. SAP LOG. INTEGRAL E5-26 (ED 15625) y le
//   convalidaron SAP HANA MM: no tiene matricula en ED 15626 porque ya llevo
//   ese curso en ED 14975. Por eso el aula cuenta 25 y no 26.
//
//   node scripts/check-convalidados-aula.mjs
import assert from 'node:assert/strict'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'
import { pool } from './db.mjs'

const repo = new EditionRepository(pool)

const AULA_MM   = 15626 // SAP HANA MM E14-26: aqui SI hay una convalidada
const AULA_EWM  = 15627 // SAP HANA EWM: Aimee si asiste => no debe salir
const DNI_AIMEE = '43928280'

const conv = await repo.classroomValidatedList(AULA_MM)
console.table(conv)

const aimee = conv.find((c) => c.dni === DNI_AIMEE)
assert.ok(aimee, `ED ${AULA_MM}: falta la convalidada DNI ${DNI_AIMEE}`)
assert.equal(aimee.parent_enrollment_id, 14027, 'el paquete padre debe ser el ESP 14027')
assert.ok(/SAP/i.test(aimee.parent_program_name || ''), 'debe traer el nombre del paquete padre')
assert.ok(aimee.prev_start_date, 'debe resolver la edicion donde SI llevo el curso')
// El asesor es AE30 (pidio el token), NO ELFI: seller_agent_id quedo en el
// usuario FICO que confirmo el token. Mismo criterio que agent_code en la
// Lista de Notas (COALESCE(token, seller_agent, agent_origin)).
assert.equal(aimee.agent_code, 'AE30', `asesor esperado AE30, salio ${aimee.agent_code}`)
assert.equal(
  new Date(aimee.prev_start_date).getUTCFullYear() === 2026 &&
  new Date(aimee.prev_start_date) < new Date('2026-07-30'),
  true,
  'la edicion previa debe ser anterior a esta aula'
)

// Un convalidado no puede tener matricula viva en el aula: si la tiene, asiste
// y va en la lista de Notas, no aqui.
const activos = await repo.classroomStudentsList(AULA_MM)
const dnisActivos = new Set(activos.map((s) => s.dni))
for (const c of conv) {
  assert.ok(!dnisActivos.has(c.dni), `${c.full_name} sale como convalidado Y como matriculado`)
}

// El aula donde SI asiste no debe listarla como convalidada.
const convEwm = await repo.classroomValidatedList(AULA_EWM)
assert.ok(
  !convEwm.some((c) => c.dni === DNI_AIMEE),
  `ED ${AULA_EWM}: Aimee asiste a esta aula, no debe salir como convalidada`
)

console.log(`\nOK  ${conv.length} convalidado(s) en ED ${AULA_MM} · ${activos.length} matriculados`)
console.log(`OK  cuadre: ${activos.length} + ${conv.length} = ${activos.length + conv.length} plazas del arbol`)
await pool.end()
