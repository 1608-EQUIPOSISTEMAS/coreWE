// Neutraliza los documentos "en ceros" que quedaban en produccion.
//
// Por que importa aunque estas tres fichas hoy esten sanas: mientras el valor
// siga ahi, cualquier flujo que compare el documento como texto lo trata como un
// DNI legitimo. Con NULL eso deja de pasar (NULL nunca es igual a nada) y ademas
// libera el indice unico de persons.document_number. No se pierde informacion:
// una cadena de ceros no es un dato.
//
// Personas por id explicito, no por patron: son tres y conviene que quede
// escrito cuales fueron.
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const USER_ID = 47
const PERSONAS = [1183, 90184, 90185]          // doc en ceros: '0', 18 ceros, 9 ceros
const TELEFONOS_BASURA = [1183, 82308, 82310]  // person_contact_id de esas mismas personas

const antes = {
  personas: (await q(`select person_id, document_number, cat_type_document,
                             concat_ws(' ', first_name, last_name) nombre
                        from persons where person_id = any($1) order by person_id`, [PERSONAS])).rows,
  contactos: (await q(`select person_contact_id, person_id, cat_way_contact, value, active
                        from person_contacts where person_contact_id = any($1)`, [TELEFONOS_BASURA])).rows
}
writeFileSync('scripts/_backup_dni_en_ceros_2026-09-07.json',
  JSON.stringify({ fecha: new Date().toISOString(), antes }, null, 2))
console.log('backup escrito: scripts/_backup_dni_en_ceros_2026-09-07.json')
console.table(antes.personas)

await q('BEGIN')
try {
  const { rowCount: docs } = await q(
    `update persons set document_number = NULL, cat_type_document = NULL,
                        modification_date = NOW(), user_modification_id = $2
      where person_id = any($1)`, [PERSONAS, USER_ID])
  const { rowCount: tels } = await q(
    `update person_contacts set active = 'N', modification_date = NOW(), user_modification_id = $2
      where person_contact_id = any($1)`, [TELEFONOS_BASURA, USER_ID])
  await q('COMMIT')
  console.log(`\nOK - ${docs} documentos en ceros -> NULL, ${tels} telefonos en ceros dados de baja`)
} catch (err) {
  await q('ROLLBACK')
  console.error('ROLLBACK:', err.message)
  process.exitCode = 1
}
await pool.end()
