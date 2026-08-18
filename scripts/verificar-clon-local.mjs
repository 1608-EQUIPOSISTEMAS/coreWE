// Compara el clon local contra produccion: filas por tabla y rutinas propias.
// Un clon que "restauro sin errores" pero perdio la mitad de los SPs es peor
// que no tenerlo, porque el fallo aparece recien cuando pruebas un flujo.
//
// Uso:  PGPASSWORD_LOCAL=... node scripts/verificar-clon-local.mjs
import 'dotenv/config'
import pg from 'pg'

const prod = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
const local = new pg.Pool({
  host: '127.0.0.1',
  port: Number(process.env.PGPORT_LOCAL || 5433),
  database: process.env.PGDATABASE_LOCAL || 'system_erp_dev',
  user: 'postgres',
  password: process.env.PGPASSWORD_LOCAL,
  max: 2
})

// Las de extensiones (pgvector) no cuentan: se excluyeron a proposito.
const SQL_RUTINAS = `
  SELECT p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
   WHERE n.nspname = 'public' AND d.objid IS NULL`

const SQL_FILAS = `
  SELECT relname AS tabla, n_live_tup AS filas FROM pg_stat_user_tables`

const nombres = async (db) => new Set((await db.query(SQL_RUTINAS)).rows.map(r => r.proname))
const filas = async (db) => {
  await db.query('ANALYZE')
  return new Map((await db.query(SQL_FILAS)).rows.map(r => [r.tabla, Number(r.filas)]))
}

const [rutinasProd, rutinasLocal] = await Promise.all([nombres(prod), nombres(local)])
const faltantes = [...rutinasProd].filter(n => !rutinasLocal.has(n))
console.log(`Rutinas propias: produccion ${rutinasProd.size} · local ${rutinasLocal.size}`)
console.log(faltantes.length ? `⚠ FALTAN: ${faltantes.join(', ')}` : '✓ no falta ninguna')

const [filasProd, filasLocal] = await Promise.all([filas(prod), filas(local)])
// Las bitacoras se excluyeron del volcado a proposito: no son una diferencia.
const BITACORAS = new Set(['audit_logs', 'enrollment_audit_log'])
const desviadas = [...filasProd.entries()]
  .filter(([t, n]) => !BITACORAS.has(t) && n > 0 && (filasLocal.get(t) ?? 0) < n * 0.99)
  .map(([t, n]) => `${t}: prod ${n} vs local ${filasLocal.get(t) ?? 0}`)
console.log(`\nTablas: produccion ${filasProd.size} · local ${filasLocal.size}`)
console.log(desviadas.length ? `⚠ CON MENOS DATOS:\n  ${desviadas.join('\n  ')}` : '✓ ninguna tabla quedo corta')

await Promise.all([prod.end(), local.end()])
