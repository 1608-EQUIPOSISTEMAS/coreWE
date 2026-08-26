// BUG REPRODUCIBLE de sp_edition_tree_register (hallado el 2026-08-25 armando
// el modulo Planificacion).
//
// Con specific_code = NULL, sp_edition_register (cursos) numera bien: la 2da
// edicion de la misma version de programa recibe el siguiente correlativo. Pero
// sp_edition_tree_register (paquetes) le pone SIEMPRE "E1-<anio>", asi que la
// segunda edicion del mismo paquete viola el indice unico
//   uk_specific_code_version_active (specific_code, program_version_id)
//                                    WHERE flag_history = false
//
// En el cronograma real no salta porque Producto escribe el codigo a mano en el
// modal. El modulo Planificacion, que publica en masa, si lo destapo, y lo
// esquiva numerando los paquetes por su cuenta (scheduleplan.usecases.js,
// nextSpecificCode). Cuando el SP se arregle, ese rodeo se puede borrar.
//
//   node scripts/bug-sp-tree-register-specific-code.mjs
import { pool, q } from './db.mjs'
import { callProcedureReturningRows } from '../src/utils/spHelper.js'

const VERSION = 66 // ESPECIALIZACION EN POWER APPS Y POWER AUTOMATE
const ANIO = 2029  // futuro lejano: no pisa nada real

console.log('indice unico involucrado:')
console.table((await q(
  `SELECT indexdef FROM pg_indexes WHERE indexname = 'uk_specific_code_version_active'`)).rows)

const base = {
  edition_id: null, program_version_id: VERSION, vacant: null, active: 'Y',
  notes: 'sondeo bug tree specific_code', year: ANIO,
  global_code: null, specific_code: null,
  expedient: 'N', upgrade: 'N', cat_segment_id: null, preconfirmation: 'N', confirmation: 'N',
  children: [{
    sort_order: 1, child_program_version_id: 60, instructor_id: null, new: true,
    edition_id: null, start_date: '2029-03-03', end_date: '2029-04-07',
    cat_day_combination_id: 3009, cat_hour_combination_id: 3018,
    expedient: 'N', upgrade: 'N', preconfirmation: 'N', confirmation: 'N', active: 'Y'
  }]
}

async function alta (etiqueta, cambios) {
  const payload = { ...base, ...cambios }
  const filas = await callProcedureReturningRows(
    pool, 'public.sp_edition_tree_register', [JSON.stringify(payload), 9]
  ).catch(err => [{ result: 0, message: err.message }])
  console.log(`${etiqueta} ->`, JSON.stringify(filas[0]))
}

console.log('\nDos altas del MISMO paquete con specific_code en null:')
await alta('1ra', {})
await alta('2da', { children: [{ ...base.children[0], start_date: '2029-05-05', end_date: '2029-06-09' }] })

console.log('\nLa misma 2da alta, pero con el codigo calculado por nosotros:')
const { rows } = await q(
  `SELECT COALESCE(MAX(NULLIF(substring(specific_code FROM '^E([0-9]+)-'), '')::int), 0) AS seq
     FROM program_editions WHERE program_version_id = $1
       AND specific_code ~ '^E[0-9]+-[0-9]+$'`, [VERSION])
const codigo = `E${Number(rows[0].seq) + 1}-${String(ANIO).slice(-2)}`
await alta(`2da con ${codigo}`, {
  specific_code: codigo,
  children: [{ ...base.children[0], start_date: '2029-05-05', end_date: '2029-06-09' }]
})

console.table((await q(
  `SELECT edition_num_id, program_version_id, global_code, specific_code
     FROM program_editions WHERE notes = 'sondeo bug tree specific_code'
     ORDER BY edition_num_id`)).rows)

// No deja basura: las ediciones de la demostracion se borran.
await q("DELETE FROM program_editions WHERE notes = 'sondeo bug tree specific_code'")
console.log('\n(ediciones de la demostracion borradas)')
await pool.end()
