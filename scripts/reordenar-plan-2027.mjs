// Reordena los cursos de "1. Plan 2027" (A11:AZ82) al orden que pidio Planeamiento
// (15/09/2026), sin perder ni desalinear un solo dato.
//
// Por que moveDimension y no reescribir valores ni sortRange: mover filas es lo
// mismo que arrastrarlas a mano. Viajan formulas, formato y notas, y Sheets
// reescribe las referencias a la propia fila ($AK57 -> $AK12) dejando fijas las
// de los supuestos ($K$3). Todo va en un solo batchUpdate: si se corta, no queda
// una hoja a medio ordenar.
//
// Verificacion: se fotografia cada fila por PROGRAMA antes (valor mostrado +
// formula con su numero de fila normalizado) y se exige que despues sea identica.
//   cd Backend && node scripts/reordenar-plan-2027.mjs --dry   # valida nombres, no mueve
//   cd Backend && node scripts/reordenar-plan-2027.mjs         # aplica y verifica
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'

const LIBRO = '1F1yhj280zbnwhoxcR9fJeO5_Aqo0b7kHz3Bix31FbJk'
const SHEET_ID = 947016543 // el titulo lleva espacio final ("1. Plan 2027 ")
const PRIMERA_FILA = 11
const ULTIMA_FILA = 82
const RESPALDO = 'scripts/plan2027-antes-de-reordenar.json'

const ORDEN = `DIP INTELIG. Y ANALIST. DATOS
ESP. POWER APPS Y AUT.
SAP HANA IN
DIP SUPPLY
PEE ANALIST DATOS
ESP. POWER BI
SAP HANA MM
ESPEC. EXCEL
DIP PROC Y MEJORA
ESP. EXCEL EXP
POWER BI
ESP. EN PYTHON DATA SCIENCE
POWER APPS Y AUT.
SAP HANA FI
ESP. SQL SERVER
CLAUDE IA
N8N:AGENTES IA
DIP GEST PROYECTOS
POWER APPS Y AUT. PRESENCIAL
POWER BI PRESENCIAL
SQL SERVER
SAP HANA PM
SAP HANA IN PRESENCIAL
DIP. FINANZAS
PRICING & R. M.
EXCEL INTERM
KPIS LOGÍSTICOS POWER BI
PLAN. Y PRONOSTICO
PYTHON. DATOS
PEE PLAN. DEMAN.
MS PROJECT
SAP HANA HCM
ESPEC. SAP LOG. INTEGRAL
EXCEL AVANZ
PLAN. FINANCIERO
DATABRICKS
EXCEL BÁSICO
KPIS Y OKRS
PEE ANALIST PROC
DATA ANALYTICS
SAP HANA EWM
ESP. MACROS
GEST PROCESOS
GEST. COMP. Y PROV.
PROG. MACROS
SAP HANA PP
MODEL BIZ.
ESP. EN MS PROJECT
POWER APPS AVANZ
SAP HANA SD
ESP. SAP MINERÍA
ESP. FINANZAS
ESP. GEST. PROYECTOS
LEAN SIX SIGMA YELLOW
POWER BI AVANZ
COST Y PRESUP
GEST PROYECT
GER. CENTRO DISTRIB.
GEST TRANSPORTES
GEST FINANC. PROYECT
PEE ANALIST PROY
PYTHON AVANZ.
SQL AVANZ
AZURE
ESPEC.SAP HANA
PMO
CONT. FINANCIERA
GEST. ÁGIL PROYECT
LEAN LOGISTICS
ESPEC.SAP HANA COMP. Y ALM.
GROWTH HACKING
MS PROJECT AVANZADO`.split('\n').map(n => n.trim())

// La formula de la fila 57 dice $AK57; movida a la 12 dira $AK12. Es la misma.
const sinNumeroDeFila = (formula, fila) =>
  String(formula).replace(new RegExp(`(?<=[A-Z])${fila}(?!\\d)`, 'g'), '#')

