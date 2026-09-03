// Apunta los scripts one-off a producción (túnel SSH 127.0.0.1:55432) leyendo la
// contraseña de .env.bak-produccion. Importar ANTES que ./db.mjs:
//   import './_prod.mjs'; import { q } from './db.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const bak = readFileSync(fileURLToPath(new URL('../.env.bak-produccion', import.meta.url)), 'utf8')
const url = bak.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
if (!url) throw new Error('No hay DATABASE_URL en .env.bak-produccion')
process.env.DATABASE_URL = url
delete process.env.PGPASSWORD // PGPASSWORD gana sobre DATABASE_URL en db.mjs y partiría los pools
