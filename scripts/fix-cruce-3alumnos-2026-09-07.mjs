// Deshace el cruce de identidad entre 3 alumnos que quedaron colapsados en una
// sola persona (19152 = Ricardo Cabello) porque las ventas de Maricielo (13525)
// y de Juan Alpas (18018) se registraron con el DNI y el nombre de Ricardo:
// fn_person_resolve resuelve por documento, asi que las tres cayeron en la misma
// persona, el mismo customer y el mismo usuario de Odoo.
//
// Idempotente: si la persona destino ya existe (por documento) la reusa.
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const CAT_EMAIL = 2318
const CAT_PHONE = 2319
const CAT_DNI = 2300
const USER_ID = 22
const PERSONA_RICARDO = 19152

const RICARDO = {
  firstName: 'RICARDO ANDRES', lastName: 'CABELLO', motherLastName: 'RIVADENEYRA',
  document: '73117361', email: 'ricabellori0798@gmail.com', phone: '956245597'
}

const A_SEPARAR = [
  {
    persona: { firstName: 'MARICIELO LIZETH', lastName: 'JÁUREGUI', motherLastName: 'ALFARO',
               document: '75462134', email: 'maricielojaurepe@gmail.com', phone: '946182072' },
    enrollments: [13525],
    odoo: { userId: 20538, studentId: 125577, email: 'maricielojaurepe@gmail.com' }
  },
  {
    persona: { firstName: 'JUAN', lastName: 'ALPAS', motherLastName: null,
               document: '78451212', email: 'juan.alpas2507@gmail.com', phone: '955487111' },
    enrollments: [18018, 18019, 18020, 18021],
    odoo: { userId: 328, studentId: 128125, email: 'juan.alpas2507@gmail.com' }
  }
]

async function respaldar () {
  const ids = A_SEPARAR.flatMap(s => s.enrollments).concat([13447, 13448, 13449, 13450, 13451, 13452, 13547])
  const backup = {
    fecha: new Date().toISOString(),
    enrollments: (await q('select * from enrollments where enrollment_id = any($1)', [ids])).rows,
    persons: (await q('select * from persons where person_id=$1', [PERSONA_RICARDO])).rows,
    customers: (await q('select * from customers where person_id=$1', [PERSONA_RICARDO])).rows,
    person_contacts: (await q('select * from person_contacts where person_id=$1', [PERSONA_RICARDO])).rows
  }
  writeFileSync('scripts/_backup_cruce_3alumnos_2026-09-07.json', JSON.stringify(backup, null, 2))
  console.log('backup escrito: scripts/_backup_cruce_3alumnos_2026-09-07.json')
}

// Deja UN solo contacto activo por via: los demas se dan de baja logica para no
// perder el rastro de lo que el ERP creyo durante el cruce.
async function fijarContactoUnico (personId, catWay, valor) {
  await q(`update person_contacts set active='N', user_modification_id=$3, modification_date=NOW()
            where person_id=$1 and cat_way_contact=$2 and active='Y' and value <> $4`,
          [personId, catWay, USER_ID, valor])
  const { rowCount } = await q(`update person_contacts set active='Y', is_main=true
            where person_id=$1 and cat_way_contact=$2 and value=$3`, [personId, catWay, valor])
  if (rowCount === 0) {
    await q(`insert into person_contacts (person_id, cat_way_contact, value, active, is_main, registration_date, user_registration_id)
             values ($1,$2,$3,'Y',true,NOW(),$4)`, [personId, catWay, valor, USER_ID])
  }
}

async function resolverPersona ({ firstName, lastName, motherLastName, document }) {
  const { rows } = await q('select person_id from persons where document_number=$1 and active=$2', [document, 'Y'])
  if (rows.length) return rows[0].person_id
  const { rows: [nueva] } = await q(
    `insert into persons (first_name, last_name, mother_last_name, document_number, cat_type_document,
                          active, registration_date, user_registration_id)
     values ($1,$2,$3,$4,$5,'Y',NOW(),$6) returning person_id`,
    [firstName, lastName, motherLastName, document, CAT_DNI, USER_ID])
  return nueva.person_id
}

async function resolverCustomer (personId) {
  const { rows } = await q('select customer_id from customers where person_id=$1', [personId])
  if (rows.length) return rows[0].customer_id
  const { rows: [nuevo] } = await q(
    `insert into customers (person_id, active, registration_date, user_registration_id)
     values ($1,'Y',NOW(),$2) returning customer_id`, [personId, USER_ID])
  return nuevo.customer_id
}

await respaldar()
await q('BEGIN')
try {
  // 1. Ricardo se queda con la persona original: solo hay que enderezar sus
  //    datos, que la venta de Juan del 28/08 y el correo de Maricielo pisaron.
  await q(`update persons set first_name=$2, last_name=$3, mother_last_name=$4,
                              modification_date=NOW(), user_modification_id=$5
            where person_id=$1`,
          [PERSONA_RICARDO, RICARDO.firstName, RICARDO.lastName, RICARDO.motherLastName, USER_ID])
  await fijarContactoUnico(PERSONA_RICARDO, CAT_EMAIL, RICARDO.email)
  await fijarContactoUnico(PERSONA_RICARDO, CAT_PHONE, RICARDO.phone)
  console.log(`persona ${PERSONA_RICARDO} (Ricardo) enderezada`)

  // 2. Maricielo y Juan salen a persona/customer propios, con su usuario real
  //    de Odoo (que ya existia: el ERP nunca lo uso porque reusaba el de Ricardo).
  for (const { persona, enrollments, odoo } of A_SEPARAR) {
    const personId = await resolverPersona(persona)
    const customerId = await resolverCustomer(personId)
    await fijarContactoUnico(personId, CAT_EMAIL, persona.email)
    await fijarContactoUnico(personId, CAT_PHONE, persona.phone)

    await q(`update enrollments set customer_id=$2, user_modification_id=$3, modification_date=NOW()
              where enrollment_id = any($1)`, [enrollments, customerId, USER_ID])
    await q(`update enrollments set odoo_user_id=$2, odoo_student_id=$3, odoo_email=$4
              where enrollment_id=$1`, [enrollments[0], odoo.userId, odoo.studentId, odoo.email])
    console.log(`${persona.firstName} ${persona.lastName}: persona=${personId} customer=${customerId} enrollments=${enrollments}`)
  }
  await q('COMMIT')
  console.log('\nOK - commit')
} catch (err) {
  await q('ROLLBACK')
  console.error('ROLLBACK:', err.message)
  process.exitCode = 1
}
await pool.end()