// Plan de movimientos: cada paso sube a su lugar el curso que corresponde.
// Las filas de arriba ya estan en orden, asi que el origen siempre queda debajo
// del destino y destinationIndex = destino (indices previos a la extraccion).
export function planDeMovimientos (actual, objetivo) {
  const filas = [...actual]
  const pasos = []
  objetivo.forEach((programa, destino) => {
    const origen = filas.indexOf(programa)
    if (origen === destino) return
    pasos.push({ origen, destino })
    filas.splice(destino, 0, ...filas.splice(origen, 1))
  })
  assert.deepEqual(filas, objetivo)
  return pasos
}

{
  assert.deepEqual(planDeMovimientos(['A', 'B', 'C'], ['A', 'B', 'C']), [], 'ya ordenado, no mueve')
  assert.deepEqual(planDeMovimientos(['C', 'A', 'B'], ['A', 'B', 'C']), [{ origen: 1, destino: 0 }, { origen: 2, destino: 1 }])
  assert.equal(sinNumeroDeFila('=IF($AK57="";"";ROUND($AK57*$K$3;0))', 57), '=IF($AK#="";"";ROUND($AK#*$K$3;0))', 'el supuesto $K$3 no se toca')
  assert.equal(sinNumeroDeFila('=H570', 57), '=H570', 'no confunde la fila 570')
}

const sheets = await repo.sheets()
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO })
const HOJA = meta.sheets.find(s => s.properties.sheetId === SHEET_ID).properties.title
const RANGO = `'${HOJA}'!A1:AZ${ULTIMA_FILA + 2}`

async function fotografiar () {
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: LIBRO, ranges: [RANGO], valueRenderOption: 'FORMULA'
  })
  const { data: vistos } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: LIBRO, ranges: [RANGO], valueRenderOption: 'FORMATTED_VALUE'
  })
  const formulas = data.valueRanges[0].values
  const valores = vistos.valueRanges[0].values
  const cursos = new Map()
  for (let fila = PRIMERA_FILA; fila <= ULTIMA_FILA; fila++) {
    const f = formulas[fila - 1] ?? []
    cursos.set(String(f[0]).trim(), {
      fila,
      formulas: f.map(c => sinNumeroDeFila(c, fila)),
      valores: valores[fila - 1] ?? []
    })
  }
  const fuera = [...formulas.slice(0, PRIMERA_FILA - 1), ...formulas.slice(ULTIMA_FILA)]
  return { cursos, fuera }
}

const antes = await fotografiar()
const actual = [...antes.cursos.keys()]

const faltan = ORDEN.filter(n => !antes.cursos.has(n))
const sobran = actual.filter(n => !ORDEN.includes(n))
assert.equal(new Set(ORDEN).size, ORDEN.length, 'la lista trae un curso repetido')
assert.deepEqual({ faltan, sobran }, { faltan: [], sobran: [] }, 'la lista no calza con la hoja')
assert.equal(ORDEN.length, ULTIMA_FILA - PRIMERA_FILA + 1)

const pasos = planDeMovimientos(actual, ORDEN)
console.log(`${ORDEN.length} cursos, ${pasos.length} movimientos`)
if (process.argv.includes('--dry')) process.exit(0)

fs.writeFileSync(RESPALDO, JSON.stringify({ hoja: HOJA, antes: [...antes.cursos], fuera: antes.fuera }, null, 1))

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: {
    requests: pasos.map(({ origen, destino }) => ({
      moveDimension: {
        source: {
          sheetId: SHEET_ID,
          dimension: 'ROWS',
          startIndex: PRIMERA_FILA - 1 + origen,
          endIndex: PRIMERA_FILA + origen
        },
        destinationIndex: PRIMERA_FILA - 1 + destino
      }
    }))
  }
})

const despues = await fotografiar()
assert.deepEqual([...despues.cursos.keys()], ORDEN, 'el orden final no es el pedido')
assert.deepEqual(despues.fuera, antes.fuera, 'cambio algo fuera de la tabla (encabezados o supuestos)')
for (const [programa, previo] of antes.cursos) {
  const { formulas, valores } = despues.cursos.get(programa)
  assert.deepEqual(formulas, previo.formulas, `${programa}: cambiaron sus formulas`)
  assert.deepEqual(valores, previo.valores, `${programa}: cambiaron sus valores`)
}
console.log(`OK: ${ORDEN.length} cursos en el orden pedido, cada fila con sus mismos valores y formulas`)
