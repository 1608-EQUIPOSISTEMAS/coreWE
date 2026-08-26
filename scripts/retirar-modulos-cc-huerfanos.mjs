// Retira los modulos del paquete ORIGEN que quedaron vivos tras un Cambio de
// Curso y que TODAVIA NO EMPEZABAN cuando el alumno se fue. Backfill de los
// casos anteriores al fix de courseChange (25/08/2026); los que ya se habian
// dictado se dejan: el alumno si ocupo ese asiento.
//
// Autorizado por el usuario el 25/08/2026. Idempotente: relanzarlo no hace nada.
// Uso: node scripts/retirar-modulos-cc-huerfanos.mjs [--aplicar]
import { q, pool } from './db.mjs'

const APLICAR = process.argv.includes('--aplicar')
const RETIRADO = 3245 // catalog we_enrollment_status_retired
const ADMIN = 9
// Los 4 revisados uno por uno con el usuario. Si la query devuelve algo fuera de
// esta lista, hay un caso nuevo que nadie miro: mejor abortar que retirar a ciegas.
const APROBADOS = [1987, 3610, 3611, 7076]

const { rows: candidatos } = await q(`
  SELECT h.enrollment_id, h.parent_enrollment_id AS origen, cc.created_at::date AS fecha_cc,
         TRIM(CONCAT_WS(' ', per.last_name, per.mother_last_name, per.first_name)) AS alumno,
         p.program_name || ' ' || pe.specific_code AS aula, pe.start_date
    FROM course_changes cc
    JOIN enrollments h ON h.parent_enrollment_id = cc.enrollment_origin_id
                      AND h.enrollment_id <> cc.enrollment_destination_id
    JOIN customers cu ON cu.customer_id = h.customer_id
    JOIN persons per ON per.person_id = cu.person_id
    JOIN program_editions pe ON pe.edition_num_id = h.program_edition_id
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN programs p ON p.program_id = pv.program_id
    JOIN catalog cf ON cf.catalog_id = h.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN catalog cts ON cts.catalog_id = h.cat_type_status
   WHERE cc.active = 'Y' AND h.active = 'Y'
     AND (cts.alias IS NULL OR cts.alias NOT IN (
            'we_enrollment_status_retired', 'we_enrollment_status_course_changed',
            'we_enrollment_status_reprogrammed'))
     AND pe.start_date > cc.created_at::date
   ORDER BY h.enrollment_id`)

for (const c of candidatos) {
  console.log(`#${c.enrollment_id} | ${c.alumno} | ${c.aula} | inicia ${c.start_date.toISOString().slice(0, 10)} | CC ${c.fecha_cc.toISOString().slice(0, 10)} (origen #${c.origen})`)
}
if (!candidatos.length) { console.log('nada por retirar'); await pool.end(); process.exit(0) }

const inesperados = candidatos.filter(c => !APROBADOS.includes(c.enrollment_id))
if (inesperados.length) {
  throw new Error(`casos NO revisados: ${inesperados.map(c => '#' + c.enrollment_id).join(', ')} — revisarlos antes de retirar`)
}
if (!APLICAR) { console.log('\n(solo listado: agregar --aplicar para retirar)'); await pool.end(); process.exit(0) }

for (const c of candidatos) {
  // Mismo par de operaciones que repo.retireChild: estado + cuotas no pagadas.
  await q('UPDATE enrollments SET cat_type_status = $1, user_modification_id = $2, modification_date = NOW() WHERE enrollment_id = $3',
    [RETIRADO, ADMIN, c.enrollment_id])
  await q('DELETE FROM payment_installments WHERE enrollment_id = $1 AND cat_status NOT IN (4454, 2471)', [c.enrollment_id])
  await q(`INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, performed_at, justificacion, details)
           VALUES ($1, 'retired', $2, NOW(), $3, $4)`,
  [c.enrollment_id, ADMIN,
    'Backfill 25/08/2026: el flujo de Cambio de Curso no retiraba los modulos del paquete origen.',
    `Retirado por cambio de curso del programa padre #${c.origen} (el modulo empezaba el ${c.start_date.toISOString().slice(0, 10)}, despues del CC del ${c.fecha_cc.toISOString().slice(0, 10)})`])
  console.log(`retirado #${c.enrollment_id}`)
}

await q('REFRESH MATERIALIZED VIEW mv_enrollment_report_system')
console.log('matview refrescada')
await pool.end()
