// Corre la query de la hoja "7. Convenios" y muestra las filas tal como se
// escribirian en el Sheet. One-off de verificacion.
import { pool } from './db.mjs'
import { IntegrationRepository } from '../src/modules/integration/integration.repository.js'
import { buildConveniosRow, CONVENIOS_HEADER_ROW } from '../src/modules/integration/integration.entity.js'

const rows = await new IntegrationRepository(pool).getFicoConvenios()
console.log('filas:', rows.length)
console.log(CONVENIOS_HEADER_ROW.join(' | '))
for (const r of rows) console.log(buildConveniosRow(r).map(v => v === '' ? '·' : v).join(' | '))
await pool.end()
