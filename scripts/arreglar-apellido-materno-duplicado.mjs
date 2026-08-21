// Apellido materno duplicado en persons (caso disparador: inscripcion 13841,
// "MIGUEL ANDRE RUFASTO SAMANIEGO SAMANIEGO").
//
// Causa: el formulario de FICO tiene UN solo campo "Apellidos" y al autocompletar
// por DNI lo llena con paterno + materno (EnrollmentForm.vue:1078). fn_person_resolve
// guardaba ese texto entero en last_name sin tocar mother_last_name, asi que el
// concat_ws(first_name, last_name, mother_last_name) de todas las vistas repetia
// el materno. Cada re-registro/RP/CC de esa persona reescribia lo mismo.
//
// Este script:
//   1. despliega fn_last_name_sin_materno + fn_person_resolve parchado (fuente:
//      scripts/fn_person_resolve.sql), que corta la cola al escribir;
//   2. verifica la regla contra casos conocidos;
//   3. hace el backfill de las personas que ya quedaron con el apellido pegado.
//
// Todo va en UNA transaccion: con --dry se hace ROLLBACK, asi que la simulacion
// puede usar la funcion recien desplegada sin dejar rastro.
//
// Uso:
//   node scripts/arreglar-apellido-materno-duplicado.mjs --dry   # muestra, no guarda
//   node scripts/arreglar-apellido-materno-duplicado.mjs         # aplica
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pool } from './db.mjs'

const esSimulacion = process.argv.includes('--dry')

// Casos que la regla NO puede equivocar: los dos primeros son el bug, el tercero
// es el paterno compuesto que se tiene que quedar intacto.
const CASOS = [
  { apellidos: 'RUFASTO SAMANIEGO', materno: 'SAMANIEGO', esperado: 'RUFASTO' },
  { apellidos: 'CARBAJAL CARBAJAL', materno: 'CARBAJAL', esperado: 'CARBAJAL' },
  { apellidos: 'DE LA CRUZ', materno: 'CRUZ', esperado: 'DE LA CRUZ' },
  { apellidos: 'RUFASTO', materno: 'SAMANIEGO', esperado: 'RUFASTO' },
  { apellidos: 'RUFASTO SAMANIEGO', materno: null, esperado: 'RUFASTO SAMANIEGO' }
]

async function desplegarRegla (c) {
  await c.query(fs.readFileSync('scripts/fn_person_resolve.sql', 'utf8'))
  console.log('desplegadas: fn_txt_key, fn_doc_key, fn_last_name_sin_materno, fn_person_resolve')
}

async function verificarRegla (c) {
  for (const { apellidos, materno, esperado } of CASOS) {
    const { rows } = await c.query('SELECT public.fn_last_name_sin_materno($1, $2) AS r', [apellidos, materno])
    assert.equal(rows[0].r, esperado, `fn_last_name_sin_materno('${apellidos}', '${materno}')`)
  }
  console.log(`regla verificada contra ${CASOS.length} casos`)
}

async function backfill (c) {
  // Misma regla para el backfill y para el alta: si la funcion cambia, ambos
  // cambian juntos y no se puede reintroducir el dato roto por otra via.
  const { rows } = await c.query(`
    SELECT person_id, last_name, mother_last_name,
           public.fn_last_name_sin_materno(last_name, mother_last_name) AS paterno
      FROM public.persons
     WHERE public.fn_last_name_sin_materno(last_name, mother_last_name) <> last_name
     ORDER BY person_id`)
  console.log(`personas con el materno pegado en last_name: ${rows.length}`)
  for (const p of rows) {
    console.log(`  ${p.person_id}: "${p.last_name}" + "${p.mother_last_name}" -> "${p.paterno}"`)
  }
  if (rows.length === 0) return

  const { rowCount } = await c.query(`
    UPDATE public.persons
       SET last_name = public.fn_last_name_sin_materno(last_name, mother_last_name)
     WHERE public.fn_last_name_sin_materno(last_name, mother_last_name) <> last_name`)
  console.log(`corregidas: ${rowCount}`)
}

const c = await pool.connect()
try {
  await c.query('BEGIN')
  await desplegarRegla(c)
  await verificarRegla(c)
  await backfill(c)
  // El panel de FICO lee la cabecera de mv_enrollment_report_system, no de persons.
  if (!esSimulacion) await c.query('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
  await c.query(esSimulacion ? 'ROLLBACK' : 'COMMIT')
  console.log(esSimulacion ? '--- SIMULACION: revertido, no se guardo nada ---' : 'aplicado')
} catch (err) {
  await c.query('ROLLBACK')
  throw err
} finally {
  c.release()
  await pool.end()
}
