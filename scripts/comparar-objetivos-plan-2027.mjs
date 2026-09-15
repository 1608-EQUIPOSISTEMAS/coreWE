// Cruza el objetivo por edicion de "1. Plan 2027" contra la fuente, la "Propuesta
// Nueva 2027" de "3. Obj Vacantes 26", curso por curso, y verifica que las ventas
// por canal sumen exacto ese objetivo. El Plan copio valores fijos y Planeamiento
// sigue editando Obj Vacantes: aqui se ve (y con --aplicar se corrige) la deriva.
//
// Las columnas se ubican por ENCABEZADO, no por letra: el 15/09/2026 insertaron
// Vacantes e Ingresos en B:C y todo se corrio dos columnas.
//
// Un curso que no esta en Obj Vacantes conserva su objetivo (la mediana de su CAT):
// no hay fuente de la cual copiar.
//   cd Backend && node scripts/comparar-objetivos-plan-2027.mjs            # solo reporta
//   cd Backend && node scripts/comparar-objetivos-plan-2027.mjs --aplicar  # copia y verifica
import assert from 'node:assert/strict'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'
import { nombreDelPrograma } from './lib/clasificacion-ediciones.mjs'

const LIBRO = '1F1yhj280zbnwhoxcR9fJeO5_Aqo0b7kHz3Bix31FbJk'
const PLAN_ID = 947016543
const OBJ_ID = 1495049876
const PRIMERA_FILA = 11
const ULTIMA_FILA = 82
const BLOQUES = 4 // APE Alta, APE Normal, SEG Alta, SEG Normal; 4 canales cada uno

const sheets = await repo.sheets()
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO })
const titulo = id => meta.sheets.find(s => s.properties.sheetId === id).properties.title
const PLAN = titulo(PLAN_ID)

const leer = async (rango, valueRenderOption) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: LIBRO, range: rango, valueRenderOption })).data.values ?? []

const columnaDe = (fila, texto) => {
  const i = (fila ?? []).findIndex(c => String(c).trim() === texto)
  if (i < 0) throw new Error(`no encuentro el encabezado "${texto}"`)
  return i
}
const letra = i => (i >= 26 ? letra(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))
// En ambas hojas un guion es "no corre en esa modalidad"; en el Plan eso es celda
// vacia, porque las formulas de ventas preguntan por ="".
const norma = v => (v === undefined || String(v).trim() === '' || String(v).trim() === '-') ? '' : String(v).trim()
const ver = celdas => celdas.map(v => v || '-').join('/')

const plan = await leer(`'${PLAN}'!A1:BZ${ULTIMA_FILA}`, 'FORMATTED_VALUE')
const obj = await leer(`'${titulo(OBJ_ID)}'!A1:BZ`, 'FORMATTED_VALUE')

// Plan: fila 10. El primer "APE Alta" abre el objetivo; el primer "Mkt", las ventas.
const cabPlan = plan[PRIMERA_FILA - 2]
const colObjetivo = columnaDe(cabPlan, 'APE Alta')
const colVentas = columnaDe(cabPlan, 'Mkt')
const colCat = columnaDe(cabPlan, 'CAT')
const filaPropuesta = obj.findIndex(f => (f ?? []).some(c => String(c).trim() === 'Propuesta Nueva 2027'))
const colPropuesta = columnaDe(obj[filaPropuesta], 'Propuesta Nueva 2027')
console.log(`Plan: ventas ${letra(colVentas)}, objetivo ${letra(colObjetivo)}:${letra(colObjetivo + 3)} | Obj Vacantes: ${letra(colPropuesta)}${filaPropuesta + 1}\n`)

const fuente = new Map()
obj.forEach((f, i) => {
  const nombre = String(f?.[0] ?? '').trim()
  if (!nombre || i <= filaPropuesta + 1) return
  const clave = nombreDelPrograma(nombre)
  if (fuente.has(clave)) console.log(`!! repetido en Obj Vacantes: "${nombre}" f${i + 1} y f${fuente.get(clave).fila}`)
  fuente.set(clave, { fila: i + 1, nombre, celdas: [0, 1, 2, 3].map(k => norma(f[colPropuesta + k])) })
})

