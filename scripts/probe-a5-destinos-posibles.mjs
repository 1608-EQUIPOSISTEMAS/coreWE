// Para cada edicion A5 con alumnos vivos: que ediciones destino existen.
//
// El RP exige que el destino sea del MISMO program_version (enrollment.usecases:227),
// asi que las candidatas son las ediciones futuras de ese mismo programa, no A5.
// Mismo criterio que precarga el A5MigrationModal.
import { q, pool } from './db.mjs'

const { rows: origenes } = await q(`
  SELECT DISTINCT pe.edition_num_id, pe.global_code, pe.program_version_id,
         p.program_name, pe.start_date::date AS inicio
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN public.programs p ON p.program_id = pv.program_id
    JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment AND cseg.alias = 'we_segment_a5'
    JOIN public.enrollments e ON e.program_edition_id = pe.edition_num_id AND e.active = 'Y'
    JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
                            AND cf.alias = 'we_enrollment_status_checked'
    LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
   WHERE cts.alias IS NULL OR cts.alias NOT IN (
           'we_enrollment_status_retired',
           'we_enrollment_status_course_changed',
           'we_enrollment_status_reprogrammed')
   ORDER BY pe.start_date DESC`)

let conDestino = 0
let sinDestino = 0
const huerfanas = []

for (const o of origenes) {
  const { rows: vivos } = await q(`
    SELECT COUNT(*)::int n FROM public.enrollments e
      JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
                              AND cf.alias = 'we_enrollment_status_checked'
      LEFT JOIN public."catalog" cts ON cts.catalog_id = e.cat_type_status
     WHERE e.program_edition_id = $1 AND e.active = 'Y'
       AND (cts.alias IS NULL OR cts.alias NOT IN (
              'we_enrollment_status_retired',
              'we_enrollment_status_course_changed',
              'we_enrollment_status_reprogrammed'))`, [o.edition_num_id])

  const { rows: candidatas } = await q(`
    SELECT pe.edition_num_id, pe.global_code, pe.start_date::date AS inicio
      FROM public.program_editions pe
      LEFT JOIN public."catalog" cseg ON cseg.catalog_id = pe.cat_segment
     WHERE pe.program_version_id = $1
       AND pe.edition_num_id <> $2
       AND pe.active = 'Y'
       AND COALESCE(cseg.alias, '') <> 'we_segment_a5'
       AND pe.start_date >= CURRENT_DATE
     ORDER BY pe.start_date
     LIMIT 3`, [o.program_version_id, o.edition_num_id])

  const inicio = o.inicio.toISOString().slice(0, 10)
  const yaPaso = new Date(o.inicio) < new Date()
  const destinos = candidatas.map(c => `${c.global_code} ${c.inicio.toISOString().slice(0, 10)}`).join('  |  ')

  if (candidatas.length > 0) conDestino++
  else { sinDestino++; huerfanas.push(`${o.edition_num_id} ${o.global_code} ${o.program_name}`) }

  console.log(`\n[${o.edition_num_id}] ${o.global_code} ${o.program_name}`)
  console.log(`   inicio ${inicio}${yaPaso ? '  (YA EMPEZO)' : ''}  ·  ${vivos[0].n} vivo(s)`)
  console.log(`   destinos: ${destinos || '*** NINGUNA edicion futura de este programa ***'}`)
}

console.log(`\n${origenes.length} ediciones A5 con alumnos: ${conDestino} tienen destino posible, ${sinDestino} NO.`)
if (huerfanas.length) console.log('Sin destino:\n  ' + huerfanas.join('\n  '))
await pool.end()
