// Conexión reutilizable a la BD de producción (Neon) para scripts de prueba/one-off.
//
// Túnel SSH: 127.0.0.1:55432 (el 5432 directo está bloqueado desde 2026-07-24).
// La contraseña NO se hardcodea. Dos formas, en este orden:
//   1. Backend/.env: si DATABASE_URL ya apunta al túnel, no hay que hacer nada
//      (correr el script desde Backend/, que es donde dotenv busca el .env).
//   2. PGPASSWORD en el entorno, que gana sobre el .env:
//      export PGPASSWORD='...'; node scripts/mi-prueba.mjs
//
// Uso:
//   import { q, pool } from './db.mjs'
//   const { rows } = await q('SELECT * FROM enrollments WHERE enrollment_id=$1', [13057])
//   console.log(rows); await pool.end()
import 'dotenv/config'
import pg from 'pg'

const comun = { max: 4, connectionTimeoutMillis: 10000, keepAlive: true }

export const pool = new pg.Pool(
  !process.env.PGPASSWORD && process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ...comun }
    : {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 55432),
        database: process.env.PGDATABASE || 'neondb',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD,
        ...comun
      }
)

// El túnel se cae seguido: no tumbar el proceso por un socket idle muerto.
pool.on('error', (err) => console.error('[scripts/db] socket idle perdido:', err.message))

export const q = (text, params) => pool.query(text, params)
