// Correccion del destino de CC 14709 (CARLOTA AZUCENA FLORES HUAMAN).
// A1: repuntar el enrollment al customer real (18331), no al duplicado (18387).
// A2: heredar el vinculo Odoo del origen 14596 (user 49110 / student 589437).
// B1: desactivar (soft) la persona duplicada 19629 y sus contactos.
// Idempotente. Una sola conexion, una sola transaccion. NO borra nada.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const m = (process.env.DATABASE_URL || '').match(/^postgresql:\/\/([^:]+):([^@]+)@/)
const pw = process.env.PGPASSWORD || decodeURIComponent(m[2])
const EID = 14709
const CUST_OK = 18331
const CUST_DUP = 18387
const PERSON_DUP = 19629

async function conectar (intentos = 5) {
  for (let i = 1; i <= intentos; i++) {
    const cli = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'neondb', user: 'postgres', password: pw, connectionTimeoutMillis: 10000 })
    try { await cli.connect(); return cli } catch (e) {
      console.error('[intento ' + i + '] tunel caido: ' + e.message)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw new Error('no se pudo conectar tras varios intentos')
}

const c = await conectar()
try {
  const backup = {}
  backup.enrollment = (await c.query('select enrollment_id, customer_id, odoo_user_id, odoo_student_id, odoo_email from enrollments where enrollment_id=$1', [EID])).rows
  backup.persona_dup = (await c.query('select person_id, active from persons where person_id=$1', [PERSON_DUP])).rows
  backup.contactos_dup = (await c.query('select person_contact_id, active, value from person_contacts where person_id=$1', [PERSON_DUP])).rows
  fs.writeFileSync(new URL('./_backup_14709_2026-07-30.json', import.meta.url), JSON.stringify(backup, null, 2))
  console.log('backup: scripts/_backup_14709_2026-07-30.json\n', JSON.stringify(backup))

  await c.query('BEGIN')

  // --- A1: el destino cuelga del alumno real -------------------------------
  const a1 = await c.query(
    'update enrollments set customer_id=$2, user_modification_id=22, modification_date=now() ' +
    'where enrollment_id=$1 and customer_id=$3 returning customer_id', [EID, CUST_OK, CUST_DUP])
  console.log('A1 customer_id ->', a1.rowCount ? a1.rows[0].customer_id : 'ya estaba en ' + CUST_OK)

  // --- A2: vinculo Odoo heredado del origen --------------------------------
  const a2 = await c.query(
    'update enrollments d set odoo_user_id=o.odoo_user_id, odoo_student_id=o.odoo_student_id, odoo_email=o.odoo_email ' +
    'from enrollments o where d.enrollment_id=$1 and o.enrollment_id=$2 and d.odoo_user_id is null ' +
    'returning d.odoo_user_id, d.odoo_student_id, d.odoo_email', [EID, 14596])
  console.log('A2 odoo ->', a2.rowCount ? a2.rows[0] : 'ya tenia vinculo')

  // --- B1: soft-disable del duplicado (NUNCA delete) -----------------------
  // Guarda: solo si ya no cuelga ningun enrollment del customer duplicado.
  const colgando = Number((await c.query('select count(*) n from enrollments where customer_id=$1', [CUST_DUP])).rows[0].n)
  if (colgando > 0) throw new Error(`El customer duplicado ${CUST_DUP} todavia tiene ${colgando} enrollment(s): no se desactiva`)

  const b1a = await c.query("update persons set active='N', user_modification_id=22, modification_date=now() where person_id=$1 and active='Y'", [PERSON_DUP])
  const b1b = await c.query("update person_contacts set active='N', user_modification_id=22, modification_date=now() where person_id=$1 and active='Y'", [PERSON_DUP])
  console.log('B1 persona desactivada:', b1a.rowCount, '| contactos desactivados:', b1b.rowCount)

  // --- Verificacion antes del commit ---------------------------------------
  const v = (await c.query(
    'select e.customer_id, cu.person_id, e.odoo_user_id, e.odoo_student_id, e.odoo_email, ' +
    '  (select active from persons where person_id=$2) dup_person_active, ' +
    '  (select count(*) from person_contacts where person_id=$2 and active=\'Y\') dup_contactos_activos ' +
    'from enrollments e join customers cu on cu.customer_id=e.customer_id where e.enrollment_id=$1', [EID, PERSON_DUP])).rows[0]
  console.log('verificacion:', v)
  if (v.customer_id !== CUST_OK) throw new Error('customer_id no quedo en ' + CUST_OK)
  if (v.person_id !== 19573) throw new Error('el enrollment no quedo en la persona real 19573')
  if (v.odoo_email !== 'carlotaazucenaflores@gmail.com') throw new Error('odoo_email incorrecto: ' + v.odoo_email)
  if (v.dup_person_active !== 'N') throw new Error('la persona duplicada sigue activa')
  if (Number(v.dup_contactos_activos) !== 0) throw new Error('quedan contactos activos del duplicado')

  // --- Audit ---------------------------------------------------------------
  const JUST = 'Correccion CC: el registro directo creo un alumno DUPLICADO (person 19629 / customer 18387) porque el SP resuelve la persona solo por documento y la alumna no tiene DNI. Se repunta el destino al alumno real (customer 18331 / person 19573), se hereda el vinculo Odoo del origen 14596 (user 49110, student 589437, carlotaazucenaflores@gmail.com) y se desactiva el duplicado sin borrarlo.'
  const CHANGES = JSON.stringify({
    customer_id: { old: CUST_DUP, new: CUST_OK },
    person_id: { old: PERSON_DUP, new: 19573 },
    odoo_user_id: { old: null, new: 49110 },
    odoo_student_id: { old: null, new: 589437 },
    odoo_email: { old: null, new: 'carlotaazucenaflores@gmail.com' },
    duplicado_desactivado: { person_id: PERSON_DUP, person_contacts: [24905, 24906], metodo: 'active=N (soft, sin delete)' },
    customer_duplicado_huerfano: CUST_DUP
  })
  const au = await c.query(
    "insert into enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes) " +
    "select $1, 'edited', 22, $2, $3::jsonb " +
    "where not exists (select 1 from enrollment_audit_log a where a.enrollment_id=$1 and a.justificacion like 'Correccion CC: el registro directo creo un alumno DUPLICADO%')",
    [EID, JUST, CHANGES])
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
