// Sondea el ALCANCE de una pestaña FICO congelada antes de importarla: cuántas
// filas trae, cuáles se caerían en silencio (sin DNI), duplicados, estados de
// alumno que el importador NO cubre (RP/R) y el reparto por edición.
// No toca la BD.
//
// Uso: node Backend/scripts/probe-hoja-fico-scope.mjs scripts/_hoja_xxx.csv
import { readFile } from 'node:fs/promises'
import { loadWorkbook } from '../src/modules/importer/importer.sources.js'
import { cellText, buildHeaderIndex, findCol } from '../src/modules/importer/importer.xlsx.js'

const csv = process.argv[2]
if (!csv) { console.error('Falta la ruta al CSV congelado.'); process.exit(1) }

const wb = await loadWorkbook(await readFile(csv), 'csv')
const ws = wb.worksheets[0]

// La cabecera real es la fila que tiene "DNI" (arriba hay filas de título).
let headerRow = 1
ws.eachRow((row, n) => {
  if (headerRow > 1) return
  for (let c = 1; c <= row.cellCount; c++) {
    if (/^dni$/i.test(cellText(row.getCell(c).value).trim())) headerRow = n
  }
})
const idx = buildHeaderIndex(ws, headerRow)
const col = (...alias) => findCol(idx, alias)
const C = {
  dni: col('dni'),
  nombre: col('nombres y apellidos'),
  correo: col('correo'),
  ed: col('ed'),
  cod: col('cod'),
  estadoAlumno: col('estado alumno'),
  estado: col('estado'),
  member: col('tip_member'),
  obs: col('obs'),
  ingreso: col('ingreso'),
  saldo: col('saldo'),
  fc1: col('fc1')
}

const filas = []
ws.eachRow((row, n) => {
  if (n <= headerRow) return
  const get = (k) => C[k] ? cellText(row.getCell(C[k]).value).trim() : ''
  const f = { n, ...Object.fromEntries(Object.keys(C).map(k => [k, get(k)])) }
  // Fila con nombre o correo = fila real de alumno (aunque le falte el DNI).
  if (f.nombre || f.correo) filas.push(f)
})

const cnt = (k) => filas.reduce((m, f) => (m[f[k] || '(vacio)'] = (m[f[k] || '(vacio)'] || 0) + 1, m), {})
const dup = Object.entries(cnt('dni')).filter(([d, c]) => c > 1 && d !== '(vacio)')

console.log('filas de alumno:', filas.length)
console.log('sin DNI (el importador las descarta en silencio):', filas.filter(f => !f.dni).length)
for (const f of filas.filter(f => !f.dni)) console.log('   fila', f.n, '|', f.nombre, '|', f.correo, '|', f.ed)
console.log('DNI duplicados:', dup.length ? dup : 'ninguno')
for (const [d] of dup) {
  for (const f of filas.filter(x => x.dni === d)) console.log('   fila', f.n, '|', d, '|', f.nombre, '|', f.ed, '|', f.estadoAlumno)
}
console.log('ESTADO ALUMNO:', cnt('estadoAlumno'))
console.log('ESTADO pago:', cnt('estado'))
console.log('COD:', cnt('cod'))
console.log('ED:', cnt('ed'))
console.log('TIP_MEMBER:', cnt('member'))
console.log('con cronograma (FC1):', filas.filter(f => f.fc1).length)
console.log('OBS con texto:', filas.filter(f => f.obs).map(f => `${f.n}: ${f.obs}`))
