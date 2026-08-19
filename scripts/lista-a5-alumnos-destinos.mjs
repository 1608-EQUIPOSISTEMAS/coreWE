// Lista operativa: alumnos vivos en ediciones A5, con su destino posible.
// El RP exige que el destino sea del MISMO program_version, futuro y no A5.
//   PGPASSWORD=... node scripts/lista-a5-alumnos-destinos.mjs
import { q, pool } from './db.mjs'

const { rows } = await q(`
  WITH viva AS (
    SELECT e.enrollment_id, e.parent_enrollment_id, pe.edition_num_id AS ed_a5,
           pe.specific_code AS cod, pe.start_date::date AS ini, pe.program_version_id AS pvid,
           p.program_name AS curso, per.document_number AS dni,
           TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS alumno,
           ppar.program_name AS paquete
      FROM enrollments e
      JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
      LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
      JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN catalog cseg ON cseg.catalog_id = pe.cat_segment AND cseg.alias = 'we_segment_a5'
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN programs p ON p.program_id = pv.program_id
      JOIN customers cu ON cu.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cu.person_id
      LEFT JOIN enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN program_versions ppv ON ppv.program_version_id = par.program_version_id
      LEFT JOIN programs ppar ON ppar.program_id = ppv.program_id
     WHERE e.active = 'Y'
       AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
            'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))
  )
  SELECT * FROM (
  SELECT v.*,
         (SELECT string_agg(d.specific_code || ' ' || to_char(d.start_date,'DD/MM/YY')
                            || ' #' || d.edition_num_id, '  ·  ' ORDER BY d.start_date)
            FROM program_editions d
            LEFT JOIN catalog dseg ON dseg.catalog_id = d.cat_segment
           WHERE d.program_version_id = v.pvid
             AND d.edition_num_id <> v.ed_a5
             AND d.active = 'Y'
             AND d.start_date > CURRENT_DATE
             AND (dseg.alias IS NULL OR dseg.alias <> 'we_segment_a5')) AS destinos
    FROM viva v) x
   ORDER BY (x.destinos IS NULL), x.ini, x.ed_a5, x.alumno`)

const linea = r => `  ${String(r.enrollment_id).padEnd(6)} ${(r.parent_enrollment_id ? 'MODULO' : 'VENTA ')} ${r.alumno.padEnd(42)} ${String(r.dni || '—').padEnd(16)}${r.paquete ? 'cuelga de ' + r.paquete : ''}`

let edActual = null
const imprimir = (grupo, titulo) => {
  console.log(`\n\n${'='.repeat(100)}\n${titulo}\n${'='.repeat(100)}`)
  edActual = null
  for (const r of grupo) {
    if (r.ed_a5 !== edActual) {
      edActual = r.ed_a5
      console.log(`\n#${r.ed_a5} ${r.cod}  ${r.curso}  ·  inicio ${r.ini.toISOString().slice(0,10)}`)
      if (r.destinos) console.log(`   DESTINOS: ${r.destinos}`)
    }
    console.log(linea(r))
  }
}

imprimir(rows.filter(r => r.destinos), `SE PUEDEN REPROGRAMAR  (${rows.filter(r => r.destinos).length} alumnos)`)
imprimir(rows.filter(r => !r.destinos), `SIN EDICION DESTINO  (${rows.filter(r => !r.destinos).length} alumnos)`)
console.log(`\nTOTAL: ${rows.length} alumnos en ${new Set(rows.map(r => r.ed_a5)).size} ediciones A5.`)
await pool.end()