const aCorregir = []
const vistos = new Set()
for (let fila = PRIMERA_FILA; fila <= ULTIMA_FILA; fila++) {
  const f = plan[fila - 1] ?? []
  const programa = String(f[0]).trim()
  const actual = [0, 1, 2, 3].map(k => norma(f[colObjetivo + k]))
  const programacion = [1, 2, 3, 4].map(k => norma(f[colCat + k]))
  const origen = fuente.get(nombreDelPrograma(programa))
  if (origen) vistos.add(nombreDelPrograma(programa))
  const estado = !origen ? 'SIN' : ver(origen.celdas) === ver(actual) ? 'ok ' : 'DIF'
  if (estado === 'DIF') aCorregir.push({ fila, programa, celdas: origen.celdas })
  console.log([
    estado,
    String(fila).padEnd(3),
    programa.padEnd(30),
    `prog=${ver(programacion)}`.padEnd(18),
    `plan=${ver(actual)}`.padEnd(18),
    `obj=${origen ? ver(origen.celdas) : '(no esta)'}`.padEnd(18),
    origen ? `[${origen.nombre} f${origen.fila}]` : ''
  ].join(' '))
}
console.log(`\n${aCorregir.length} cursos con objetivo desactualizado: filas ${aCorregir.map(c => c.fila).join(', ')}`)
console.log('En Obj Vacantes con objetivo y sin fila en el Plan:')
for (const [clave, o] of fuente) {
  if (!vistos.has(clave) && o.celdas.some(c => c && c !== '0')) console.log(`  f${o.fila} ${o.nombre} ${ver(o.celdas)}`)
}

if (process.argv.includes('--aplicar') && aCorregir.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: LIBRO,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: aCorregir.map(({ fila, celdas }) => ({
        range: `'${PLAN}'!${letra(colObjetivo)}${fila}:${letra(colObjetivo + 3)}${fila}`,
        values: [celdas]
      }))
    }
  })
  console.log(`\nCopiados ${aCorregir.length} objetivos desde Obj Vacantes`)
}

// La suma de los 4 canales de cada bloque tiene que ser el objetivo, en TODOS los cursos.
const valores = await leer(`'${PLAN}'!A1:BZ${ULTIMA_FILA}`, 'UNFORMATTED_VALUE')
const sumas = []
for (let fila = PRIMERA_FILA; fila <= ULTIMA_FILA; fila++) {
  const f = valores[fila - 1] ?? []
  for (let b = 0; b < BLOQUES; b++) {
    const objetivo = norma(f[colObjetivo + b])
    const canales = [0, 1, 2, 3].map(k => f[colVentas + b * 4 + k])
    const suma = canales.reduce((a, c) => a + (Number(c) || 0), 0)
    if (objetivo === '') {
      assert.ok(canales.every(c => norma(c) === ''), `fila ${fila} bloque ${b + 1}: sin objetivo pero con ventas ${canales}`)
    } else {
      assert.equal(suma, Number(objetivo), `fila ${fila} ${f[0]} bloque ${b + 1}: canales ${canales} suman ${suma}, objetivo ${objetivo}`)
      sumas.push(fila)
    }
  }
}
if (process.argv.includes('--aplicar')) {
  const pendientes = aCorregir.filter(({ fila, celdas }) =>
    ver([0, 1, 2, 3].map(k => norma(valores[fila - 1][colObjetivo + k]))) !== ver(celdas))
  assert.deepEqual(pendientes, [], 'quedaron objetivos sin copiar')
}
console.log(`\nOK sumas: ${sumas.length} bloques de ${ULTIMA_FILA - PRIMERA_FILA + 1} cursos suman exacto su objetivo`)
