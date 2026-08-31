// Por que la venta 13041 (CAHUANA CHUMPITAZ) no aparece en su aula:
// sus ediciones cayeron a segmento A5 (canceladas) y nadie la reprogramo.
// Uso: DATABASE_URL=<tunel prod> node scripts/probe-13041-aula.mjs [enrollment_id]
import { q, pool } from './db.mjs'
import { ReprogramacionRepository } from '../src/modules/reprogramacion/reprogramacion.repository.js'

const ID = Number(process.argv[2] || 13041)

const { rows: familia } = await q(`
  SELECT e.enrollment_id AS id, e.parent_enrollment_id AS padre,
         e.program_edition_id AS ed_id, pe.specific_code AS edicion,
         pe.active AS ed_activa, sg.description AS segmento, pe.start_date::date AS inicio,
         pr.program_name AS programa, ts.description AS estado
    FROM enrollments e
    LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    LEFT JOIN programs pr ON pr.program_id = pv.program_id
    LEFT JOIN catalog sg ON sg.catalog_id = pe.cat_segment
    LEFT JOIN catalog ts ON ts.catalog_id = e.cat_type_status
   WHERE e.enrollment_id = $1 OR e.parent_enrollment_id = $1
   ORDER BY e.enrollment_id`, [ID])
console.log('\n== la venta y sus hijos =='); console.table(familia)

// Ediciones vivas del mismo programa que arrancan cerca: los destinos posibles.
const { rows: destinos } = await q(`
  SELECT f.ed AS ed_alumno, pr.program_name AS programa,
         alt.edition_num_id AS destino, alt.specific_code AS codigo, alt.active,
         sg.description AS segmento, alt.start_date::date AS inicio,
         (SELECT COUNT(*) FROM enrollments e2
           WHERE e2.program_edition_id = alt.edition_num_id AND e2.active='Y') AS inscritos
    FROM (SELECT DISTINCT program_edition_id AS ed FROM enrollments
           WHERE enrollment_id = $1 OR parent_enrollment_id = $1) f
    JOIN program_editions pe ON pe.edition_num_id = f.ed
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
    JOIN programs pr ON pr.program_id = pv.program_id
    JOIN program_versions pv2 ON pv2.program_id = pr.program_id
    JOIN program_editions alt ON alt.program_version_id = pv2.program_version_id
    LEFT JOIN catalog sg ON sg.catalog_id = alt.cat_segment
   WHERE alt.start_date BETWEEN pe.start_date - INTERVAL '7 day' AND pe.start_date + INTERVAL '45 day'
   ORDER BY pr.program_name, alt.start_date`, [ID])
console.log('\n== ediciones hermanas (destino de la reprogramacion) =='); console.table(destinos)

const bandeja = await new ReprogramacionRepository({ query: (t, p) => q(t, p) }).listAffected()
const caso = bandeja.find((f) => f.enrollment_id === ID)
console.log(`\n== bandeja /academica/reprogramaciones: ${bandeja.length} casos ==`)
console.log(caso ? { caidas: caso.caidas, reprogram_case_id: caso.reprogram_case_id } : `${ID} NO esta en la bandeja`)

await pool.end()
