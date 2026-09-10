// Aplica fix-trigger-lead-subsanacion.sql a la BD que apunte .env.
// Produccion solo con el visto bueno del usuario (ver CLAUDE.md).
import { readFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const { rows: [db] } = await q('SELECT current_database() AS n, inet_server_port() AS p')
console.log(`aplicando en ${db.n}:${db.p}`)
await q(readFileSync(new URL('./fix-trigger-lead-subsanacion.sql', import.meta.url), 'utf8'))
console.log('trigger actualizado')
await pool.end()
