// Sondeo previo al import de MARIN DAVILA (PY-PZ-04 / E34). Los modulos 2 y 3
// van reprogramados segun la hoja: hay que confirmar que la edicion destino
// comparte program_version_id con la hija original de edition_structure, si no
// el hijo cambia de programa y no solo de aula.
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT pe.edition_num_id, pe.program_version_id, pv.version_code, pv.abbreviation,
         pe.global_code, pe.start_date::date AS inicio, pe.end_date::date AS fin, pe.active
    FROM program_editions pe
    JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.edition_num_id IN (14924, 15000, 15083, 15066, 15127, 15801)
   ORDER BY pe.start_date`)
console.table(rows)

await pool.end()
