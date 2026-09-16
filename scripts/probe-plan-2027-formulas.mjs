// Sondeo previo a reordenar las filas de "1. Plan 2027": que formulas tiene la
// tabla A11:AN82 y que otras pestanas la referencian. Decide si basta un sort
// (solo sirve si ninguna formula apunta a OTRA fila) o hay que mover filas.
//   cd Backend && node scripts/probe-plan-2027-formulas.mjs
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'

const LIBRO = '1F1yhj280zbnwhoxcR9fJeO5_Aqo0b7kHz3Bix31FbJk'
// El titulo real lleva un espacio final ("1. Plan 2027 "): se busca por sheetId.
const SHEET_ID = 947016543

const sheets = await repo.sheets()
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO })
for (const s of meta.sheets) {
  console.log(`${s.properties.sheetId}\t${s.properties.title}\t${s.properties.gridProperties.rowCount}x${s.properties.gridProperties.columnCount}`)
}
const HOJA = meta.sheets.find(s => s.properties.sheetId === SHEET_ID).properties.title

const { data } = await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: `'${HOJA}'!A1:BZ84`, valueRenderOption: 'FORMULA'
})
data.values.forEach((fila, i) => console.log(`${i + 1}\t${fila.join(' | ')}`))

console.log('\n== otras pestanas que referencian la hoja')
const otras = meta.sheets.map(s => s.properties.title).filter(t => t !== HOJA)
const { data: todo } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO, ranges: otras.map(t => `'${t}'`), valueRenderOption: 'FORMULA'
})
todo.valueRanges.forEach((vr, k) => {
  const hits = (vr.values ?? []).flat().filter(c => String(c).includes('Plan 2027'))
  if (hits.length) console.log(`${otras[k]}: ${hits.length} -> ${hits.slice(0, 3).join(' || ')}`)
})
