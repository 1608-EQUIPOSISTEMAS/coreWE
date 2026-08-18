// Clona produccion (Neon, via tunel) a la Postgres local para poder probar sin
// tocar datos reales.
//
// Copia el esquema completo -- tablas, vistas, la matview y los ~260 SPs, que NO
// estan versionados en el repo y solo existen en la BD -- mas los datos, salvo
// las dos bitacoras: audit_logs pesa 276 MB de los 420 y no sirve para probar.
//
// Uso (la contraseña local NO se guarda en el repo):
//   export PGPASSWORD_LOCAL='...'
//   node scripts/clonar-bd-local.mjs
//   node scripts/clonar-bd-local.mjs --con-bitacoras   # si necesitas los logs
//
// Origen: DATABASE_URL de Backend/.env (el tunel tiene que estar abierto).
// Destino: 127.0.0.1:5433/system_erp_dev, que se recrea de cero en cada corrida.
// El 5433 no es un capricho: en este equipo el 5432 lo ocupa el Postgres que
// trae Odoo, y el PostgreSQL 18 quedo en el 5433.
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin'
const DESTINO_DB = process.env.PGDATABASE_LOCAL || 'system_erp_dev'
const PUERTO_LOCAL = process.env.PGPORT_LOCAL || '5433'
const VOLCADO = 'scripts/.produccion.dump'
const ESQUEMA = 'scripts/.produccion.schema.sql'

// Las bitacoras son 2/3 del peso y ningun flujo las lee para funcionar: se
// clona su estructura, no su contenido.
const BITACORAS = ['public.audit_logs', 'public.enrollment_audit_log']

const origen = process.env.DATABASE_URL
if (!origen) throw new Error('Falta DATABASE_URL en Backend/.env (origen del clon)')
if (!process.env.PGPASSWORD_LOCAL) throw new Error('Falta PGPASSWORD_LOCAL (contraseña de la Postgres local)')
if (!existsSync(`${BIN}\\pg_dump.exe`)) throw new Error(`No encuentro pg_dump en ${BIN}`)

const conBitacoras = process.argv.includes('--con-bitacoras')
const entornoLocal = { ...process.env, PGPASSWORD: process.env.PGPASSWORD_LOCAL }

function correr (comando, args, entorno, descripcion) {
  const r = spawnSync(`${BIN}\\${comando}.exe`, args, { env: entorno, stdio: 'inherit' })
  // pg_restore devuelve != 0 por avisos benignos (extensiones, dueños que no
  // existen local). Se reporta pero no se aborta: lo que importa es la
  // verificacion final, no el codigo de salida.
  if (r.status !== 0) console.warn(`⚠ ${descripcion}: salio con codigo ${r.status}`)
  if (r.error) throw r.error
  return r.status
}

const psqlLocal = (sql, db = 'postgres') =>
  correr('psql', ['-h', '127.0.0.1', '-p', PUERTO_LOCAL, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    entornoLocal, `psql ${db}`)

// Volver a volcar 145 MB por el tunel para reintentar la restauracion es tiempo
// tirado: con --usar-volcado se reaprovecha el archivo anterior.
if (process.argv.includes('--usar-volcado') && existsSync(VOLCADO)) {
  console.log(`\n1/5  Reusando el volcado anterior (${VOLCADO})`)
} else {
  console.log(`\n1/5  Volcando produccion${conBitacoras ? '' : ' (sin bitacoras)'}…`)
  correr('pg_dump', [
    origen, '--format=custom', '--no-owner', '--no-privileges',
    ...(conBitacoras ? [] : BITACORAS.flatMap(t => ['--exclude-table-data', t])),
    '--file', VOLCADO
  ], process.env, 'pg_dump')
}

console.log(`\n2/5  Recreando ${DESTINO_DB} en la Postgres local…`)
// Cortar sesiones abiertas: DBeaver o el backend dejan una conexion viva y el
// DROP DATABASE falla con "is being accessed by other users".
psqlLocal(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DESTINO_DB}'`)
psqlLocal(`DROP DATABASE IF EXISTS ${DESTINO_DB}`)
psqlLocal(`CREATE DATABASE ${DESTINO_DB}`)

// Produccion tiene pgvector; la Postgres local de Windows no, y compilarla para
// un clon de pruebas no se paga. La unica columna del tipo es programs.embedding
// (158 valores que NINGUN SP, vista ni endpoint lee), asi que baja a text: el
// dato se conserva y solo se pierden los operadores de similitud.
// Sin esto, programs no se crea y arrastra 62 objetos que dependen de ella.
function degradarPgvector (sql) {
  const limpio = sql
    .split('\n')
    .filter(l => !/^(CREATE EXTENSION[^;]*\bvector\b|COMMENT ON EXTENSION vector)/i.test(l))
    .filter(l => !/^CREATE INDEX .* USING (ivfflat|hnsw)/i.test(l))
    .join('\n')
    .replace(/\b(?:public\.)?vector\(\d+\)/gi, 'text')
  const sobrante = limpio.split('\n').filter(l => /\bvector\b/i.test(l) && !/^\s*--/.test(l))
  if (sobrante.length) throw new Error(`Quedaron referencias a pgvector:\n${sobrante.slice(0, 5).join('\n')}`)
  return limpio
}

console.log('\n3/5  Restaurando esquema (sin pgvector) y datos…')
correr('pg_restore', ['--schema-only', '--no-owner', '--no-privileges', '--file', ESQUEMA, VOLCADO],
  process.env, 'pg_restore --schema-only')
writeFileSync(ESQUEMA, degradarPgvector(readFileSync(ESQUEMA, 'utf8')), 'utf8')
correr('psql', ['-h', '127.0.0.1', '-p', PUERTO_LOCAL, '-U', 'postgres', '-d', DESTINO_DB, '-q', '-f', ESQUEMA],
  entornoLocal, 'psql esquema')

// --disable-triggers: los FK son triggers, y cargar tabla por tabla sin
// respetar el orden de dependencias los violaria.
correr('pg_restore', [
  '-h', '127.0.0.1', '-p', PUERTO_LOCAL, '-U', 'postgres', '-d', DESTINO_DB,
  '--data-only', '--disable-triggers', '--no-owner', '--no-privileges', VOLCADO
], entornoLocal, 'pg_restore --data-only')

// El REFRESH que trae el volcado corre con el esquema, o sea con las tablas
// todavia vacias: sin esto la matview queda en 0 filas y el panel de FICO se ve
// sin datos aunque enrollments este completa.
console.log('\n4/5  Refrescando matviews…')
psqlLocal(`DO $$
  DECLARE v record;
  BEGIN
    FOR v IN SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname = 'public' LOOP
      EXECUTE format('REFRESH MATERIALIZED VIEW %I.%I', v.schemaname, v.matviewname);
    END LOOP;
  END $$;`, DESTINO_DB)

console.log('\n5/5  Verificando…')
psqlLocal(`SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public')  AS tablas,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public')                                                   AS sps,
    (SELECT count(*) FROM public.enrollments)                                     AS inscripciones,
    (SELECT count(*) FROM public."catalog")                                       AS catalogos,
    pg_size_pretty(pg_database_size('${DESTINO_DB}'))                             AS peso`, DESTINO_DB)

console.log(`\nListo. Apunta Backend/.env a:
  DATABASE_URL=postgresql://postgres:<tu-clave-local>@127.0.0.1:${PUERTO_LOCAL}/${DESTINO_DB}
El volcado quedo en ${VOLCADO} (borralo si no lo vas a reusar).`)
