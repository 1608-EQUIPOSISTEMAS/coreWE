// Sondeo one-off: corre la query real de la hoja "4. Ventas Eventos" contra la
// BD y muestra las filas tal como se escribirian en Sheets.
import 'dotenv/config'
import { IntegrationRepository } from '../src/modules/integration/integration.repository.js'
import { buildEventosRow, EVENTOS_HEADER_ROW } from '../src/modules/integration/integration.entity.js'
import { pool } from './db.mjs'

const repo = new IntegrationRepository(pool)
const rows = await repo.getFicoEventos()
console.log('filas:', rows.length)
console.log(EVENTOS_HEADER_ROW.join(' | '))
for (const r of rows) console.log(buildEventosRow(r).join(' | '))
await pool.end()
