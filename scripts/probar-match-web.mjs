// Prueba de punta a punta del Match WEB contra la BD de pruebas. Busca una
// venta WEB con consulta candidata, engancha, verifica y hace ROLLBACK: no deja
// nada escrito.
import 'dotenv/config'
import { pool } from './db.mjs'
import { EnrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'

const client = await pool.connect()
const repo = new EnrollmentRepository(client)

// Un FICO real para que trg_check_lead_modification_permission deje pasar.
const { rows: [fico] } = await client.query(`
  SELECT ur.user_id FROM user_roles ur JOIN rol r ON r.rol_id = ur.rol_id
   WHERE UPPER(r.alias) = 'FICO' LIMIT 1`)

const { rows: ventas } = await client.query(`
  SELECT e.enrollment_id
    FROM enrollments e
    JOIN customers cu ON cu.customer_id = e.customer_id
    JOIN persons   pe ON pe.person_id   = cu.person_id
   WHERE e.agent_origin = 'WEB'
     AND EXISTS (
       SELECT 1 FROM leads l
        WHERE l.program_version_id = e.program_version_id
          AND l.enrollment_id IS NULL AND l.active = 'Y'
          AND l.origin_phone = (SELECT pc.value FROM person_contacts pc
                                 WHERE pc.person_id = pe.person_id
                                   AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias='we_way_contact_phone' LIMIT 1)
                                   AND pc.active='Y'
                                 ORDER BY pc.registration_date DESC LIMIT 1))
   ORDER BY e.enrollment_id DESC LIMIT 1`)

if (!ventas.length) { console.log('Sin venta WEB con candidata en esta BD.'); await client.release(); await pool.end(); process.exit(0) }
const eid = ventas[0].enrollment_id

await client.query('BEGIN')
try {
  const candidatas = await repo.findWebMatchCandidates(eid)
  console.log(`venta WEB ${eid} -> ${candidatas.length} consulta(s) candidata(s)`)
  console.table(candidatas)

  const elegida = candidatas[0]
  const filas = await repo.linkLeadToEnrollment(elegida.lead_id, eid, fico.user_id)
  console.log(`linkLeadToEnrollment escribio ${filas} fila(s)`)

  const { rows: [lead] } = await client.query(`
    SELECT l.lead_id, l.enrollment_id, c.alias AS estado, l.pay_date
      FROM leads l LEFT JOIN catalog c ON c.catalog_id = l.cat_status_lead
     WHERE l.lead_id = $1`, [elegida.lead_id])
  console.table([lead])

  const ok = lead.enrollment_id === eid
    && lead.estado === 'we_lead_status_bought'
    && lead.pay_date !== null
  console.log(ok ? 'OK: lead enganchado, en Pago y con fecha de pago.'
                 : 'FALLO: el lead no quedo como se esperaba.')

  // Ya no debe ofrecerse como candidata (enrollment_id deja de ser NULL).
  const despues = await repo.findWebMatchCandidates(eid)
  console.log(despues.some(c => c.lead_id === elegida.lead_id)
    ? 'FALLO: la consulta enganchada sigue apareciendo como candidata.'
    : 'OK: la consulta enganchada ya no aparece como candidata.')
} finally {
  await client.query('ROLLBACK')
  client.release()
  await pool.end()
  // Importar el repository arranca el cron de refresh de matviews: sin exit
  // explicito el proceso queda vivo.
  process.exit(0)
}
