// Check de la columna MEMBRESIA de la hoja "0. Ventas Sistemas".
// Corre la query real (getFicoSales) y muestra las filas de socios: el curso
// comprado con el 60% de beneficio debe salir "WE PLUS-DESC" / "WE GOLD-DESC";
// el mismo socio con cualquier otro descuento sale "WE PLUS" / "WE GOLD".
//
//   node scripts/check-membresia-desc.mjs            # todas las filas con membresia
//   node scripts/check-membresia-desc.mjs correo@x   # filtra por correo
import { pool } from './db.mjs'
import { IntegrationRepository } from '../src/modules/integration/integration.repository.js'

const filtro = (process.argv[2] || '').toLowerCase()

const rows = await new IntegrationRepository(pool).getFicoSales()
const socios = rows
  .filter(r => r.membresia)
  .filter(r => !filtro || (r.correo || '').toLowerCase().includes(filtro))

console.table(socios.map(r => ({
  cod: r.cod, correo: r.correo, dsct: r.dsct, MEMBRESIA: r.membresia
})))

const conDesc = socios.filter(r => r.membresia.endsWith('-DESC'))
console.log(`${socios.length} filas con membresia, ${conDesc.length} con sufijo -DESC`)

// El sufijo solo aplica a cursos: la venta de la membresia misma nunca lo lleva.
const sinDsct60 = conDesc.filter(r => r.dsct !== '60,00%')
if (sinDsct60.length) console.warn('OJO, -DESC con dsct distinto de 60%:', sinDsct60.map(r => r.correo))

await pool.end()
