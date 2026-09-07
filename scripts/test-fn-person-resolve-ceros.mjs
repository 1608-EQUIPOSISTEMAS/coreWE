// Prueba la regla de identidad contra el escenario que produjo el cruce: dos
// alumnos distintos registrados con el documento en ceros. Antes del cambio, el
// alta comercial los daba por la misma persona.
//
// Corre contra la BD que apunte DATABASE_URL. No deja rastro: todo va dentro de
// una transaccion que termina en ROLLBACK.
import { q, pool } from './db.mjs'

const casos = []
const check = (nombre, ok, detalle) => { casos.push({ nombre, ok, detalle }); }

await q('BEGIN')
try {
  // 1. fn_doc_key: cualquier cadena de ceros no es un documento.
  const { rows: [k] } = await q(`
    select fn_doc_key('0') c1, fn_doc_key('00000000') c8, fn_doc_key('000000000') c9,
           fn_doc_key('12345678') real, fn_doc_key('012345678') con_cero_adelante`)
  check('ceros -> sin documento', k.c1 === null && k.c8 === null && k.c9 === null,
        `'0'=${k.c1} '00000000'=${k.c8} '000000000'=${k.c9}`)
  check('documento real se conserva', k.real === '12345678', `'12345678' -> ${k.real}`)
  check('cero a la izquierda normaliza', k.con_cero_adelante === '12345678', `'012345678' -> ${k.con_cero_adelante}`)

  // 2. Dos personas distintas, ambas con el documento en ceros: deben quedar
  //    separadas. Este es exactamente el caso Valeria.
  const { rows: [a] } = await q(
    `select fn_person_resolve('00000000', 2300, 'NICOLAS', 'AVILA', 'test.avila@ejemplo.com', 47) id`)
  const { rows: [b] } = await q(
    `select fn_person_resolve('00000000', 2300, 'JUAN PABLO', 'TORRES', 'test.torres@ejemplo.com', 47) id`)
  check('dos alumnos con ceros NO se fusionan', a.id !== b.id, `persona A=${a.id} persona B=${b.id}`)

  const { rows: [docs] } = await q(
    `select count(*) filter (where document_number is not null) con_doc
       from persons where person_id in ($1, $2)`, [a.id, b.id])
  check('no se les guarda el documento en ceros', Number(docs.con_doc) === 0,
        `personas con document_number no nulo: ${docs.con_doc}`)

  // 3. El mismo documento REAL si tiene que reconocer a la misma persona: es la
  //    razon de ser de la regla y no debe romperse al arreglar lo de arriba.
  const { rows: [c] } = await q(
    `select fn_person_resolve('88776655', 2300, 'ELENA', 'QUISPE', 'test.quispe@ejemplo.com', 47) id`)
  const { rows: [d] } = await q(
    `select fn_person_resolve('88776655', 2300, 'ELENA', 'QUISPE', 'test.quispe@ejemplo.com', 47) id`)
  check('mismo documento real = misma persona', c.id === d.id, `${c.id} vs ${d.id}`)

  // 4. Y el cero a la izquierda no debe partir a la misma persona en dos.
  const { rows: [e] } = await q(
    `select fn_person_resolve('088776655', 2300, 'ELENA', 'QUISPE', 'test.quispe@ejemplo.com', 47) id`)
  check('documento con cero adelante = misma persona', e.id === c.id, `${e.id} vs ${c.id}`)
} finally {
  await q('ROLLBACK')
}

for (const c of casos) console.log(`${c.ok ? 'OK  ' : 'FALLA'} ${c.nombre.padEnd(45)} ${c.detalle}`)
const fallas = casos.filter(c => !c.ok).length
console.log(fallas === 0 ? `\n${casos.length}/${casos.length} OK` : `\n${fallas} FALLA(S)`)
process.exitCode = fallas === 0 ? 0 : 1
await pool.end()
