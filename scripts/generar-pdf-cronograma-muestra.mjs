// ponytail: genera PDFs de muestra del cronograma para revisar la columna Dia.
import fs from 'fs'
import { pool } from './db.mjs'
import { generateSchedulePdf } from '../src/services/pdf.service.js'

// Un padre por cada combinacion de dias (1, 2 y 3 dias) para ver los 3 casos.
const { rows } = await pool.query(`
  SELECT DISTINCT ON (hijo.cat_day_combination_id)
         es.parent_edition_id, hijo.edition_num_id AS child_id,
         c.description AS dias
  FROM edition_structure es
  JOIN program_editions hijo ON hijo.edition_num_id = es.child_edition_id
  JOIN catalog c ON c.catalog_id = hijo.cat_day_combination_id
  WHERE hijo.cat_day_combination_id IS NOT NULL
  ORDER BY hijo.cat_day_combination_id, es.parent_edition_id DESC
`)

const outDir = process.argv[2] || '.'
for (const r of rows) {
  const buf = await generateSchedulePdf(r.parent_edition_id, r.child_id)
  const file = `${outDir}/cronograma-${r.dias.replace(/[^\w-]/g, '_')}.pdf`
  fs.writeFileSync(file, buf)
  console.log(`${r.dias.padEnd(14)} padre=${r.parent_edition_id} hijo=${r.child_id} -> ${file} (${buf.length} bytes)`)
}
await pool.end()
