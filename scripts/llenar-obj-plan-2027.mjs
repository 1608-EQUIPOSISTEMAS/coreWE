// Llena las columnas "OBJ" de "1. Plan 2027" (una delante de cada bloque de ventas:
// Apertura Alta, Apertura Normal, Seguimiento Alta, Seguimiento Normal) con la
// "Propuesta Nueva 2027" de "3. Obj Vacantes 26". Pedido de Planeamiento, 15/09/2026.
//
// Reglas:
//  - Un "-" en Obj Vacantes se escribe 0 (asi lo pidieron). Estas columnas son de
//    lectura: las formulas de ventas siguen colgando de "APE Alta".."SEG Normal",
//    donde vacio = no aplica, asi que el 0 no genera ventas.
//  - Un curso que no esta en Obj Vacantes queda VACIO: no hay un "-", no hay dato.
//  - Columnas por encabezado: la hoja ya cambio de forma dos veces el mismo dia.
//   cd Backend && node scripts/llenar-obj-plan-2027.mjs --dry
//   cd Backend && node scripts/llenar-obj-plan-2027.mjs
import assert from 'node:assert/strict'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'
import { nombreDelPrograma } from './lib/clasificacion-ediciones.mjs'

const LIBRO = '1F1yhj280zbnwhoxcR9fJeO5_Aqo0b7kHz3Bix31FbJk'
const PLAN_ID = 947016543
const OBJ_ID = 1495049876
const PRIMERA_FILA = 11
const ULTIMA_FILA = 82
const BLOQUES = 4

export const objetivoParaObj = texto => {
  const limpio = String(texto ?? '').trim()
  if (limpio === '-' || limpio === '') return 0
  const n = Number(limpio.replace(',', '.'))
  assert.ok(Number.isFinite(n), `objetivo no numerico en Obj Vacantes: "${limpio}"`)
  return n
}

{
  assert.equal(objetivoParaObj('-'), 0, 'el guion es 0')
  assert.equal(objetivoParaObj(' - '), 0)
  assert.equal(objetivoParaObj(''), 0, 'celda vacia de un curso que SI esta tambien es 0')
  assert.equal(objetivoParaObj('25'), 25)
}

const letra = i => (i >= 26 ? letra(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))

const sheets = await repo.sheets()
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO })
const titulo = id => meta.sheets.find(s => s.properties.sheetId === id).properties.title
const PLAN = titulo(PLAN_ID)

const leer = async (rango, valueRenderOption = 'FORMATTED_VALUE') =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: LIBRO, range: rango, valueRenderOption })).data.values ?? []

const plan = await leer(`'${PLAN}'!A1:BZ${ULTIMA_FILA}`)
const obj = await leer(`'${titulo(OBJ_ID)}'!A1:BZ`)

const cabecera = plan[PRIMERA_FILA - 2]
const colsObj = cabecera.flatMap((c, i) => String(c).trim() === 'OBJ' ? [i] : [])
assert.equal(colsObj.length, BLOQUES, `esperaba 4 columnas OBJ en la fila 10, hay ${colsObj.length}`)

const filaPropuesta = obj.findIndex(f => (f ?? []).some(c => String(c).trim() === 'Propuesta Nueva 2027'))
const colPropuesta = obj[filaPropuesta].findIndex(c => String(c).trim() === 'Propuesta Nueva 2027')
const fuente = new Map()
obj.forEach((f, i) => {
  const nombre = String(f?.[0] ?? '').trim()
  if (nombre && i > filaPropuesta + 1) fuente.set(nombreDelPrograma(nombre), [0, 1, 2, 3].map(k => f[colPropuesta + k]))
})

const filas = []
const sinFuente = []
for (let fila = PRIMERA_FILA; fila <= ULTIMA_FILA; fila++) {
  const programa = String(plan[fila - 1]?.[0] ?? '').trim()
  const propuesta = fuente.get(nombreDelPrograma(programa))
  if (!propuesta) sinFuente.push(`${fila} ${programa}`)
  filas.push({ fila, programa, valores: propuesta ? propuesta.map(objetivoParaObj) : ['', '', '', ''] })
}
console.log(`OBJ en ${colsObj.map(letra).join(', ')} | ${filas.length} cursos | sin fila en Obj Vacantes: ${sinFuente.join('; ') || 'ninguno'}`)
filas.slice(0, 3).forEach(f => console.log(`  ${f.fila} ${f.programa}: ${f.valores.join('/')}`))
if (process.argv.includes('--dry')) process.exit(0)

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: colsObj.map((col, b) => ({
      range: `'${PLAN}'!${letra(col)}${PRIMERA_FILA}:${letra(col)}${ULTIMA_FILA}`,
      values: filas.map(f => [f.valores[b]])
    }))
  }
})

const despues = await leer(`'${PLAN}'!A1:BZ${ULTIMA_FILA}`, 'UNFORMATTED_VALUE')
for (const { fila, programa, valores } of filas) {
  const escritos = colsObj.map(col => despues[fila - 1]?.[col] ?? '')
  assert.equal(String(despues[fila - 1][0]).trim(), programa, `fila ${fila}: el curso se movio mientras se escribia`)
  assert.deepEqual(escritos, valores, `fila ${fila} ${programa}: OBJ no quedo como Obj Vacantes`)
  // OBJ tiene que cuadrar con los 4 canales a su derecha (Mkt, Com, WEB, Otros).
  colsObj.forEach((col, b) => {
    const suma = [1, 2, 3, 4].reduce((a, k) => a + (Number(despues[fila - 1][col + k]) || 0), 0)
    assert.equal(suma, Number(escritos[b]) || 0, `fila ${fila} ${programa} ${letra(col)}: OBJ ${escritos[b]} y sus canales suman ${suma}`)
  })
}
console.log(`OK: ${filas.length - sinFuente.length} cursos con OBJ igual a Obj Vacantes (- = 0), ${sinFuente.length} vacios`)
