// Aplica sp_comercial_enrollment_register.sql a la BD que apunte .env.
// Produccion solo con el visto bueno del usuario (ver CLAUDE.md).
import { readFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const { rows: [db] } = await q('SELECT current_database() AS n, inet_server_port() AS p')
console.log(`aplicando en ${db.n}:${db.p}`)
await q(readFileSync(new URL('./sp_comercial_enrollment_register.sql', import.meta.url), 'utf8'))
console.log('sp_comercial_enrollment_register actualizado')
await pool.end()
