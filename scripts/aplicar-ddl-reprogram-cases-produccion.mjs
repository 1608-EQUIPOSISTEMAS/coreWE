// Aplica ddl-reprogram-cases.sql en PRODUCCION (Neon via tunel SSH 127.0.0.1:55432).
//
// Por que existe aparte de aplicar-ddl-reprogram-cases.mjs: .env apunta a la BD
// LOCAL de pruebas y las lineas de produccion viven comentadas ahi mismo. Este
// script las lee de ahi, para no pasar la contraseña por la linea de comandos ni
// dejarla escrita en el repo.
//
// Idempotente: el DDL entero se puede correr las veces que haga falta.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const ddl = readFileSync(join(here, 'ddl-reprogram-cases.sql'), 'utf8')

// La linea de produccion es la unica DATABASE_URL comentada que apunta al tunel.
function urlDeProduccion () {
  const env = readFileSync(join(here, '..', '.env'), 'utf8')
  const linea = env.split(/\r?\n/)
    .map(l => l.trim())
    .find(l => /^#\s*DATABASE_URL=postgresql/.test(l) && l.includes(':55432/'))
  if (!linea) throw new Error('No encontre la DATABASE_URL de produccion comentada en .env')
  return linea.replace(/^#\s*DATABASE_URL=/, '')
}

const pool = new pg.Pool({
  connectionString: urlDeProduccion(),
  max: 1,
  connectionTimeoutMillis: 10000,
  keepAlive: true
})
pool.on('error', err => console.error('[ddl-prod] socket idle perdido:', err.message))

// Todo el DDL en UNA conexion: el tunel se cae seguido y a medias seria peor.
async function aplicar () {
  const cx = await pool.connect()
  try {
    const { rows: [donde] } = await cx.query(
      'SELECT current_database() AS db, inet_server_port() AS puerto')
    await cx.query(ddl)
    const { rows: [estado] } = await cx.query(`
      SELECT (SELECT COUNT(*)::int FROM public.reprogram_cases) AS casos,
             (SELECT pg_get_constraintdef(oid) FROM pg_constraint
               WHERE conname = 'reprogram_cases_kind_chk')   AS check_kind,
             (SELECT pg_get_constraintdef(oid) FROM pg_constraint
               WHERE conname = 'reprogram_cases_source_chk') AS check_source,
             EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'reprogram_cases'
                        AND column_name = 'proposed_source')  AS tiene_proposed_source`)
    return { ...donde, ...estado }
  } finally {
    cx.release()
  }
}

let resultado
try {
  resultado = await aplicar()
} catch (err) {
  console.warn('1er intento fallo (tunel?):', err.message, '- reintentando')
  resultado = await aplicar()
}
console.log(resultado)
await pool.end()
