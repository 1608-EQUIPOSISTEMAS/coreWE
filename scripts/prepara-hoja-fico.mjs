// Prepara un CSV congelado de la hoja FICO para importarlo: recorta filas,
// excluye casos que no deben entrar y rellena los DNI faltantes con un
// documento provisional (el importador descarta EN SILENCIO toda fila sin DNI).
// No toca la BD. La salida es otro CSV, listo para import-hoja-fico.mjs.
//
// Uso:
//   node Backend/scripts/prepara-hoja-fico.mjs <in.csv> <out.csv> [opciones]
//     --filas=346,347        solo esas filas de la hoja (numero de fila del CSV)
//     --excluir-correo=a@b   descarta esas filas (repetible, separadas por coma)
//     --dni-falso=99         rellena DNI vacios con <prefijo> + correlativo a 8 digitos
import { readFile, writeFile } from 'node:fs/promises'
import { loadWorkbook } from '../src/modules/importer/importer.sources.js'
import { cellText, buildHeaderIndex, findCol } from '../src/modules/importer/importer.xlsx.js'

const [inPath, outPath, ...flags] = process.argv.slice(2)
if (!inPath || !outPath) { console.error('Uso: prepara-hoja-fico.mjs <in.csv> <out.csv> [--filas=] [--excluir-correo=] [--dni-falso=]'); process.exit(1) }
const flag = (name) => (flags.find(f => f.startsWith(`--${name}=`)) || '').split('=')[1] || ''
const soloFilas = flag('filas') ? new Set(flag('filas').split(',').map(Number)) : null
const excluir = new Set(flag('excluir-correo').split(',').filter(Boolean).map(s => s.trim().toLowerCase()))
const prefijoDni = flag('dni-falso')

const wb = await loadWorkbook(await readFile(inPath), 'csv')
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
const cCorreo = findCol(idx, ['correo'])
const cNombre = findCol(idx, ['nombres y apellidos'])

// Se recorre de abajo hacia arriba: borrar filas desplaza las de abajo.
const total = ws.rowCount
const borrar = []
let correlativo = 0
const asignados = []
for (let n = headerRow + 1; n <= total; n++) {
  const row = ws.getRow(n)
  const nombre = cNombre ? cellText(row.getCell(cNombre).value).trim() : ''
  const correo = cCorreo ? cellText(row.getCell(cCorreo).value).trim() : ''
  if (!nombre && !correo) { borrar.push(n); continue } // fila de relleno
  if (soloFilas && !soloFilas.has(n)) { borrar.push(n); continue }
  if (excluir.has(correo.toLowerCase())) {
    console.log(`excluida fila ${n}: ${nombre} <${correo}>`)
    borrar.push(n); continue
  }
  const dni = cDni ? cellText(row.getCell(cDni).value).trim() : ''
  if (!dni && prefijoDni) {
    const falso = prefijoDni + String(++correlativo).padStart(8 - prefijoDni.length, '0')
    row.getCell(cDni).value = falso
    asignados.push(`fila ${n}: ${falso} <- ${nombre} <${correo}>`)
  }
}
for (const n of borrar.reverse()) ws.spliceRows(n, 1)

if (asignados.length) {
  console.log(`DNI provisionales asignados (${asignados.length}):`)
  for (const a of asignados) console.log('  ', a)
}
await writeFile(outPath, Buffer.from(await wb.csv.writeBuffer()))
console.log(`filas de datos en la salida: ${ws.rowCount - headerRow} -> ${outPath}`)
