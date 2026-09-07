// Desarma la ficha 14634, que acumulo 6 identidades distintas porque el alta
// comercial busca la persona con `document_number = <texto>` y seis registros
// llegaron con el DNI en '00000000'.
//
// La identidad real de cada inscripcion NO se adivina: sale del lead que la
// origino (leads.full_name) o de una persona que ya existe en la BD con ese
// mismo correo/telefono. Las que no tienen respaldo no se tocan.
//
// Las personas nuevas van con document_number NULL, nunca ceros: es lo que
// fn_doc_key ya interpreta como "sin documento" y lo que evita que vuelvan a
// juntarse.
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const CAT_EMAIL = 2318
const CAT_PHONE = 2319
const USER_ID = 47
const FICHA_BASURERO = 14634

const MUDANZAS = [
  { enrollments: [1830, 2695], personId: 90043,
    quien: 'MARICIELO TRABAJ MURILLO',
    evidencia: 'correo de 1830 y telefono de 2695 ya registrados en la persona 90043',
    contactos: [[CAT_EMAIL, 'bri.lizeth.4901@gmail.com'], [CAT_PHONE, '977728927']] },

  { enrollments: [16633], persona: { firstName: 'ABEL', lastName: 'SABOGAL' },
    quien: 'ABEL SABOGAL',
    evidencia: 'lead 429325 (asabogal@lima-airport.com)',
    contactos: [[CAT_EMAIL, 'asabogal@lima-airport.com'], [CAT_PHONE, '998330453']] },

  { enrollments: [18358], personId: 17104,
    quien: 'JUAN PABLO TORRES PAZ',
    evidencia: 'lead 431430 + persona 17104 con DNI 43104661 y ese mismo correo',
    contactos: [[CAT_EMAIL, 'jpablotorres85@gmail.com'], [CAT_PHONE, '993510883']] },

  { enrollments: [18492], persona: { firstName: 'NICOLAS', lastName: 'AVILA' },
    quien: 'NICOLAS AVILA',
    evidencia: 'lead 431619 (n.avila@slimstock.com)',
    contactos: [[CAT_EMAIL, 'n.avila@slimstock.com'], [CAT_PHONE, '957157582']] },

  // OJO: 18500 es la misma persona y el mismo evento que la 18435 que Valeria ya
  // habia registrado bien el dia anterior. Se muda para sacarla de la ficha
  // sucia, pero queda como inscripcion duplicada a la vista de FICO: anularla es
  // decision del area, no de este script.
  { enrollments: [18500], personId: 90162,
    quien: 'JOHAN AUGUSTO GASPAR JUAREZ (duplicado de 18435)',
    evidencia: 'lead 431629 + persona 90162 con DNI 72012467',
    contactos: [] }
]

async function respaldar () {
  const ids = MUDANZAS.flatMap(m => m.enrollments)
  writeFileSync('scripts/_backup_ficha_14634_2026-09-07.json', JSON.stringify({
    fecha: new Date().toISOString(),
    persons: (await q('select * from persons where person_id=$1', [FICHA_BASURERO])).rows,
    customers: (await q('select * from customers where person_id=$1', [FICHA_BASURERO])).rows,
    person_contacts: (await q('select * from person_contacts where person_id=$1', [FICHA_BASURERO])).rows,
    enrollments: (await q('select * from enrollments where enrollment_id = any($1)', [ids])).rows
  }, null, 2))
  console.log('backup escrito: scripts/_backup_ficha_14634_2026-09-07.json')
}

async function agregarContacto (personId, catWay, valor) {
  const { rowCount } = await q(
    `update person_contacts set active='Y' where person_id=$1 and cat_way_contact=$2 and value=$3`,
    [personId, catWay, valor])
  if (rowCount === 0) {
    await q(`insert into person_contacts (person_id, cat_way_contact, value, active, registration_date, user_registration_id)
             values ($1,$2,$3,'Y',NOW(),$4)`, [personId, catWay, valor, USER_ID])
  }
}

async function resolverCustomer (personId) {
  const { rows } = await q('select customer_id from customers where person_id=$1', [personId])
  if (rows.length) return rows[0].customer_id
  const { rows: [nuevo] } = await q(
    `insert into customers (person_id, active, registration_date, user_registration_id)
     values ($1,'Y',NOW(),$2) returning customer_id`, [personId, USER_ID])
  return nuevo.customer_id
}

async function resolverPersona ({ firstName, lastName }) {
  const { rows } = await q(
    `select person_id from persons
      where first_name=$1 and last_name=$2 and document_number is null and active='Y'`,
    [firstName, lastName])
  if (rows.length) return rows[0].person_id
  const { rows: [nueva] } = await q(
    `insert into persons (first_name, last_name, document_number, cat_type_document,
                          active, registration_date, user_registration_id)
     values ($1,$2,NULL,NULL,'Y',NOW(),$3) returning person_id`,
    [firstName, lastName, USER_ID])
  return nueva.person_id
}

await respaldar()
await q('BEGIN')
try {
  for (const m of MUDANZAS) {
    const personId = m.personId ?? await resolverPersona(m.persona)
    const customerId = await resolverCustomer(personId)
    for (const [catWay, valor] of m.contactos) await agregarContacto(personId, catWay, valor)
    await q(`update enrollments set customer_id=$2, user_modification_id=$3, modification_date=NOW()
              where enrollment_id = any($1)`, [m.enrollments, customerId, USER_ID])
    console.log(`${m.quien.padEnd(48)} persona=${String(personId).padEnd(6)} customer=${String(customerId).padEnd(6)} <- ${m.enrollments}`)
  }

  const { rows: [{ quedan }] } = await q(
    `select count(*)::int quedan from enrollments e join customers c on c.customer_id=e.customer_id
      where c.person_id=$1`, [FICHA_BASURERO])
  if (quedan > 0) throw new Error(`la ficha ${FICHA_BASURERO} todavia tiene ${quedan} inscripciones`)

  // Baja logica, nunca DELETE: la ficha es el rastro de como se produjo el cruce.
  await q(`update person_contacts set active='N', user_modification_id=$2, modification_date=NOW()
            where person_id=$1`, [FICHA_BASURERO, USER_ID])
  await q(`update customers set active='N', user_modification_id=$2, modification_date=NOW()
            where person_id=$1`, [FICHA_BASURERO, USER_ID])
  await q(`update persons set active='N', document_number=NULL, user_modification_id=$2, modification_date=NOW()
            where person_id=$1`, [FICHA_BASURERO, USER_ID])
  console.log(`\nficha ${FICHA_BASURERO} vaciada y dada de baja (document_number '00000000' borrado)`)

  await q('COMMIT')
  console.log('OK - commit')
} catch (err) {
  await q('ROLLBACK')
  console.error('ROLLBACK:', err.message)
  process.exitCode = 1
}
await pool.end()
