// Fase 3 de la importación FICO: aplicar la columna ESTADO ALUMNO. El
// importador crea TODO en ACT porque el SP de alta no conoce RP ni R; la hoja sí
// los marca. Aquí el padre importado toma el estado real y sus aulas hijas el que
// les corresponde (RP -> hijas R; R -> hijas R). Ver memoria "modelo-reprogramacion-rp".
//
// Uso (desde Backend/):
//   node scripts/fix-estado-alumno-hoja-fico.mjs scripts/_hoja_xxx.csv            (dry-run)
//   node scripts/fix-estado-alumno-hoja-fico.mjs scripts/_hoja_xxx.csv --aplicar
//
// Idempotente: solo toca inscripciones de la importación masiva que sigan en ACT.
import { readFile, writeFile } from 'node:fs/promises'
import { q, pool } from './db.mjs'

const csv = process.argv[2]
const aplicar = process.argv.includes('--aplicar')
if (!csv) { console.error('Falta el CSV congelado de la hoja.'); process.exit(1) }

const ACT = 3100
const ESTADO = { RP: 3240, R: 3245 } // hoja -> cat_type_status del padre
const HIJA = 3245 // R: el aula de un origen reprogramado/retirado no se cursa

const { loadWorkbook } = await import('../src/modules/importer/importer.sources.js')
const { cellText, buildHeaderIndex, findCol } = await import('../src/modules/importer/importer.xlsx.js')

const wb = await loadWorkbook(await readFile(csv), 'csv')
const ws = wb.worksheets[0]
let headerRow = 1
ws.eachRow((row, n) => {
  if (headerRow > 1) return
  for (let c = 1; c <= row.cellCount; c++) {
    if (/^dni$/i.test(cellText(row.getCell(c).value).trim())) headerRow = n
  }
})
const idx = buildHeaderIndex(ws, headerRow)
const cDni = findCol(idx, ['dni'])
const cNombre = findCol(idx, ['nombres y apellidos'])
const cEd = findCol(idx, ['ed'])
const cEstado = findCol(idx, ['estado alumno'])

const objetivo = []
ws.eachRow((row, n) => {
  if (n <= headerRow) return
  const estado = cellText(row.getCell(cEstado).value).trim().toUpperCase()
  if (!ESTADO[estado]) return
  objetivo.push({
    fila: n,
    dni: cellText(row.getCell(cDni).value).trim(),
    nombre: cellText(row.getCell(cNombre).value).trim(),
    ed: cellText(row.getCell(cEd).value).trim(),
    estado
  })
})
console.log(`filas con ESTADO ALUMNO RP/R en la hoja: ${objetivo.length}`)

const backup = []
for (const o of objetivo) {
  const { rows } = await q(`
    SELECT e.enrollment_id, e.cat_type_status, pe.global_code
      FROM public.enrollments e
      JOIN public.customers c ON c.customer_id = e.customer_id
      JOIN public.persons p ON p.person_id = c.person_id
      LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
     WHERE p.document_number = $1
       AND e.parent_enrollment_id IS NULL
       AND COALESCE(pe.global_code, 'E0') = $2
       AND COALESCE(e.notes, '') LIKE '%masiva FICO%'
     ORDER BY e.enrollment_id DESC LIMIT 1`, [o.dni, o.ed])

  if (!rows.length) { console.log(`fila ${o.fila}: ${o.nombre} (${o.ed}) - sin inscripcion importada, se omite`); continue }
  const enr = rows[0]
  if (Number(enr.cat_type_status) !== ACT) {
    console.log(`fila ${o.fila}: enr ${enr.enrollment_id} ya esta en ${enr.cat_type_status}, se omite`)
    continue
  }

  const { rows: hijas } = await q(
    'SELECT enrollment_id, cat_type_status FROM public.enrollments WHERE parent_enrollment_id = $1', [enr.enrollment_id])
  console.log(`fila ${o.fila}: ${o.nombre} (${o.ed}) -> enr ${enr.enrollment_id} ACT -> ${o.estado} | ${hijas.length} hija(s) -> R`)
  backup.push({ enrollment_id: enr.enrollment_id, cat_type_status: enr.cat_type_status, hijas })

  if (!aplicar) continue
  await q('UPDATE public.enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [ESTADO[o.estado], enr.enrollment_id])
  for (const h of hijas) {
    await q('UPDATE public.enrollments SET cat_type_status = $1 WHERE enrollment_id = $2', [HIJA, h.enrollment_id])
  }
}

if (aplicar && backup.length) {
  // Un respaldo por CSV de origen: dos tandas distintas no se pisan.
  const nombre = `_backup_estados_${csv.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '')}.json`
  await writeFile(new URL(`./${nombre}`, import.meta.url), JSON.stringify(backup, null, 2))
  await q('REFRESH MATERIALIZED VIEW public.mv_enrollment_report_system')
  console.log(`\naplicado a ${backup.length} inscripcion(es); respaldo en scripts/_backup_estados_hoja_fico.json; matview refrescada`)
} else {
  console.log(`\n(dry-run: nada escrito; ${backup.length} inscripcion(es) cambiarian. Agrega --aplicar)`)
}

await pool.end()
process.exit(0)
