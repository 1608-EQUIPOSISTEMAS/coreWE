// Crea la columna b2b_attendance.notes (justificaciones del Seguimiento B2B)
// en PRODUCCION, por el tunel SSH 127.0.0.1:55432.
//
// El backend la crea solo al primer listado (ensureB2bAttendanceTable), pero
// eso exige el redeploy; aplicarla aqui deja la BD lista de antemano y hace
// que el deploy no dependa de un ALTER en caliente.
//
// Es aditiva e idempotente: ADD COLUMN IF NOT EXISTS con default '{}'. No
// toca ninguna fila existente ni la columna sessions.
//
//   node scripts/aplicar-b2b-notes-produccion.mjs
//
// La contrasena NO se pasa por linea de comandos: se lee del respaldo
// .env.bak-produccion que ya vive en el Backend.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)))

// El tunel se cae seguido: la URL correcta es la del 55432, venga del .env
// activo o del respaldo de produccion.
function readProductionUrl () {
  for (const file of ['.env.bak-produccion', '.env']) {
    const text = readFileSync(join(backendDir, file), 'utf8')
    const match = text.match(/^#?\s*DATABASE_URL=(postgresql:\/\/\S*55432\/\S+)$/m)
    if (match) return match[1]
  }
  throw new Error('No encontre la DATABASE_URL de produccion (tunel 55432) en .env.bak-produccion ni en .env')
}

const client = new pg.Client({ connectionString: readProductionUrl(), connectionTimeoutMillis: 15000 })
await client.connect()

const { rows: [db] } = await client.query('SELECT current_database() AS name')
console.log('Conectado a', db.name)

await client.query(`
  ALTER TABLE public.b2b_attendance
    ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '{}'::jsonb
`)

const { rows } = await client.query(`
  SELECT column_name, data_type, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'b2b_attendance'
   ORDER BY ordinal_position`)
console.table(rows)

const { rows: [conteo] } = await client.query(`
  SELECT COUNT(*)::int AS filas,
         COUNT(*) FILTER (WHERE notes <> '{}'::jsonb)::int AS con_justificacion
    FROM public.b2b_attendance`)
console.log('b2b_attendance:', conteo)

await client.end()
