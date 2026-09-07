// Corre las 4 hojas FICO con dinero y reporta filas + total de INGRESO e INICIAL.
// Sirve para comparar antes/despues de tocar los filtros o las columnas de plata.
import 'dotenv/config'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'

const num = (s) => Number(String(s ?? '0').replace(',', '.')) || 0
const suma = (rows, col) => rows.reduce((a, r) => a + num(r[col]), 0).toFixed(2)

for (const [hoja, metodo] of [
  ['0. Ventas Sistemas', 'getFicoSales'],
  ['1. Aula Sistemas', 'getFicoAula'],
  ['2. Consolidado', 'getFicoConsolidado'],
  ['4. Ventas Eventos', 'getFicoEventos']
]) {
  const rows = await repo[metodo]()
  const cols = Object.keys(rows[0] || {})
  console.log(
    hoja.padEnd(20), String(rows.length).padStart(5), 'filas',
    cols.includes('ingreso') ? ` | INGRESO S/${suma(rows, 'ingreso')}` : '',
    cols.includes('inicial') ? ` | INICIAL S/${suma(rows, 'inicial')}` : ''
  )
}
process.exit(0)
