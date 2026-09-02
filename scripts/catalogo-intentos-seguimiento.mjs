// Rehace los catalogos del panel "Seguimiento / Intentos de Contacto" del form de lead.
//
//   node scripts/catalogo-intentos-seguimiento.mjs [--dry]
//
// Dos cambios pedidos por comercial (2026-09-02):
//   1. we_attempt gana la opcion WhatsApp (hasta hoy solo Llamada + plantillas de mensaje).
//   2. we_calling se reemplaza por la lista de abajo: se reusan los alias cuya
//      descripcion ya decia lo mismo, el resto se da de baja logica (active='N').
//
// Baja logica y NUNCA delete: los intentos historicos apuntan a estos catalog_id.
// Los sentinelas we_calling_pending / we_calling_message no se tocan: el front los
// usa como estado, no como respuesta.
//
// Ojo: despues de correr esto hay que bumpear LS_KEY en Frontend/src/services/
// catalog.service.js, si no los navegadores siguen sirviendo el catalogo cacheado.
import { q, pool } from './db.mjs'

const TIPOS_NUEVOS = [
  ['we_attempt_whatsapp', 'WhatsApp']
]

// Alias -> descripcion. El orden del arreglo es el del pedido; el desplegable
// ordena por catalog_id, asi que los reusados salen antes que los nuevos.
const RESPUESTAS = [
  ['we_calling_too_expensive', 'Muy caro'],
  ['we_calling_enrolled_elsewhere', 'Se inscribió en otra institución'],
  ['we_calling_not_interested', 'No le interesa'],
  ['we_calling_not_recognize', 'Desconoce la consulta'],
  ['we_calling_thought_free', 'Pensó que era gratis'],
  ['we_calling_not_expected', 'No era lo que buscaba'],
  ['we_calling_week_morning', 'Quiere horario días de semana por la mañana'],
  ['we_calling_week_afternoon', 'Quiere horario días de semana por la tarde'],
  ['we_calling_week_night', 'Quiere horario días de semana por la noche'],
  ['we_calling_sat_night', 'Quiere horario sábados por la noche'],
  ['we_calling_sat_afternoon', 'Quiere horario sábados por la tarde'],
  ['we_calling_sat_morning', 'Quiere horario sábados por la mañana'],
  ['we_calling_intensive', 'Quiere horario intensivo'],
  ['we_calling_more_sessions', 'Quiere más sesiones'],
  ['we_calling_hours_mismatch', 'No le cuadra las horas de clases con horas de certificado'],
  ['we_calling_sun_afternoon', 'Quiere horario domingo por la tarde'],
  ['we_calling_sun_morning', 'Quiere horario domingo por la mañana'],
  ['we_calling_show_interest', 'Muestra interés'],
  ['we_calling_will_pay', 'Voy a pagar'],
  ['we_calling_review_info', 'Revisará nuevamente info'],
  ['we_calling_check_info', 'Indagar información'],
  ['we_calling_call_stop', 'Cuelga la llamada'],
  ['we_calling_no_hold', 'No contesta'],
  ['we_calling_phone_off', 'Apagado'],
  ['we_calling_number_not_exist', 'Número no existe'],
  ['we_calling_wants_onsite', 'Quiere presencial']
]

const SENTINELAS = ['we_calling_pending', 'we_calling_message']

const dry = process.argv.includes('--dry')

async function padreDe (alias) {
  const { rows: [p] } = await q('SELECT catalog_id FROM catalog WHERE alias = $1 AND catalog_parent_id IS NULL', [alias])
  if (!p) throw new Error(`No existe el catalogo padre ${alias}`)
  return p.catalog_id
}

async function upsert (padreId, alias, description) {
  const { rows: [actual] } = await q('SELECT catalog_id, description, active FROM catalog WHERE alias = $1', [alias])
  if (actual && actual.description === description && actual.active === 'Y') {
    console.log(`[=] ${alias} — sin cambios`)
    return
  }
  if (dry) {
    console.log(actual ? `[~] ${alias}: "${actual.description}"(${actual.active}) -> "${description}"(Y)` : `[+] ${alias}: "${description}"`)
    return
  }
  if (actual) {
    await q("UPDATE catalog SET description = $1, active = 'Y', modification_date = now() WHERE catalog_id = $2", [description, actual.catalog_id])
    console.log(`[~] ${alias} (${actual.catalog_id}) -> "${description}"`)
  } else {
    const { rows: [creado] } = await q(
      "INSERT INTO catalog (alias, description, catalog_parent_id, active, registration_date) VALUES ($1, $2, $3, 'Y', now()) RETURNING catalog_id",
      [alias, description, padreId]
    )
    console.log(`[+] ${alias} (${creado.catalog_id}) -> "${description}"`)
  }
}

async function main () {
  const padreAttempt = await padreDe('we_attempt')
  const padreCalling = await padreDe('we_calling')

  for (const [alias, desc] of TIPOS_NUEVOS) await upsert(padreAttempt, alias, desc)
  for (const [alias, desc] of RESPUESTAS) await upsert(padreCalling, alias, desc)

  const vigentes = [...RESPUESTAS.map(([a]) => a), ...SENTINELAS]
  const vigentesSql = "catalog_parent_id = $1 AND active = 'Y' AND NOT (alias = ANY($2::text[]))"
  const { rows: bajas } = dry
    ? await q(`SELECT alias, description FROM catalog WHERE ${vigentesSql}`, [padreCalling, vigentes])
    : await q(`UPDATE catalog SET active = 'N', modification_date = now() WHERE ${vigentesSql} RETURNING alias, description`, [padreCalling, vigentes])
  bajas.forEach(b => console.log(`[-] baja logica: ${b.alias} — "${b.description}"`))
  console.log(`\n${dry ? 'DRY RUN — nada guardado. ' : ''}${RESPUESTAS.length} respuestas vigentes, ${bajas.length} dadas de baja.`)
}

main()
  .catch(e => { console.error('[x]', e.message); process.exitCode = 1 })
  .finally(() => pool.end())
