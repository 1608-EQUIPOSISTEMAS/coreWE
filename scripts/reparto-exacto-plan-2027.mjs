// Ventas por canal de "1. Plan 2027" (H11:W82) que SUMAN EXACTO el objetivo por
// edicion (AK:AN). Pedido de Planeamiento, 15/09/2026.
//
// Por que: cada canal se redondeaba solo (REDONDEAR(base * %canal)) y los errores
// se acumulaban. Encima los % medidos no suman 100: Mes Alto 100.1%, Mes Normal
// 96.8%. DIP INTELIG. con objetivo 38 daba 23+5+3+8 = 39, y con 20 daba 19.
//
// Regla: metodo del mayor resto (Hamilton). Los % se normalizan a 100, cada canal
// recibe la parte entera de su cuota y las unidades que faltan van a los restos
// mas grandes (empate: el canal de mas a la izquierda). Suma exacta y ningun canal
// se aleja mas de 1 de su cuota ideal.
//   cd Backend && node scripts/reparto-exacto-plan-2027.mjs --dry   # no escribe
//   cd Backend && node scripts/reparto-exacto-plan-2027.mjs
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'

const LIBRO = '1F1yhj280zbnwhoxcR9fJeO5_Aqo0b7kHz3Bix31FbJk'
const SHEET_ID = 947016543 // el titulo lleva espacio final
const PRIMERA_FILA = 11
const ULTIMA_FILA = 82
const RESPALDO = 'scripts/plan2027-ventas-antes-de-reparto.json'

// Bloques de 4 canales (Mkt, Com, WEB, Otros): columna del objetivo y columna de %.
const BLOQUES = [
  { base: 'AK', pct: 'K' }, // Apertura, mes alto   -> H:K
  { base: 'AL', pct: 'L' }, // Apertura, mes normal -> L:O
  { base: 'AM', pct: 'K' }, // Seguimiento, alto    -> P:S
  { base: 'AN', pct: 'L' } //  Seguimiento, normal  -> T:W
]

export function repartoMayorResto (objetivo, porcentajes) {
  const total = porcentajes.reduce((a, b) => a + b, 0)
  const cuotas = porcentajes.map(p => objetivo * p / total)
  // 1e-9: una cuota entera puede llegar como 4.9999999999 en coma flotante y
  // perderia su unidad; la formula de la hoja usa el mismo margen.
  const enteros = cuotas.map(c => Math.floor(c + 1e-9))
  const faltan = objetivo - enteros.reduce((a, b) => a + b, 0)
  const porResto = cuotas.map((c, i) => i).sort((a, b) => (cuotas[b] - enteros[b]) - (cuotas[a] - enteros[a]) || a - b)
  porResto.slice(0, faltan).forEach(i => enteros[i]++)
  return enteros
}

// Misma regla en formula de Sheets (API en ingles con ';', como el resto de la hoja).
// ARRAYFORMULA es obligatorio: sin el, b*$K$3:$K$6 toma solo la celda de la misma
// fila y toda la hoja da #VALUE!.
const formulaDelCanal = ({ base, pct }, fila, canal) =>
  `=ARRAYFORMULA(IF($${base}${fila}="";"";LET(b;$${base}${fila};q;b*$${pct}$3:$${pct}$6/SUM($${pct}$3:$${pct}$6);` +
  `f;INT(q+1E-9);r;q-f;ri;INDEX(r;${canal});` +
  `lugar;1+SUMPRODUCT((r>ri)+(r=ri)*(SEQUENCE(4)<${canal}));` +
  `INDEX(f;${canal})+(lugar<=b-SUM(f)))))`

{
  const alto = [0.594, 0.12, 0.068, 0.219]
  const normal = [0.541, 0.113, 0.105, 0.209]
  assert.deepEqual(repartoMayorResto(38, alto), [22, 5, 3, 8], 'DIP INTELIG. apertura alta suma 38')
  assert.deepEqual(repartoMayorResto(20, normal), [11, 3, 2, 4], 'DIP INTELIG. apertura normal suma 20')
  for (let b = 1; b <= 60; b++) {
    for (const pcts of [alto, normal]) {
      const r = repartoMayorResto(b, pcts)
      assert.equal(r.reduce((a, c) => a + c, 0), b, `suma exacta con ${b}`)
    }
  }
}

const sheets = await repo.sheets()
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO })
const HOJA = meta.sheets.find(s => s.properties.sheetId === SHEET_ID).properties.title
const rango = r => `'${HOJA}'!${r}`

const leer = async (r, valueRenderOption = 'UNFORMATTED_VALUE') =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: LIBRO, range: rango(r), valueRenderOption })).data.values ?? []

// Las letras de arriba son las del 15/09/2026 ANTES de que insertaran Vacantes e
// Ingresos en B:C (hoy ventas J:Y, objetivo AM:AP). Las formulas ya escritas se
// corrieron solas; este script, no. Si la hoja no calza, se aborta antes de escribir.
const [cabecera] = await leer(`A${PRIMERA_FILA - 1}:AZ${PRIMERA_FILA - 1}`, 'FORMATTED_VALUE')
assert.equal(cabecera[7], 'Mkt', 'la hoja cambio de forma: H10 ya no es Mkt, ajustar columnas')
assert.equal(cabecera[36], 'APE Alta', 'la hoja cambio de forma: AK10 ya no es APE Alta, ajustar columnas')

const VENTAS = `H${PRIMERA_FILA}:W${ULTIMA_FILA}`
const supuestos = await leer('K3:L6')
const PCT = { K: supuestos.map(f => Number(f[0])), L: supuestos.map(f => Number(f[1])) }
const bases = await leer(`AK${PRIMERA_FILA}:AN${ULTIMA_FILA}`)

const formulas = []
for (let fila = PRIMERA_FILA; fila <= ULTIMA_FILA; fila++) {
  formulas.push(BLOQUES.flatMap(b => [1, 2, 3, 4].map(canal => formulaDelCanal(b, fila, canal))))
}
console.log('ejemplo H11:', formulas[0][0])
if (process.argv.includes('--dry')) process.exit(0)

// Solo la primera corrida respalda: una segunda pisaria el original con lo ya escrito.
if (!fs.existsSync(RESPALDO)) fs.writeFileSync(RESPALDO,JSON.stringify({ hoja: HOJA, rango: VENTAS, formulas: await leer(VENTAS, 'FORMULA') }, null, 1))
await sheets.spreadsheets.values.update({
  spreadsheetId: LIBRO, range: rango(VENTAS), valueInputOption: 'USER_ENTERED', requestBody: { values: formulas }
})

const ventas = await leer(VENTAS)
let bloquesConObjetivo = 0
for (let i = 0; i <= ULTIMA_FILA - PRIMERA_FILA; i++) {
  BLOQUES.forEach((b, k) => {
    const objetivo = bases[i]?.[k]
    const celdas = (ventas[i] ?? []).slice(k * 4, k * 4 + 4)
    const fila = PRIMERA_FILA + i
    if (objetivo === undefined || objetivo === '') {
      assert.ok(celdas.every(c => c === '' || c === undefined), `fila ${fila} ${b.base}: sin objetivo debe quedar vacia`)
      return
    }
    bloquesConObjetivo++
    assert.deepEqual(celdas, repartoMayorResto(Number(objetivo), PCT[b.pct]), `fila ${fila} ${b.base}: la hoja no calza con la regla`)
  })
}
console.log(`OK: ${bloquesConObjetivo} bloques suman exacto su objetivo`)
