// Genera el SQL que hace que `leads.company_id` (la empresa del convenio) se
// guarde. Hoy el dato viaja desde el formulario pero se pierde: AJV lo borraba
// (ya corregido en comercial.schemas.js) y los SPs nunca lo escribieron, asi
// que los 32.433 leads tienen company_id NULL.
//
// El fuente de los procedures se lee de la BD viva, NO del volcado
// scripts/.produccion.schema.sql: el volcado esta desactualizado y reemplazar
// un SP con una version vieja revertiria cambios ajenos sin avisar.
//
// Uso:
//   node scripts/parche-lead-company-id.mjs            # lee produccion, escribe el .sql
//   node scripts/parche-lead-company-id.mjs --aplicar  # ademas lo aplica en la BD LOCAL
import fs from 'fs'
import pg from 'pg'

const SALIDA = new URL('./sp-lead-company-id.sql', import.meta.url)
const CRLF = '\r\n'

const bak = fs.readFileSync(new URL('../.env.bak-produccion', import.meta.url), 'utf8')
const urlProd = bak.match(/^\s*#?\s*DATABASE_URL=(postgresql:\/\/[^\s]+55432[^\s]*)/m)?.[1]
if (!urlProd) throw new Error('no encontre la DATABASE_URL del tunel en .env.bak-produccion')

const fuente = new pg.Pool({ connectionString: urlProd, max: 2, connectionTimeoutMillis: 10000 })

const definicion = async (nombre) => {
  const { rows } = await fuente.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`, [nombre])
  if (rows.length !== 1) throw new Error(`${nombre}: esperaba 1 definicion, encontre ${rows.length}`)
  // pg_get_functiondef devuelve CRLF (los SPs se crearon desde Windows) y eso
  // hace que cualquier ancla multilinea no matchee. El fin de linea no le
  // importa a Postgres, asi que se normaliza antes de parchear.
  return rows[0].def.split(CRLF).join('\n')
}

// Cada parche reemplaza un ancla por si misma + la columna nueva. Si el ancla
// no aparece exactamente una vez, aborta: significa que el SP cambio y el
// parche a ciegas escribiria basura.
const aplicarParche = (sql, nombre, ancla, reemplazo) => {
  // La guarda mira SU propio reemplazo, no un "company_id" suelto: el primer
  // parche del register ya mete esa palabra en el SP y con una guarda global
  // el segundo se saltaba, dejando la columna sin su valor en el VALUES.
  if (sql.includes(reemplazo)) {
    console.log(`   ${nombre}: ya parcheado, lo dejo como esta`)
    return sql
  }
  const veces = sql.split(ancla).length - 1
  if (veces !== 1) throw new Error(`${nombre}: el ancla ${JSON.stringify(ancla)} aparece ${veces} veces, esperaba 1`)
  return sql.replace(ancla, reemplazo)
}

console.log('Leyendo los procedures de produccion...')

// 1) register: la columna al INSERT y el valor al VALUES.
let register = await definicion('sp_comercial_lead_register')
register = aplicarParche(register, 'register (columna)',
  '    cat_type_client\n  )',
  '    cat_type_client,\n    company_id\n  )')
register = aplicarParche(register, 'register (valor)',
  "NULLIF(p_lead->>'cat_client_type','')::int",
  "NULLIF(p_lead->>'cat_client_type','')::int,\n    NULLIF(p_lead->>'company_id','')::int")

// 2) update: mismo criterio que el resto de campos opcionales del SET. Se usa
//    `p_lead ? 'company_id'` (no COALESCE) para poder DESvincular la empresa:
//    con COALESCE, mandar null dejaria la empresa anterior pegada para siempre.
let update = await definicion('sp_comercial_lead_update')
update = aplicarParche(update, 'update',
  "        cat_type_client      = COALESCE(NULLIF(p_lead->>'cat_client_type','')::int, l.cat_type_client)",
  "        cat_type_client      = COALESCE(NULLIF(p_lead->>'cat_client_type','')::int, l.cat_type_client),\n" +
  "        company_id           = CASE WHEN p_lead ? 'company_id' THEN NULLIF(p_lead->>'company_id', '')::int ELSE l.company_id END")

// 3) get: devolver la empresa para que el formulario la muestre al reabrir.
let get = await definicion('sp_comercial_lead_get')
get = aplicarParche(get, 'get',
  '    l.message_init_conversation, l.observations, l.active, l.bot, l.web, l.b2b,',
  '    l.message_init_conversation, l.observations, l.active, l.bot, l.web, l.b2b,\n' +
  '    l.company_id,\n' +
  '    (SELECT co.razon_social FROM public.companies co WHERE co.company_id = l.company_id) AS company_name,')

const sql = [
  '-- Guarda la empresa del convenio en leads.company_id.',
  '-- Generado por scripts/parche-lead-company-id.mjs desde el fuente vivo de',
  '-- produccion. Idempotente: CREATE OR REPLACE de los 3 procedures.',
  '',
  register.replace(/^CREATE PROCEDURE/, 'CREATE OR REPLACE PROCEDURE') + ';',
  '',
  update.replace(/^CREATE PROCEDURE/, 'CREATE OR REPLACE PROCEDURE') + ';',
  '',
  get.replace(/^CREATE PROCEDURE/, 'CREATE OR REPLACE PROCEDURE') + ';',
  ''
].join('\n')

fs.writeFileSync(SALIDA, sql, 'utf8')
console.log('Escrito: scripts/sp-lead-company-id.sql', `(${sql.length} chars)`)
await fuente.end()

if (process.argv.includes('--aplicar')) {
  const local = new pg.Pool({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/system_erp_dev',
    max: 2, connectionTimeoutMillis: 10000
  })
  await local.query(sql)
  console.log('Aplicado en la BD LOCAL de pruebas (5433/system_erp_dev).')
  await local.end()
}
