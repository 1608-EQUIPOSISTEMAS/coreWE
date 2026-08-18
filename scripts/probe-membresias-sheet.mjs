// Sondeo de la hoja "5. Membresias": corre getFicoMembresias contra la BD
// apuntada por .env y muestra las primeras filas tal cual iran al Sheet.
//   node scripts/probe-membresias-sheet.mjs
import 'dotenv/config'
import { integrationRepository } from '../src/modules/integration/integration.repository.js'
import { buildMembresiasRow, MEMBRESIAS_HEADER_ROW } from '../src/modules/integration/integration.entity.js'
import { pool } from '../src/shared/db/pool.js'

const rows = await integrationRepository.getFicoMembresias()
console.log(`filas: ${rows.length}`)
console.log(MEMBRESIAS_HEADER_ROW.join(' | '))
for (const r of rows.slice(0, 15)) console.log(buildMembresiasRow(r).join(' | '))

const sinVencimiento = rows.filter(r => !r.vencimiento).length
const sinContacto = rows.filter(r => !r.celular && !r.correo).length
console.log({ sinVencimiento, sinContacto })
await pool.end()
