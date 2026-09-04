// One-off: correr la query real de la hoja "4. Ventas Eventos" contra
// PRODUCCION (solo lectura) y ver que ventas suben.
// Uso: node scripts/diag-hoja-eventos.mjs [COD a resaltar]
import fs from 'node:fs'
import pg from 'pg'
import { integrationRepository } from '../src/modules/integration/integration.repository.js'

const URL_PRODUCCION = fs.readFileSync('.env', 'utf8')
  .split('\n')
  .map((linea) => linea.match(/postgresql:\/\/[^\s'"]*55432\/neondb/)?.[0])
  .find(Boolean)

const pool = new pg.Pool({ connectionString: URL_PRODUCCION, max: 2, connectionTimeoutMillis: 15000 })
integrationRepository.db = pool

const filas = await integrationRepository.getFicoEventos()
console.table(filas.map((f) => ({
  F_PAGO: f.f_pago, DNI: f.dni, ALUMNO: `${f.nombres} ${f.apellidos}`,
  COD: f.cod, ENTRADA: f.modalidad, TOTAL: f.ingreso, SALDO: f.saldo, STATUS: f.status_deuda
})))
console.log(`${filas.length} filas`)

await pool.end()
