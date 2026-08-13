// Hace que los SPs de lead dejen de guardar a ciegas el E. CLIENTE que mando el
// Frontend y pasen por public.fn_client_moment (piso calculado; el asesor solo
// puede subirlo). Ver fn_client_moment.sql.
//
// Parchea el cuerpo vivo en la BD: los SPs no estan versionados en el repo.
// Idempotente: si ya dice fn_client_moment, no toca nada.
//
//   node scripts/parchar-sp-client-moment.mjs --dry   # muestra el diff
//   node scripts/parchar-sp-client-moment.mjs         # aplica
import { q, pool } from './db.mjs'

const soloVerDiff = process.argv.includes('--dry')

// En el INSERT el momento entra tal cual viene del payload; el telefono del lead
// es la clave del historial. NOW() implicito: el lead se registra hoy.
const INSERT_VIEJO = `    NULLIF(p_lead->>'cat_client_moment','')::int,`
const INSERT_NUEVO = `    public.fn_client_moment(
      NULLIF(p_lead->>'origin_phone',''),
      NULLIF(p_lead->>'cat_client_moment','')::int
    ),`

// En el UPDATE el momento se congela en la fecha de registro del lead: una venta
// de julio no puede reescribir una consulta de marzo (el embudo del mes cerrado
// dejaria de cuadrar). Lo unico que puede cambiar es que el asesor lo suba.
const UPDATE_VIEJO = `        cat_client_moment    = CASE WHEN p_lead ? 'cat_client_moment' THEN NULLIF(p_lead->>'cat_client_moment', '')::int ELSE l.cat_client_moment END,`
const UPDATE_NUEVO = `        cat_client_moment    = public.fn_client_moment(
                                 COALESCE(NULLIF(p_lead->>'origin_phone',''), l.origin_phone),
                                 CASE WHEN p_lead ? 'cat_client_moment'
                                      THEN NULLIF(p_lead->>'cat_client_moment', '')::int
                                      ELSE l.cat_client_moment END,
                                 l.registration_date),`

const PARCHES = [
  { sp: 'sp_comercial_lead_register', viejo: INSERT_VIEJO, nuevo: INSERT_NUEVO },
  { sp: 'sp_company_lead_register',   viejo: INSERT_VIEJO, nuevo: INSERT_NUEVO },
  { sp: 'sp_comercial_lead_update',   viejo: UPDATE_VIEJO, nuevo: UPDATE_NUEVO }
]

async function definicion (sp) {
  const { rows } = await q(
    `SELECT pg_get_functiondef(p.oid) AS cuerpo
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`, [sp])
  if (rows.length !== 1) throw new Error(`${sp}: se esperaba 1 definicion, hay ${rows.length}`)
  return rows[0].cuerpo
}

for (const { sp, viejo, nuevo } of PARCHES) {
  const cuerpo = await definicion(sp)

  if (cuerpo.includes('fn_client_moment')) {
    console.log(`= ${sp}: ya parchado`)
    continue
  }

  const ocurrencias = cuerpo.split(viejo).length - 1
  if (ocurrencias !== 1) {
    throw new Error(`${sp}: el texto a reemplazar aparece ${ocurrencias} veces, se esperaba 1`)
  }

  const parchado = cuerpo.replace(viejo, nuevo)
  console.log(`\n--- ${sp} ---\n- ${viejo.trim()}\n+ ${nuevo.trim().replace(/\n/g, '\n  ')}`)

  if (!soloVerDiff) {
    await q(parchado)
    console.log(`+ ${sp}: aplicado`)
  }
}

if (soloVerDiff) console.log('\n(--dry: no se guardo nada)')
await pool.end()
