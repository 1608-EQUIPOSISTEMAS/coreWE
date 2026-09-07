// Conexión de SOLO LECTURA a producción para verificaciones puntuales.
//
// La URL sale de `.env.bak-produccion`, la misma fuente que usa el resto de
// scripts (probe-convenios-hoja.mjs y compañía): no se hardcodea ni se toca
// PGPASSWORD, que gana sobre el .env y partiría los pools de scripts y backend
// en dos BD distintas sin avisar. Requiere el túnel SSH abierto en el 55432.
import fs from 'node:fs'
import pg from 'pg'

const respaldo = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
const url = respaldo.match(/^DATABASE_URL=(postgresql:\/\/\S+)$/m)?.[1]
if (!url) throw new Error('No encontré DATABASE_URL en Backend/.env.bak-produccion')

export const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000, keepAlive: true })
pool.on('error', (e) => console.error('[prod-db] socket idle perdido:', e.message))
export const q = (t, p) => pool.query(t, p)
