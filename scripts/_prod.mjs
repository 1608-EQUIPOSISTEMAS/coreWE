// Conexión de solo-lectura/one-off a PRODUCCIÓN por el túnel SSH (127.0.0.1:55432).
//
// La contraseña no se pasa por línea de comandos ni se exporta al entorno del shell:
// se lee del respaldo Backend/.env.bak-produccion, que es donde ya vive.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const respaldo = fs.readFileSync(path.join(raiz, '.env.bak-produccion'), 'utf8')
const connectionString = respaldo.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
if (!connectionString) throw new Error('No encontré DATABASE_URL en .env.bak-produccion')

export const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000, keepAlive: true })
pool.on('error', (err) => console.error('[scripts/_prod] socket idle perdido:', err.message))
export const q = (text, params) => pool.query(text, params)
