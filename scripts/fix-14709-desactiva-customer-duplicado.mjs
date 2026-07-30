// Completa el soft-delete del alumno duplicado de CARLOTA AZUCENA FLORES HUAMAN:
// el paso previo desactivo persons 19629 + sus contactos, pero NO customers 18387,
// y las busquedas del ERP (sp_customer_list / sp_customer_caller) filtran por
// customers.active, no por persons.active -> el duplicado seguia saliendo.
//
// Reversible (un campo). NO borra nada.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const pw = process.env.PGPASSWORD || decodeURIComponent(m[2])
const CUST_DUP = 18387
const PERSON_DUP = 19629
const EID = 14709

async function conectar (intentos = 5) {
  for (let i = 1; i <= intentos; i++) {
    const cli = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: pw, connectionTimeoutMillis: 10000 })
    try { await cli.connect(); return cli } catch (e) {
      console.error('[intento ' + i + '] tunel caido: ' + e.message)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error('no se pudo conectar')
}

const c = await conectar()
try {
  const previo = (await c.query(
    'select cu.customer_id, cu.active customer_active, cu.person_id, p.active persona_active, ' +
    '  (select count(*) from enrollments e where e.customer_id=cu.customer_id) enrollments, ' +
    '  (select count(*) from course_changes cc where cc.customer_id=cu.customer_id) course_changes, ' +
    '  (select count(*) from leads l where l.person_id=cu.person_id) leads ' +
    'from customers cu join persons p on p.person_id=cu.person_id where cu.customer_id=$1', [CUST_DUP])).rows[0]
  console.log('estado previo:', previo)
  fs.writeFileSync(new URL('./_backup_customer_18387_2026-07-30.json', import.meta.url), JSON.stringify(previo, null, 2))

  // --- GUARDA: no desactivar si todavia cuelga algo -------------------------
  if (Number(previo.enrollments) !== 0) throw new Error('ABORTA: customer ' + CUST_DUP + ' tiene ' + previo.enrollments + ' enrollment(s)')
  if (Number(previo.course_changes) !== 0) throw new Error('ABORTA: customer ' + CUST_DUP + ' referenciado en course_changes')
  if (Number(previo.leads) !== 0) throw new Error('ABORTA: person ' + PERSON_DUP + ' tiene leads')

  await c.query('BEGIN')

  const up = await c.query(
    "update customers set active='N', user_modification_id=22, modification_date=now() " +
    "where customer_id=$1 and active='Y' returning customer_id, active", [CUST_DUP])
  console.log('customer desactivado:', up.rowCount ? up.rows[0] : 'ya estaba en N')

  // Verificacion dentro de la transaccion: el customer REAL no se toco.
  const v = (await c.query(
    "select (select active from customers where customer_id=$1) dup, " +
    "       (select active from customers where customer_id=18331) real, " +
    "       (select active from persons where person_id=$2) persona_dup", [CUST_DUP, PERSON_DUP])).rows[0]
  console.log('verificacion:', v)
  if (v.dup !== 'N') throw new Error('el customer duplicado no quedo en N')
  if (v.real !== 'Y') throw new Error('SE TOCO EL CUSTOMER REAL 18331')
  if (v.persona_dup !== 'N') throw new Error('la persona duplicada deberia seguir en N')

  const JUST = 'Se completa la desactivacion del alumno duplicado: el soft-delete previo dejo customers.active=Y en 18387 y las busquedas del ERP (sp_customer_list / sp_customer_caller) filtran por customers.active, no por persons.active, asi que el duplicado seguia apareciendo en el autocomplete de registro. Sin borrar nada; el alumno real es customer 18331 / person 19573.'
  const au = await c.query(
    "insert into enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes) " +
    "select $1, 'edited', 22, $2, $3::jsonb " +
    "where not exists (select 1 from enrollment_audit_log a where a.enrollment_id=$1 and a.justificacion like 'Se completa la desactivacion del alumno duplicado%')",
    [EID, JUST, JSON.stringify({
      customer_duplicado: { customer_id: CUST_DUP, active: { old: 'Y', new: 'N' } },
      person_duplicada: { person_id: PERSON_DUP, active: 'N (paso previo)' },
      metodo: 'soft-delete reversible, sin DELETE',
      alumno_real: { customer_id: 18331, person_id: 19573 }
    })])
  console.log('audit:', au.rowCount)

  await c.query('COMMIT')
  console.log('\n>>> COMMIT OK')
} catch (e) {
  try { await c.query('ROLLBACK') } catch { /* noop */ }
  console.error('\n!!! ROLLBACK:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
