import { pool } from './db.mjs'
import { IntegrationRepository } from '../src/modules/integration/integration.repository.js'
import { buildConveniosRow, CONVENIOS_HEADER_ROW } from '../src/modules/integration/integration.entity.js'

const rows = await new IntegrationRepository(pool).getFicoConvenios()
const r = rows.find(x => x.correo?.toLowerCase() === 'isabel.raez.c@gmail.com')
console.log('filas de "7. Convenios":', rows.length, '| 18534 presente:', !!r)
if (r) console.table(CONVENIOS_HEADER_ROW.map((h, i) => ({ col: h, valor: buildConveniosRow(r)[i] })))
await pool.end()
